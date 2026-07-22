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
import { getDoc, listDocNamesByFilters, type ErpClientDeps, type ErpRateLimiter } from './client.ts';
import type { ErpProbeDeps } from './recoveryProbe.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import { packTimeLogs } from './timeLogPacking.ts';
import { readProcessGates } from './processGates.ts';
import type { Adapter, AdapterCommand } from '../contract.ts';
import { AppError } from '../../appError.ts';
import { resolveBudgetAccounts, type BudgetLineItem, type CategoryAccountMapRow } from '../../budget/categoryAccountMap.ts';

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

// ============================================================================
// Luna re-audit BLOCK 2 — cross-org link PRE-FLIGHT (money-critical, ordering)
// ============================================================================

/** Every cross-entity PMO link a command can carry, and the table each must belong to in the caller's
 *  org. `readModelWriters` guards the SAME links, but only inside the MIRROR writers — which run AFTER
 *  `adapter.commit()` and `recordOutboxRef`. By then a cross-org link has already minted a REAL ERP
 *  money document that no PMO row can ever reference (orphan money), or — round-7 B10 — a mirror row
 *  stamped with the CALLER's org_id but ANOTHER tenant's foreign key (a service-role write; RLS does
 *  not protect it). This table drives the PRE-flight; the post-commit guards stay as defence in depth.
 *
 *  Round-7 B10 added the `procurement` half: only the three revenue links were pre-flighted, so a
 *  direct command carrying another tenant's known `procurementId` was accepted. */
type LinkField = 'customerId' | 'projectId' | 'salesInvoiceId' | 'procurementId' | 'vendorId' | 'invoiceId';

const LINK_TABLE: Readonly<Record<LinkField, string>> = {
  customerId: 'companies',
  projectId: 'projects',
  salesInvoiceId: 'sales_invoices',
  procurementId: 'procurements',
  vendorId: 'companies',
  invoiceId: 'procurement_invoices',
};

/** The links each ERPNext domain's commands can carry (the fields `readModelWriters` copies into the
 *  service-role mirror insert). `companies` (supplier/customer parties) carries none. */
const DOMAIN_LINK_FIELDS: Readonly<Record<string, ReadonlyArray<LinkField>>> = {
  revenue: ['customerId', 'projectId', 'salesInvoiceId'],
  procurement: ['procurementId', 'vendorId', 'invoiceId'],
  // P3c: a budget push is scoped to ONE project. A cross-org `projectId` would push this org's figures
  // onto another tenant's ERP project dimension — refused here, before the adapter exists.
  budget: ['projectId'],
};

/** Assert one linked row exists AND belongs to `orgId`. Fails CLOSED: a missing row (no row, or an id
 *  from another tenant that RLS-free service-role reads would happily return) is rejected exactly like
 *  a cross-org one — never treated as an absent link. Throws the classified `cross-org-link-rejected`
 *  (the same code `readModelWriters` raises, so the caller-facing classification is unchanged). */
async function assertLinkBelongsToOrg(
  serviceClient: DispatchServiceClient,
  orgId: string,
  table: string,
  id: string,
): Promise<void> {
  const { data, error } = await serviceClient.from(table).select('org_id').eq('id', id).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const rowOrgId = (data as { org_id: string } | null)?.org_id;
  if (rowOrgId !== orgId) {
    throw new AppError(
      `cross-org link rejected: ${table} '${id}' does not belong to org '${orgId}'`,
      'cross-org-link-rejected',
    );
  }
}

/**
 * Validate EVERY cross-entity link this command carries BEFORE the adapter exists — so a command
 * pairing (say) a valid own-org customer with ANOTHER org's `salesInvoiceId`, or naming another
 * tenant's `procurementId`, is refused with no ERP write and no outbox commit. Runs ahead of ref
 * resolution (which itself issues ERP GETs for a GR) and ahead of `dispatchExternallyOwnedWrite`
 * (index.ts resolves the adapter first). A null/absent link is skipped — only ASSERTED links are
 * validated (an on-account receipt, or a Material Request with no vendor, legitimately carries none).
 */
