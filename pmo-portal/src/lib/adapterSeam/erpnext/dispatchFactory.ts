/**
 * ERPNext dispatch factory (task 2.13, mirrors `clickup/dispatchFactory.ts`). Resolves the per-org
 * erpnext adapter from the ALREADY-ACTIVATED `external_org_bindings` row (0095) — the version
 * handshake (FR-ENA-012) runs once at bind-create/refresh time, not on every dispatch. Credentials
 * (`apiKey`/`apiSecret`) are resolved from `secret_ref` at the edge-fn boundary and passed in — this
 * module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002). `ctx.refs` is populated by
 * `resolveProcurementOrderRefs` (task 5.3, FR-ENA-103) for a PO/GR command; other kinds get an empty
 * refs bag until their own slice wires resolution.
 */
import { createErpAdapter, ERPNEXT_TIER, type DoctypeBodyFns, type ErpAdapterDeps } from './adapter.ts';
import type { ErpDocKind } from './doctypeRegistry.ts';
import { getDoc, type ErpClientDeps, type ErpRateLimiter } from './client.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import type { Adapter, AdapterCommand } from '../contract.ts';
import { AppError } from '../../appError.ts';

/** Structural service-role client seam (matches supabase-js): `.from(t).select(c).eq(...)[.eq(...)]
 *  [.order(...).limit(...)][.maybeSingle()]` — every filter-builder is ALSO directly awaitable
 *  (matching real supabase-js's thenable `PostgrestFilterBuilder`, the shape a bare list query — e.g.
 *  Slice 5's `procurement_items` read, task 5.3 — resolves through with no terminal call). Strict
 *  superset of the pre-Slice-5 shape (`.eq().eq().maybeSingle()`), so every earlier caller/mock is
 *  unaffected. */
export interface DispatchServiceClient {
  from(table: string): {
    select(columns: string): DispatchFilterBuilder;
  };
}
export interface DispatchFilterBuilder extends PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  eq(column: string, value: string): DispatchFilterBuilder;
  order(column: string, opts?: { ascending?: boolean }): DispatchFilterBuilder;
  limit(n: number): DispatchFilterBuilder;
  maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

interface ExternalOrgBindingRow {
  site_url: string;
  version_major: number | null;
  activated_at: string | null;
  config: Record<string, unknown>;
}

// ── Slice 5 (task 5.3, FR-ENA-103): cross-doctype ref resolution for a PO/GR command — the
// supplier (companies domain), the case's line items (`procurement_items`) when the command carried
// none, and — for a GR — the case's PO (procurement domain) + the PO item CHILD-ROW `name` (fetched
// from the PO doc). Never a raw PMO id, never a client-supplied ERP name. Guarded on
// `record.procurementId`: a command without one (every non-PO/GR kind, and every pre-Slice-5 caller)
// takes ZERO extra DB/HTTP calls (byte-for-byte).

interface ResolvedLineItem {
  item_code: string;
  qty: number | string;
  rate?: number | string;
  schedule_date?: string;
  po_item_child_name?: string;
}

/** The companies-domain external id encodes its doctype (`Supplier:<name>`/`Customer:<name>`, task
 *  3.2's adopt design) so the collision rule is deterministic; PO/GR bodies want the raw ERP name. */
function stripPartyDoctypePrefix(externalId: string): string {
  const idx = externalId.indexOf(':');
  return idx === -1 ? externalId : externalId.slice(idx + 1);
}

/** `YYYY-MM-DD`, `days` from today (UTC) — the fallback when a PO command carries no `date` (R9 §3:
 *  `schedule_date` is genuinely mandatory on the ERP side; the adapter must never send nothing). */
function todayPlusDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** procurements.vendor_id -> the ERP Supplier/Customer raw name, via `external_refs` (companies
 *  domain). `null` when the case has no selected vendor yet, or no mapping is recorded. */
async function resolveCaseSupplierName(
  serviceClient: DispatchServiceClient,
  orgId: string,
  procurementId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.from('procurements').select('vendor_id').eq('id', procurementId).maybeSingle();
  if (error || !data) return null;
  const vendorId = (data as { vendor_id: string | null }).vendor_id;
  if (!vendorId) return null;
  const externalId = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'companies', vendorId);
  return externalId ? stripPartyDoctypePrefix(externalId) : null;
}

/** The case's line items (`procurement_items`, the shared item list every procurement sub-doctype
 *  draws from) mapped to the PMO-shaped line-item draft `erpnext/bodies/*`'s `toBody`s read. */
async function resolveCaseItems(serviceClient: DispatchServiceClient, procurementId: string): Promise<ResolvedLineItem[]> {
  const { data, error } = await serviceClient.from('procurement_items').select('name,quantity,rate').eq('procurement_id', procurementId);
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ name: string; quantity: number | string; rate: number | string | null }>).map((row) => ({
    item_code: row.name,
    qty: row.quantity,
    rate: row.rate ?? undefined,
  }));
}

/** The case's most-recently-created `purchase_orders` PMO row (P2 scope: a GR resolves against the
 *  case's single/latest PO — the current PMO `procurement_receipts` schema carries no per-GR PO
 *  picker; see the Slice 5 report). `null` when the case has no PO yet. */