async function assertCommandLinksSameOrg(deps: ErpDispatchFactoryDeps): Promise<void> {
  const record = deps.command.record as Partial<Record<LinkField, string | null>>;
  for (const field of DOMAIN_LINK_FIELDS[deps.command.domain] ?? []) {
    const id = record[field];
    if (typeof id === 'string' && id.length > 0) {
      await assertLinkBelongsToOrg(deps.serviceClient, deps.orgId, LINK_TABLE[field], id);
    }
  }
}

// ============================================================================
// Luna re-audit BLOCK 4 — the require_project_on_si gate needs a RESOLVED ERP project
// ============================================================================

/** PMO `projectId` -> the ERP project name, via the binding's `config.project_map` override (Director
 *  ruling §6.1 — search-by-`project_name` + auto-create is a fast-follow; the map is the source of
 *  truth today). `null` = no projectId, or a projectId this binding has no ERP mapping for. ONE
 *  definition, shared by the ref resolution and the gate below — they must never disagree about what
 *  "the ERP project resolved" means. */
function resolveErpProjectName(config: Record<string, unknown> | undefined, projectId: string | null | undefined): string | null {
  const projectMap = (config?.project_map as Record<string, string> | undefined) ?? {};
  return projectId ? (projectMap[projectId] ?? null) : null;
}

/**
 * Does this command BUILD a Sales Invoice body (and therefore decide whether the ERP document
 * carries a `project` dimension)? Luna re-audit BLOCK #12 — the gate used to ask "is this a create?",
 * which left the amend path wide open:
 *   - `create`                      -> `bodies/salesInvoice.toBody`
 *   - `update`                      -> a draft field PUT, or routeEdit(1) -> commitAmend, both of
 *                                      which rebuild the body
 *   - `transition{verb:'amend'}`    -> commitAmend (cancel + create-with-`amended_from`)
 * `submit`/`cancel` transitions act on an EXISTING document and build no body, so the gate must not
 * (and does not) touch them.
 *
 * Exported because `adapter-dispatch/index.ts` enforces the OTHER half of the same gate (the
 * "projectId present at all" check) and the two must never disagree about which operations qualify.
 */
export function buildsSalesInvoiceBody(command: { operation: string; record: { verb?: unknown } }): boolean {
  const operation = String(command.operation);
  if (operation === 'create' || operation === 'update') return true;
  if (operation === 'transition') return command.record.verb === 'amend';
  return false;
}

/**
 * Enforce `require_project_on_si` on every SI body-building operation against the ERP project that
 * ACTUALLY resolved —
 * not merely against a non-null PMO `projectId` (the dispatch's own pre-flight already covers that).
 * A PMO project with no `project_map` entry resolves to `null`, and `bodies/salesInvoice.ts` then omits
 * the ERP `project` field entirely: the invoice posts with NO project dimension on the GL while PMO
 * reports it as project revenue. With the gate ON that silent divergence must be fatal, and fatal HERE
 * — before the adapter is constructed, so nothing is written to ERPNext.
 *
 * Gate OFF (or a non-SI/non-create command) ⇒ untouched: an unmapped project stays a legitimate
 * unattributed invoice. Gates are read from the SAME `config` the FE reads (`readProcessGates`, which
 * applies the per-key defaults — `require_project_on_si` defaults TRUE).
 */
function assertSiProjectGate(deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow): void {
  const record = deps.command.record as { erp_doc_kind?: string; projectId?: string | null; verb?: unknown };
  if (record.erp_doc_kind !== 'sales-invoice') return;
  if (!buildsSalesInvoiceBody({ operation: deps.command.operation as string, record })) return;
  if (!readProcessGates(binding.config).require_project_on_si) return;
  // A MISSING projectId is the dispatch's own gate (index.ts -> 422 'project-required'), enforced
  // before this factory is ever reached — not re-thrown here with a different status. This guard owns
  // the half that check cannot see: a projectId that is present but resolves to no ERP project.
  if (!record.projectId) return;
  if (resolveErpProjectName(binding.config, record.projectId) === null) {
    throw new AppError(
      `require_project_on_si is on but project '${record.projectId}' has no ERP project mapping — ` +
        'the invoice would post with no project dimension on the ERP ledger',
      'commit-rejected',
    );
  }
}

// ============================================================================
// Luna re-audit BLOCK #1 — the fallback anchor probe needs the payment_type discriminator
// ============================================================================

/** The two PMO kinds that share Frappe's single `Payment Entry` doctype, and the `payment_type` that
 *  tells them apart. Any other kind has no discriminator (its doctype is unambiguous). */
const PAYMENT_TYPE_BY_KIND: Readonly<Record<string, 'Pay' | 'Receive'>> = {
  payment: 'Pay',
  'incoming-payment': 'Receive',
};

/**
 * Conjoin the `payment_type` discriminator onto a Payment Entry recovery probe.
 *
 * `probeErpByPaymentComposite` already does this for the composite path, but the adapter-dispatch
 * FALLBACK (taken when no composite payload has been persisted yet) called the bare
 * `probeErpByAnchorKey`. Since 'Pay' and 'Receive' entries share one doctype and the anchor field
 * (`reference_no`) is ERP-side editable, an unfiltered anchor `like` can adopt an entry of the WRONG
 * direction whenever the two share a reference_no — mirroring a PMO incoming payment onto an outgoing
 * payment document (or cancelling the wrong one later, since the adopted name becomes the mapping).
 *
 * Applies both the server-side list filter AND the post-fetch validator (defense in depth, matching
 * `probeErpByPaymentComposite`'s own anchor deps). A doc that does not state its `payment_type` is
 * refused rather than adopted. A non-Payment-Entry kind is returned UNCHANGED (byte-for-byte).
 */
export function withPaymentTypeDiscriminator(deps: ErpProbeDeps, kind: unknown): ErpProbeDeps {
  const paymentType = typeof kind === 'string' ? PAYMENT_TYPE_BY_KIND[kind] : undefined;
  if (!paymentType) return deps;
  return {
    ...deps,
    anchorExtraFilters: [['payment_type', '=', paymentType]],
    validateAdoptedDoc: (doc) => (doc as { payment_type?: unknown }).payment_type === paymentType,
  };
}

// ============================================================================
// Task 2.3 — Revenue ref resolver (FR-SAR-100/101/121)
// ============================================================================

/** Resolve revenue-domain refs for a sales-invoice or incoming-payment command.
 *  - `ctx.refs.customer` from `record.customerId` via `external_refs` (companies domain,
 *    `Customer:<name>` → strip prefix to bare ERP name).
 *  - `ctx.refs.project` from `record.projectId` via the binding's ERP-project→PMO map
 *    (`binding.config.project_map[projectId]` → ERP `project` name). The Director ruling §6.1
 *    says: resolve by ERP `project_name` search first; auto-create on miss is a separate
 *    concern (the binding map is the override; search-by-name + create is a fast-follow).
 *    Here we use the binding map as the source of truth for the ERP project name.
 *  - For `incoming-payment`: `references[]` row's `reference_name` from `record.salesInvoiceId`
 *    via `external_refs` (revenue domain → the SI's ERP name). The body builder reads
 *    `rec.references` (set by the repo from `salesInvoiceId`) and maps to ERP `references`.
 */
async function resolveRevenueRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as {
    erp_doc_kind?: string;
    customerId?: string;
    projectId?: string;
    salesInvoiceId?: string;
    paid_amount?: unknown;
  };
  const kind = record.erp_doc_kind;

  if ((kind !== 'sales-invoice' && kind !== 'incoming-payment') || !record.customerId) {
    return { refs };
  }

  // Resolve customer (companies domain: Customer:<name> → bare name)
  const customerExternalId = await resolveExternalRef(
    deps.serviceClient as unknown as ExternalRefsLookupClient,
    deps.orgId,
    'companies',
    record.customerId,
  );
  if (customerExternalId) {
    refs.customer = customerExternalId.startsWith('Customer:')
      ? customerExternalId.slice('Customer:'.length)
      : customerExternalId;
  }

  // Resolve project for sales-invoice (the gate on this ref is enforced by `assertSiProjectGate`,
  // ahead of the adapter — both use `resolveErpProjectName` so they can never diverge).
  if (kind === 'sales-invoice') {
    refs.project = resolveErpProjectName(binding.config, record.projectId);
  }

  // Resolve SI reference for incoming-payment — Luna BLOCK 5 (MONEY-CRITICAL):
  // - If salesInvoiceId is present but UNRESOLVABLE → reject (classified error, no ERP write)
  // - If salesInvoiceId is present and RESOLVED → DISCARD any caller-supplied references,
  //   build references[] ONLY from the server-resolved SI ERP name + paid_amount
  // - If salesInvoiceId is null/absent → allow unreferenced on-account receipt (empty references[])
  if (kind === 'incoming-payment') {
    if (record.salesInvoiceId) {
      const siExternalId = await resolveExternalRef(
        deps.serviceClient as unknown as ExternalRefsLookupClient,
        deps.orgId,
        'revenue',
        record.salesInvoiceId,
      );
      if (!siExternalId) {
        throw new AppError(
          `salesInvoiceId '${record.salesInvoiceId}' not found in this org's revenue external_refs`,
          'cross-org-link-rejected',
        );
      }
      refs.si = siExternalId;
      // DISCARD caller-supplied references entirely; build ONLY from resolved SI
      (deps.command.record as { references?: unknown }).references = [
        { reference_doctype: 'Sales Invoice', reference_name: siExternalId, allocated_amount: record.paid_amount ?? null },
      ];
    } else {
      // No salesInvoiceId → on-account receipt: explicit empty references (never caller-supplied)
      (deps.command.record as { references?: unknown }).references = [];
    }
  }

  return { refs };
}