async function resolveLatestPoPmoId(serviceClient: DispatchServiceClient, procurementId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('purchase_orders')
    .select('id')
    .eq('procurement_id', procurementId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return (data[0] as { id: string }).id;
}

/** `GET` the PO doc and build `item_code -> child-row name` (the `purchase_order_item` GR needs per
 *  row, R9 §4) — the ONE place a PO doc is read for this purpose. */
async function resolvePoItemChildNames(client: ErpClientDeps, poName: string): Promise<Record<string, string>> {
  const doc = (await getDoc(client, 'Purchase Order', poName)) as { items?: unknown };
  const items = Array.isArray(doc.items) ? (doc.items as Array<Record<string, unknown>>) : [];
  const map: Record<string, string> = {};
  for (const item of items) {
    if (typeof item.item_code === 'string' && typeof item.name === 'string') map[item.item_code] = item.name;
  }
  return map;
}

/** Resolve every PO/GR ref this command needs (task 5.3). Returns the `ctx.refs` additions +
 *  `resolvedItems` (only set when the command carried none — `adapter.ts`'s fallback substitutes it). */
async function resolveProcurementOrderRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null>; resolvedItems?: ResolvedLineItem[] }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as { erp_doc_kind?: string; procurementId?: string; items?: unknown[]; date?: string };
  const kind = record.erp_doc_kind;
  const procurementId = record.procurementId;
  if ((kind !== 'purchase-order' && kind !== 'goods-receipt') || !procurementId) return { refs };

  const supplierName = await resolveCaseSupplierName(deps.serviceClient, deps.orgId, procurementId);
  if (supplierName) refs.supplier = supplierName;

  let resolvedItems: ResolvedLineItem[] | undefined;
  const hasOwnItems = Array.isArray(record.items) && record.items.length > 0;
  if (!hasOwnItems) {
    const caseItems = await resolveCaseItems(deps.serviceClient, procurementId);
    resolvedItems = kind === 'purchase-order'
      ? caseItems.map((item) => ({ ...item, schedule_date: record.date ?? todayPlusDaysIso(7) }))
      : caseItems;
  }

  if (kind === 'goods-receipt' && resolvedItems) {
    const poPmoId = await resolveLatestPoPmoId(deps.serviceClient, procurementId);
    if (poPmoId) {
      const poExternalName = await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'procurement', poPmoId);
      if (poExternalName) {
        refs.po = poExternalName;
        const childNames = await resolvePoItemChildNames(
          { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret, baseUrl: binding.site_url, rateLimiter: deps.rateLimiter },
          poExternalName,
        );
        resolvedItems = resolvedItems.map((item) => ({ ...item, po_item_child_name: childNames[item.item_code] }));
      }
    }
  }

  return { refs, resolvedItems };
}

export interface ErpDispatchFactoryDeps {
  serviceClient: DispatchServiceClient;
  orgId: string;
  command: AdapterCommand;
  fetchImpl: typeof fetch;
  /** Resolved from `secret_ref` at the edge-fn boundary (vault `AS`/fn secrets) — never read here. */
  apiKey: string;
  apiSecret: string;
  /** A modest per-org token bucket (FR-ENA-014), shared across a request. Optional. */
  rateLimiter?: ErpRateLimiter;
  /** The (kind)->{toBody,fromDoc} side table — empty until slices 3-6 wire real doctype bodies. */
  doctypeBodies?: Partial<Record<ErpDocKind, DoctypeBodyFns>>;
  /** Threaded straight into `ErpAdapterDeps.afterSubmitHook` (FR-ENA-003 — the `after-submit-before-
   *  mirror` fault seam, wired by the edge fn at task 2.14). Optional — a production caller that
   *  never arms the fault gate can omit it (a true no-op). */
  afterSubmitHook?: () => Promise<void>;
}

/**
 * Resolve the erpnext adapter for one command: read the org's `external_org_bindings` row, refuse
 * `config-rejected` when it is missing or not yet activated (`activated_at === null` — a version
 * mismatch or a binding never activated, FR-ENA-012), then build the adapter over the resolved
 * `site_url`/`config`.
 */
export async function resolveErpDispatchAdapter(deps: ErpDispatchFactoryDeps): Promise<Adapter> {
  const { data, error } = await deps.serviceClient
    .from('external_org_bindings')
    .select('site_url, version_major, activated_at, config')
    .eq('org_id', deps.orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  if (error || !data) {
    throw new AppError('no erpnext binding configured for this org', error?.code ?? 'BINDING_NOT_FOUND');
  }
  const binding = data as ExternalOrgBindingRow;
  if (!binding.activated_at) {
    throw new AppError('erpnext binding is not activated (version handshake mismatch or never activated)', 'config-rejected');
  }

  // Ref resolution (supplier/PO/PO-item) — task 5.3 wires the PO/GR case; slice 3 wires the
  // companies-domain party create/update path (which needs no cross-doctype resolution of its own).
  const { refs, resolvedItems } = await resolveProcurementOrderRefs(deps, binding);

  const adapterDeps: ErpAdapterDeps = {
    client: {
      fetchImpl: deps.fetchImpl,
      apiKey: deps.apiKey,
      apiSecret: deps.apiSecret,
      baseUrl: binding.site_url,
      rateLimiter: deps.rateLimiter,
    },
    doctypeBodies: deps.doctypeBodies ?? {},
    ctx: { refs, config: binding.config, resolvedItems },
    afterSubmitHook: deps.afterSubmitHook,
  };
  return createErpAdapter(adapterDeps);
}