// ============================================================================
// P3b (FR-TSP-050..055) — the Posture-B timesheet ref pre-flight
// ============================================================================

/**
 * Resolve `timesheets`-domain refs. EVERY resolution is FAIL-CLOSED and happens HERE — before the
 * adapter is constructed, therefore before the outbox claim and before the ERP POST (FR-TSP-050;
 * Luna BLOCK-6: P3a validated cross-org AFTER the external write, which can leave committed money
 * with no PMO row — the P3b twin is committed HOURS with no PMO push record). A miss THROWS a
 * classified `AppError`; it is NEVER silently omitted from the body (Luna SF9).
 *
 * ⚑ This is the ONLY backstop for two of these dimensions. ERPNext validates neither the `employee`
 * nor the `project` link (spike §8 — a Frappe `fetch_from` quirk): a garbage or stale value is
 * accepted through save AND submit with a clean 200 and no error, silently attributing a week of
 * hours to a phantom employee or posting it with no project dimension.
 *
 * The record's `user_id`/`entries` are SERVER TRUTH, re-read by `approved_timesheet_for_push`
 * (migration 0138) in the dispatch's approval gate and substituted onto the command — never a
 * caller-supplied payload (ADR-0059 §3.3).
 */
async function resolveTimesheetRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as {
    erp_doc_kind?: string;
    user_id?: string;
    entries?: Array<{ project_id: string; entry_date: string; hours: string; project_org_id?: string }>;
  };
  if (record.erp_doc_kind !== 'timesheet') return { refs };

  const config = binding.config ?? {};
  const entries = record.entries ?? [];

  // (1) employee — via the CONFIRMED adopt link ONLY (FR-TSP-051). NEVER auto-create an HR master;
  //     NEVER a shared default (it would mis-attribute cost). 'proposed' is NOT authoritative: an
  //     ERP-side email edit may PROPOSE a link but must never silently re-point whose cost a week
  //     becomes. The org filter is in the QUERY, so a cross-org row cannot even be read (FR-TSP-054).
  const { data: employeeRow, error: employeeError } = await deps.serviceClient
    .from('erp_employees')
    .select('id, employee_number, org_id')
    .eq('org_id', deps.orgId)
    .eq('profile_id', record.user_id ?? '')
    .eq('link_state', 'confirmed')
    .maybeSingle();
  if (employeeError) throw new AppError(employeeError.message, employeeError.code);
  const employeeId = (employeeRow as { id?: string } | null)?.id;
  if (!employeeId) {
    throw new AppError(
      `no confirmed erp_employees link for user '${record.user_id ?? ''}' — an Admin must confirm it`,
      'employee-unlinked',
    );
  }
  // The ERP target comes from `external_refs`, never from a mirrored display column.
  const employeeExternalId = await resolveExternalRef(
    deps.serviceClient as unknown as ExternalRefsLookupClient,
    deps.orgId,
    'timesheets',
    employeeId,
  );
  if (!employeeExternalId) {
    throw new AppError(`employee '${employeeId}' has no external_refs mapping`, 'employee-unlinked');
  }
  refs.employee = employeeExternalId.startsWith('Employee:')
    ? employeeExternalId.slice('Employee:'.length)
    : employeeExternalId;

  // (2) activity type — mandatory at submit whenever `employee` is set (spike §1b), and P3b always
  //     sets it. Fail closed rather than let ERP reject the whole document after the claim.
  if (typeof config.default_activity_type !== 'string' || config.default_activity_type.length === 0) {
    throw new AppError('binding config has no default_activity_type', 'activity-type-unconfigured');
  }

  // (3) per-entry project — fail-closed. An unmapped project is a REJECT, never an omitted dimension.
  const projectMap = (config.project_map as Record<string, string> | undefined) ?? {};
  for (const entry of entries) {
    // (4) same-org pre-flight BEFORE the external write (FR-TSP-054). `project_org_id` comes from the
    //     gate RPC — server truth, never the payload.
    if (entry.project_org_id && entry.project_org_id !== deps.orgId) {
      throw new AppError(`project '${entry.project_id}' belongs to another org`, 'cross-org-link-rejected');
    }
    const erpProject = projectMap[entry.project_id];
    if (!erpProject) throw new AppError(`no project_map entry for project '${entry.project_id}'`, 'project-unmapped');
    refs[`project:${entry.project_id}`] = erpProject;
  }

  // (5) daily-hours pre-validation (FR-TSP-055): PMO caps a single entry at 24h but not a DAY's total
  //     across projects, and ERP caps neither (spike §7 — it accepts the spill 200-clean and quietly
  //     mis-dates the tail into the next ERP day). Run the real packing here so the rejection happens
  //     before the claim, not inside `toBody` after it.
  try {
    packTimeLogs(
      entries.map((e) => ({ project_id: e.project_id, entry_date: e.entry_date, hours: e.hours })),
      typeof config.timesheet_day_start === 'string' ? config.timesheet_day_start : '09:00:00',
    );
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : 'timesheet entries could not be packed', 'commit-rejected');
  }

  return { refs };
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

// ============================================================================
// P3c — the budget push (ADR-0055 §6 + ADR-0059 Posture B)
// ============================================================================

/** Is this command the budget push? (The map read + config extension below are gated on it so every
 *  other domain stays byte-for-byte: no extra DB round trip, no mutated `ctx.config`.) */
function isBudgetCommand(command: AdapterCommand): boolean {
  return (command.record as { erp_doc_kind?: string }).erp_doc_kind === 'budget';
}

/**
 * Read the org's `budget_category_account_map` (mig 0137) — the Admin-administered bijection that turns
 * PMO's `budget_category` into the client's own ERP account. It is a TABLE, not binding config, so it is
 * resolved SERVER-SIDE here and injected into `ctx.config`; the command payload never carries it (a
 * client-supplied map would let the caller pick which GL accounts their budget constrains).
 *
 * Fails CLOSED on a read error rather than proceeding with an empty map: "we could not read the map" and
 * "the org has no map" must both refuse the push (the second is refused downstream by
 * `resolveBudgetAccounts`, naming the categories).
 *
 * Exported so `adapter-dispatch/index.ts`'s budget gate (`budgetGate.ts`'s `runBudgetGate`) reads the
 * SAME map this factory injects into `ctx.config` — one definition, so a gate PASS can never be followed
 * by a push-time "actually unmapped" surprise.
 */
export async function readCategoryAccountMap(
  serviceClient: DispatchServiceClient,
  orgId: string,
): Promise<Array<{ category: string; erp_account: string }>> {
  const { data, error } = await serviceClient
    .from('budget_category_account_map')
    .select('category, erp_account')
    .eq('org_id', orgId);
  if (error) {
    throw new AppError(`budget push: the category→account map could not be read: ${error.message}`, 'commit-rejected');
  }
  return Array.isArray(data) ? (data as Array<{ category: string; erp_account: string }>) : [];
}

/**
 * Resolve the budget push's refs:
 *
 *  • `refs.project` — the ERP `Project` name for the version's project, via the SAME binding
 *    `project_map` the revenue path uses (`resolveErpProjectName` — one definition, so the two can never
 *    disagree about what "the ERP project resolved" means). A miss stays `null` and `bodies/budget.ts`
 *    refuses the push — never a Cost-Center fallback, never an unscoped budget.
 *
 *  • `refs.self` — ⚑ FR-BUD-121, THE UPSERT TARGET: the EXISTING live ERP `Budget` for this
 *    (company, fiscal_year, project) grain, if one is already there. ERPNext enforces at most one live
 *    `Budget` per (company, fiscal_year, project|cost_center, account) and rejects a duplicate
 *    ATOMICALLY (budget-write spike §8), so a revision dispatched as a plain create is REFUSED — and
 *    ERP then keeps enforcing the SUPERSEDED figure while PMO shows the revision. Resolving the target
 *    here (the refs seam, next to `refs.project`) is what lets `adapter.ts` route the create onto the
 *    spike-frozen revision path (§6: money fields are `allow_on_submit=0`, so a revision is
 *    cancel + create-with-`amended_from`, never a PUT).
 *
 * ⚑ Only `docstatus = 1` (SUBMITTED) is a valid upsert target. A DRAFT rival on the same grain is
 * somebody's Desk-authored work-in-progress: amending it is invalid and PUT-ing our body onto it would
 * mangle its child rows (spike §10(g) — a child update without the row's own `name` 404s against a
 * phantom). We leave it alone and let ERP's own `DuplicateBudgetError` refuse the push with a message
 * naming the conflict, which is a recorded, operator-actionable failure rather than a silent overwrite.
 *
 * ⚑ TWO live Budgets on one grain (only reachable by Desk authoring across disjoint accounts) fail
 * CLOSED: the adapter never picks one to supersede.
 */
async function resolveBudgetRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
  budgetConfig: Record<string, unknown>,
): Promise<{ refs: Record<string, string | null> }> {
  if (!isBudgetCommand(deps.command)) return { refs: {} };
  const record = deps.command.record as { projectId?: string | null; fiscal_year?: unknown; line_items?: unknown };
  const project = resolveErpProjectName(binding.config, record.projectId);
  const refs: Record<string, string | null> = { project };

  const company = binding.config?.company;
  const fiscalYear = record.fiscal_year;
  // Any of these unresolved ⇒ `budgetToBody` refuses the push anyway (fail-closed, zero ERP calls);
  // probing the grain with a missing coordinate would ask a question with no meaning.
  if (!project || typeof company !== 'string' || !company || typeof fiscalYear !== 'string' || !fiscalYear) {
    return { refs };
  }

  // ⚑ AC-BUD-011 ORDERING: every PMO-side fail-closed check runs BEFORE this ERP read, so an unmapped
  // category (or an empty budget) still refuses with ZERO ERP calls. Run the REAL resolution
  // (`resolveBudgetAccounts` — the same pure function `budgetToBody` uses, never a second copy of the
  // rule) rather than re-deriving it; identical stance to `resolveTimesheetRefs`'s `packTimeLogs`
  // pre-flight. An empty result is left for `budgetToBody` to reject with its own exact message.
  const accounts = resolveBudgetAccounts(
    (record.line_items as BudgetLineItem[] | undefined) ?? [],
    (budgetConfig.category_account_map as CategoryAccountMapRow[] | undefined) ?? [],
  );
  if (accounts.length === 0) return { refs };

  const existing = await listDocNamesByFilters(
    {
      fetchImpl: deps.fetchImpl,
      apiKey: deps.apiKey,
      apiSecret: deps.apiSecret,
      baseUrl: binding.site_url,
      rateLimiter: deps.rateLimiter,
    },
    'Budget',
    [
      ['company', '=', company],
      ['project', '=', project],
      ['fiscal_year', '=', fiscalYear],
      ['docstatus', '=', 1],
    ],
    2, // 2 is enough to DETECT ambiguity; we never need to enumerate more
  );
  if (existing.length > 1) {
    throw new AppError(
      `budget push: ${existing.length} live ERPNext Budgets already exist for (${company}, ${fiscalYear}, ${project}) — ` +
        `an operator must resolve the duplicate before PMO can revise it (${existing.join(', ')})`,
      'commit-rejected',
    );
  }
  if (existing.length === 1) refs.self = existing[0];
  return { refs };
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

  // Luna re-audit BLOCK 2 (+ round-7 B10, the procurement half) — the cross-org link pre-flight runs
  // FIRST: before ref resolution (which can issue ERP GETs), before the adapter is constructed, and
  // therefore before any ERP write or outbox commit. A cross-org link must never reach ERPNext (orphan
  // money, no PMO row) nor a service-role mirror insert (this org's org_id + another tenant's FK).
  await assertCommandLinksSameOrg(deps);
  // Luna re-audit BLOCK 4 — the SI project gate, likewise ahead of any ERP write.
  assertSiProjectGate(deps, binding);

  // Ref resolution (supplier/PO/PO-item) — task 5.3 wires the PO/GR case; slice 3 wires the
  // companies-domain party create/update path (which needs no cross-doctype resolution of its own).
  const { refs: procurementRefs, resolvedItems } = await resolveProcurementOrderRefs(deps, binding);
  const { refs: revenueRefs } = await resolveRevenueRefs(deps, binding);
  // P3b: the timesheet push's fail-closed pre-flight (employee link, per-entry project, activity type,
  // same-org, daily hours). Gated on the kind, so no other command pays for the extra reads.
  const { refs: timesheetRefs } = await resolveTimesheetRefs(deps, binding);
  // P3c: the org's server-resolved category→account map, then the budget push's refs (ERP project +
  // the FR-BUD-121 upsert target). Both are gated on the kind, so no other command pays for the extra
  // read or sees a modified `ctx.config`. ⚑ The map is resolved FIRST because the refs pre-flight
  // validates the line items against it before issuing its ERP grain read (AC-BUD-011: an unmapped
  // category refuses with zero ERP calls).
  const budgetConfig = isBudgetCommand(deps.command)
    ? { ...binding.config, category_account_map: await readCategoryAccountMap(deps.serviceClient, deps.orgId) }
    : binding.config;
  const { refs: budgetRefs } = await resolveBudgetRefs(deps, binding, budgetConfig);

  const adapterDeps: ErpAdapterDeps = {
    client: {
      fetchImpl: deps.fetchImpl,
      apiKey: deps.apiKey,
      apiSecret: deps.apiSecret,
      baseUrl: binding.site_url,
      rateLimiter: deps.rateLimiter,
    },
    doctypeBodies: deps.doctypeBodies ?? {},
    // Ref resolution: PO/GR commands (task 5.3, FR-ENA-103) resolve `refs`/`resolvedItems` above via
    // the case's `procurementId` (supplier + line items + PO/PO-item-child-row for a GR). Every other
    // kind — MR/RFQ/SQ (task 4.6/4.7, FR-ENA-111/112) — carries no `procurementId`, so `refs.supplier`
    // comes back unset there; fall back to resolving the command's own `vendorId` through the SAME
    // `companies` domain external_refs mapping (`resolveExternalRef`, task 1.6). The PO/GR path never
    // pays for this fallback call — `??` short-circuits once `refs.supplier` is already resolved.
    // Revenue commands (sales-invoice/incoming-payment) resolve customer + project + SI ref via
    // `resolveRevenueRefs` (task 2.3, FR-SAR-100/101/121).
    ctx: {
      refs: { ...procurementRefs, ...revenueRefs, ...budgetRefs, ...timesheetRefs, supplier: procurementRefs.supplier ?? (await resolveSupplierRef(deps.serviceClient, deps.orgId, deps.command)) },
      config: budgetConfig,
      resolvedItems,
    },
    afterSubmitHook: deps.afterSubmitHook,
  };
  return createErpAdapter(adapterDeps);
}

/** Strips the `"<Doctype>:<name>"` encoding (task 3.2's companies-domain adopt convention, reused
 *  generically by `adapter.ts`'s `parseExternalId`) down to the bare ERP `name` the body-builders
 *  expect in `ctx.refs.supplier`. Returns the value unmodified if it carries no doctype prefix. */
function stripDoctypePrefix(externalRecordId: string): string {
  const separatorIndex = externalRecordId.indexOf(':');
  return separatorIndex === -1 ? externalRecordId : externalRecordId.slice(separatorIndex + 1);
}

async function resolveSupplierRef(serviceClient: DispatchServiceClient, orgId: string, command: AdapterCommand): Promise<string | null> {
  const vendorId = (command.record as { vendorId?: unknown }).vendorId;
  if (typeof vendorId !== 'string' || vendorId.length === 0) return null;
  const externalRecordId = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'companies', vendorId);
  return externalRecordId ? stripDoctypePrefix(externalRecordId) : null;
}
