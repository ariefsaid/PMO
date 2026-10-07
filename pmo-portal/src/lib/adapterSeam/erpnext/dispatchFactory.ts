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
import { getDoc, listDocsByFilters, type ErpClientDeps, type ErpRateLimiter } from './client.ts';
import type { ErpProbeDeps } from './recoveryProbe.ts';
import { findPmoRecordId, resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import { packTimeLogs } from './timeLogPacking.ts';
import { readProcessGates } from './processGates.ts';
import type { Adapter, AdapterCommand } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import { AppError } from '../../appError.ts';
import { fetchAllRowsByKeyset } from '../../pagedRead.ts';
import { resolveBudgetAccounts, type BudgetLineItem, type CategoryAccountMapRow } from '../../budget/categoryAccountMap.ts';
import { listErpItems, validateItemLines } from './itemCatalog.ts';
import { readNegativeRatesAllowed } from './erpSellingSettings.ts';
import { resolveSalesTaxRows, type ErpTaxRow } from './erpSalesTaxRows.ts';
import { buildEnteredPurchaseTaxRows, ENTERED_TAX_AND_TEMPLATE, findDefaultPurchaseTaxTemplate, parseEnteredPurchaseTax, resolvePurchaseTaxRows, type ErpPurchaseTaxRow } from './erpPurchaseTaxRows.ts';
import { piBodyCarriesTaxes } from './bodies/purchaseInvoice.ts';
import { itemsNetTotal, lineRate, type ItemsNetLine } from '../../itemsNet.ts';
import { progressClaimItems, type ProgressClaimLineRecord, type ProgressClaimRecord } from './progressClaimItems.ts';

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
  eq(column: string, value: string | boolean): DispatchFilterBuilder;
  order(column: string, opts?: { ascending?: boolean }): DispatchFilterBuilder;
  limit(n: number): DispatchFilterBuilder;
  /** The KEYSET cursor: resume strictly AFTER the last row of the previous page. */
  gt(column: string, value: string): DispatchFilterBuilder;
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
  description?: string;
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
  const { data, error } = await serviceClient.from('procurement_items').select('name,quantity,rate,description').eq('procurement_id', procurementId);
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ name: string; quantity: number | string; rate: number | string | null; description?: string | null }>).map((row) => ({
    item_code: row.name,
    qty: row.quantity,
    rate: row.rate ?? undefined,
    ...(row.description ? { description: row.description } : {}),
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
type LinkField = 'customerId' | 'projectId' | 'salesInvoiceId' | 'workOrderId' | 'procurementId' | 'vendorId' | 'invoiceId';

const LINK_TABLE: Readonly<Record<LinkField, string>> = {
  customerId: 'companies',
  projectId: 'projects',
  salesInvoiceId: 'sales_invoices',
  workOrderId: 'work_orders',
  procurementId: 'procurements',
  vendorId: 'companies',
  invoiceId: 'procurement_invoices',
};

/** The links each ERPNext domain's commands can carry (the fields `readModelWriters` copies into the
 *  service-role mirror insert). `companies` (supplier/customer parties) carries none. */
const DOMAIN_LINK_FIELDS: Readonly<Record<string, ReadonlyArray<LinkField>>> = {
  revenue: ['customerId', 'projectId', 'salesInvoiceId', 'workOrderId'],
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
  // #775 phase B — Employee Payment Entries (the expense postings' Pay/Receive twins).
  'expense-payment': 'Pay',
  'expense-receipt': 'Receive',
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

/** Resolve the client PO before the outbox snapshots and digests this command. The invoice's
 *  linked work order is read from PMO, and every source read is scoped to the dispatching org.
 *  Matching the reference back to its source preserves its date after ERP readback mirrors po_no
 *  onto reference_number; an unrelated explicit invoice reference carries no borrowed date. */
async function resolveSalesInvoicePo(deps: ErpDispatchFactoryDeps): Promise<void> {
  const record = deps.command.record;
  const read = async (table: string, columns: string, id: string) => {
    const { data, error } = await deps.serviceClient.from(table).select(columns)
      .eq('org_id', deps.orgId).eq('id', id).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    return data as Record<string, unknown> | null;
  };
  const nonblank = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  const invoice = await read('sales_invoices', 'reference_number,work_order_id,project_id', record.id);
  // #766: a claim invoice has no mirror row yet on its first push; its work order rides on the record.
  const workOrderId = nonblank(invoice?.work_order_id) ?? nonblank(record.workOrderId);
  const projectId = nonblank(record.projectId) ?? nonblank(invoice?.project_id);
  const workOrder = workOrderId
    ? await read('work_orders', 'client_po_number,order_date', workOrderId)
    : null;
  const project = projectId
    ? await read('projects', 'customer_contract_ref,contract_date', projectId)
    : null;

  const invoiceReference = nonblank(Object.hasOwn(record, 'reference_number')
    ? record.reference_number
    : invoice?.reference_number);
  const workOrderReference = nonblank(workOrder?.client_po_number);
  const projectReference = nonblank(project?.customer_contract_ref);
  const reference = invoiceReference ?? workOrderReference ?? projectReference;
  const date = reference !== null && reference === workOrderReference
    ? nonblank(workOrder?.order_date)
    : reference !== null && reference === projectReference
      ? nonblank(project?.contract_date)
      : null;

  // These are command material: both the HTTP body and the persisted outbox payload/digest read
  // the same resolved values. A caller-supplied po_date is replaced by the matching PMO date.
  record.reference_number = reference;
  record.po_date = date;

  // #767 (AC-DUE-003): a recorded receipt date rides along as ERP's `custom_received_date`. `due_date`
  // is deliberately NOT pushed: ERPNext refuses a due date past the customer's payment-terms default
  // (party.py `validate_due_date_with_template`, "Due Date cannot be after …") — so sending one would
  // fail the amend of any invoice whose customer has a terms template — and `due_date` is not
  // `allow_on_submit`, so it could never follow a receipt recorded after submission anyway. ERP keeps
  // its own due date; PMO shows the receipt-based one (`deriveArDueDate`). Proposed DD-DUE-1.
  const stamp = await read('sales_invoices', 'received_date', record.id);
  const received = nonblank(stamp?.received_date);
  delete record.received_date;
  delete record.due_date;
  if (received) record.received_date = received;
}

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
    if (buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: deps.command.record.verb } })) {
      await resolveSalesInvoicePo(deps);
    }
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

/** The PMO user's CONFIRMED ERP Employee (FR-TSP-051; reused by #775 phase B, FR-EXP-106). `proposed` is never
 *  authoritative; the org filter is in the query; the ERP name comes from `external_refs`, never a mirror column. */
export type ConfirmedEmployeeLookup =
  | { status: 'no-link' }
  | { status: 'no-ref'; employeeId: string }
  | { status: 'ok'; employee: string };

export async function lookupConfirmedErpEmployee(
  serviceClient: DispatchServiceClient,
  orgId: string,
  profileId: string,
): Promise<ConfirmedEmployeeLookup> {
  const { data, error } = await serviceClient
    .from('erp_employees')
    .select('id, employee_number, org_id')
    .eq('org_id', orgId)
    .eq('profile_id', profileId)
    .eq('link_state', 'confirmed')
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const employeeId = (data as { id?: string } | null)?.id;
  if (!employeeId) return { status: 'no-link' };
  // The ERP target comes from `external_refs`, never from a mirrored display column.
  const external = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'timesheets', employeeId);
  if (!external) return { status: 'no-ref', employeeId };
  return { status: 'ok', employee: external.startsWith('Employee:') ? external.slice('Employee:'.length) : external };
}

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
  const lookup = await lookupConfirmedErpEmployee(deps.serviceClient, deps.orgId, record.user_id ?? '');
  if (lookup.status === 'no-link') {
    throw new AppError(
      `no confirmed erp_employees link for user '${record.user_id ?? ''}' — an Admin must confirm it`,
      'employee-unlinked',
    );
  }
  if (lookup.status === 'no-ref') {
    throw new AppError(`employee '${lookup.employeeId}' has no external_refs mapping`, 'employee-unlinked');
  }
  refs.employee = lookup.employee;

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

/** PO/PI cost dimensions use the same project-map resolver and org guard as the revenue path.
 *  The procurement case owns its project; a caller cannot redirect that case's costs. */
async function resolvePurchaseProjectRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record;
  if (record.erp_doc_kind !== 'purchase-order' && record.erp_doc_kind !== 'purchase-invoice') return { refs };
  // PO/PI share SI's body-building operations; submit/cancel act on the existing ERP document.
  if (!buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: record.verb } })) return { refs };

  let projectId = typeof record.projectId === 'string' ? record.projectId : null;
  if (typeof record.procurementId === 'string' && record.procurementId) {
    const { data, error } = await deps.serviceClient.from('procurements').select('project_id')
      .eq('org_id', deps.orgId).eq('id', record.procurementId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (!data) throw new AppError('the procurement project reference is unavailable', 'cross-org-link-rejected');
    projectId = (data as { project_id?: string | null }).project_id ?? null;
  }
  if (!projectId) return { refs }; // Existing project-less cases remain valid.
  await assertLinkBelongsToOrg(deps.serviceClient, deps.orgId, 'projects', projectId);
  const project = resolveErpProjectName(binding.config, projectId);
  if (typeof project !== 'string' || !project.trim()) {
    throw new AppError('the procurement project has no ERP project mapping', 'project-unmapped');
  }
  refs.project = project;
  return { refs };
}

/** Resolve the PO/PI supplier/items and GR refs this command needs (task 5.3). Returns the `ctx.refs` additions +
 *  `resolvedItems` (only set when the command carried none — `adapter.ts`'s fallback substitutes it). */
async function resolveProcurementOrderRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null>; resolvedItems?: ResolvedLineItem[] }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as { erp_doc_kind?: string; procurementId?: string; items?: unknown[]; date?: string };
  const kind = record.erp_doc_kind;
  const procurementId = record.procurementId;
  if ((kind !== 'purchase-order' && kind !== 'goods-receipt' && kind !== 'purchase-invoice') || !procurementId) return { refs };

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
 * Read the org's PUSH accounts from `budget_category_account_map` (0137, #768) — the Admin-administered map
 * that turns PMO's `budget_category` into the client's own ERP account. A category may list several accounts
 * (its actuals sum across all of them, 0153); exactly the ONE flagged `is_push_target` (at most one per
 * category, 0246's partial unique index) receives the pushed budget. Read-only accounts never reach the body.
 * It is a TABLE, not binding config, so it is resolved SERVER-SIDE here and injected into `ctx.config`; the
 * command payload never carries it (a client-supplied map would let the caller pick which GL accounts their
 * budget constrains).
 *
 * Fails CLOSED on a read error rather than proceeding with an empty map: "we could not read the map" and
 * "the org has no push account for X" must both refuse the push (the second is refused downstream by
 * `resolveBudgetAccounts`, naming the categories).
 *
 * Exported so `adapter-dispatch/index.ts`'s budget gate and `erpnext-sweep` read the SAME map this factory
 * injects into `ctx.config` — one definition, so a gate PASS can never be followed by a push-time surprise.
 */
export async function readCategoryAccountMap(
  serviceClient: DispatchServiceClient,
  orgId: string,
): Promise<Array<{ category: string; erp_account: string }>> {
  const { data, error } = await serviceClient
    .from('budget_category_account_map')
    .select('category, erp_account')
    .eq('org_id', orgId)
    .eq('is_push_target', true);
  if (error) {
    throw new AppError(`budget push: the category→account map could not be read: ${error.message}`, 'commit-rejected');
  }
  return Array.isArray(data)
    ? (data as Array<{ category: string; erp_account: string }>).map((r) => ({ category: r.category, erp_account: r.erp_account }))
    : [];
}

/**
 * Read a budget version's line items — the SOURCE of every `budget_amount` PMO pushes into the
 * client's ERP `Budget`, and the input the fail-closed `budget-category-unmapped` check judges.
 *
 * ⚑ PAGED (audit round 8, the HIGH-1 class swept to its fourth scope). One unpaged request is
 * silently capped at PostgREST's `db-max-rows` (1000) — 200, short body, no error — so a version with
 * more than 1000 line items would push an UNDERSTATED Budget and let ERP enforce a real overspend
 * control against a figure smaller than the one PMO approved. Ordered on the `id` PK so consecutive
 * pages can neither overlap (a duplicated line = over-budget) nor gap.
 *
 * Fails CLOSED on a read error. It previously returned `[]` on ANY non-array result, which is the same
 * shape of hole: an unreadable budget must refuse the push, never push a smaller one.
 *
 * Exported (the `readCategoryAccountMap` precedent) so `adapter-dispatch`'s budget gate uses the
 * SHIPPED reader rather than a copy inside the edge function.
 */
export async function readBudgetLineItems(
  callerClient: DispatchServiceClient,
  versionId: string,
): Promise<BudgetLineItem[]> {
  return await fetchAllRowsByKeyset<BudgetLineItem & { id: string }>((afterId, limit) => {
    const q = callerClient
      .from('budget_line_items')
      // ⚑ BFY (FR-BFY-010/011/030): `fiscal_year` is READ here or the gate can never see a phased
      // line — it would classify every multi-FY project as un-phased and refuse a budget the operator
      // has correctly phased. This is the ONE reader `runBudgetGate` is wired to.
      .select('id, category, budgeted_amount, fiscal_year')
      .eq('budget_version_id', versionId)
      .order('id', { ascending: true });
    return (afterId === null ? q : q.gt('id', afterId))
      .limit(limit) as PromiseLike<{ data: Array<BudgetLineItem & { id: string }> | null; error: { message: string; code?: string } | null }>;
  });
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
  const record = deps.command.record as {
    id?: unknown;
    projectId?: string | null;
    fiscal_year?: unknown;
    line_items?: unknown;
    /** FR-BFY-032: the year-qualified outbox/external_refs identity, derived at the served boundary. */
    outbox_identity?: unknown;
  };
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

  // ⚑ HIGH-1 (audit round 5) — READ THE WHOLE GRAIN, not just its live occupant: `docstatus < 2` is
  // every document ERPNext's duplicate guard counts (spike §8 — the guard fires against a DRAFT exactly
  // as it does against a submitted doc). The old `docstatus = 1` filter was blind to drafts, with two
  // consequences, both destructive: a Desk-authored draft (or OUR OWN orphan draft, left by a
  // create-OK/submit-FAIL) made the replacement create CERTAIN to be refused — so the upsert cancelled
  // the live Budget FIRST and only then discovered it could not replace it, leaving ERPNext enforcing
  // NOTHING; and the orphan then blocked every future push for the grain with an opaque
  // `DuplicateBudgetError` no PMO surface explained.
  const clientDeps: ErpClientDeps = {
    fetchImpl: deps.fetchImpl,
    apiKey: deps.apiKey,
    apiSecret: deps.apiSecret,
    baseUrl: binding.site_url,
    rateLimiter: deps.rateLimiter,
  };
  const grain = await listDocsByFilters(
    clientDeps,
    'Budget',
    [
      ['company', '=', company],
      ['project', '=', project],
      ['fiscal_year', '=', fiscalYear],
      ['docstatus', '<', 2],
    ],
    // ⚑ MED-1 (round 6): `amended_from` carries the draft's LINEAGE. ⚑ LOW-1 (round 7): `owner` carries
    // its AUTHOR — the half that was missing, and the half that decides whether adopting it would
    // overwrite a human's work. Both are plain list fields: one read, zero extra calls.
    ['name', 'docstatus', 'amended_from', 'owner'],
    5, // a handful is plenty to classify the grain; we never need to enumerate it
  );
  const live = grain.filter((row) => Number(row.docstatus) === 1).map((row) => String(row.name));
  const draftRows = grain.filter((row) => Number(row.docstatus) === 0);
  const drafts = draftRows.map((row) => String(row.name));

  // (iii) Genuine ambiguity — two live Budgets, only reachable by Desk authoring across disjoint
  // accounts. Fail CLOSED, zero writes: the adapter never picks one to supersede.
  if (live.length > 1) {
    throw new AppError(
      `budget push: ${live.length} live ERPNext Budgets already exist for (${company}, ${fiscalYear}, ${project}) — ` +
        `an operator must resolve the duplicate before PMO can revise it (${live.join(', ')})`,
      'commit-rejected',
    );
  }

  // (ii) A DRAFT rival — ours (an orphaned create-OK/submit-FAIL) or somebody's Desk work-in-progress.
  // Either way ERP WILL refuse our create, so attempting the push is a guaranteed-destructive act: we
  // would cancel the live Budget and then be unable to replace it. Refuse BEFORE any write, and NAME the
  // document, because a draft on the grain is a thing a human must resolve (submit it, or delete it) and
  // an opaque ERP 417 five minutes later tells them nothing. We deliberately do NOT adopt-and-submit it:
  // `Budget` carries no anchor field of any kind (spike §7), so we cannot PROVE a draft is ours, and
  // submitting somebody's WIP would enforce THEIR figure while PMO recorded it as our push.
  //
  // ⚑ DO NOT RE-ADD AUTOMATIC ADOPTION HERE WITHOUT READING THIS (audit rounds 6→7, DIRECTOR RULING).
  // Round 6 added exactly that: a lone draft was adopted when its `amended_from` matched the ERP name on
  // our own `budget_version_erp_mirror` row. It was deleted in round 7 because it was incapable of doing
  // its job and capable of real harm:
  //   • UNREACHABLE where it was needed. `erp_budget_name` has exactly ONE writer — the SUCCESS path
  //     (`adapter-dispatch/readModelWriters.ts`) — and `activate_budget_version` admits only a Draft
  //     version (`0005`/`0139`), so a version is activated ONCE, pushed under ONE idempotency key, and
  //     its mirror row carries a name only after a push SUCCEEDED. Window B is by definition a push that
  //     did not succeed, so the name is null and the branch could never fire for its own use case.
  //   • HARMFUL where it WAS reachable. The one state that satisfies it is: our push succeeded (name
  //     recorded), then a Desk user cancelled that Budget and hand-started its amendment. `amended_from`
  //     identifies a draft's PARENT, never its AUTHOR — so PMO would PUT its own figures over the
  //     accountant's work and submit it. Live-bench-verified (frappe 15.96.0/erpnext 15.94.3): both the
  //     PUT and the submit return 200. That is precisely what FR-BUD-142 forbids.
  // A real automatic recovery needs, at minimum: (a) a DISTINCT mirror column recording the document we
  // created at create-time — never `erp_budget_name`, which the projection renders as THE enforcing ERP
  // document, so a draft's name there would be a confident false claim about ERP state; (b) an
  // authorship proof, since lineage is not ownership — the draft's server-stamped `owner` must equal the
  // user our credentials authenticate as (`frappe.auth.get_logged_user`), which the grain list query
  // above can return as a plain field; and (c) an `after-create-before-submit` fault seam, since window B
  // is otherwise undrivable end to end. That is a slice, not a patch. Until then this refusal — named,
  // zero-write, and telling the human exactly which document to submit or delete — is the correct
  // behaviour, and `dispatchFactory.budgetRecovery.test.ts` guards it.
  if (drafts.length > 0) {
    throw new AppError(
      `budget push: ERPNext already holds a DRAFT Budget for (${company}, ${fiscalYear}, ${project}) — ` +
        `${drafts.join(', ')}. ERPNext refuses a second Budget on this grain while a draft exists, so PMO ` +
        'cannot revise the budget until an operator submits or deletes that draft.' +
        (live.length === 0
          ? ' ⚑ There is currently NO live Budget for this project and fiscal year — ERPNext is enforcing no overspend control on it.'
          : ''),
      'budget-draft-rival-on-grain',
    );
  }

  // (i) Exactly one live occupant ⇒ THE upsert target — but ONLY if PMO OWNS it (FR-BFY-076, review
  // finding 7).
  //
  // ⚑ OCCUPANCY IS NOT OWNERSHIP. `refs.self` routes the create onto `commitEditResolved`, which for a
  // SUBMITTED target is cancel + create-with-`amended_from` — so accepting any live occupant meant a
  // Budget an accountant authored directly in Desk was CANCELLED and REPLACED with PMO's figures, and
  // then recorded as PMO's own push. That is the symmetric case to the draft rival below: the draft is
  // refused because ERP would refuse us; the unowned LIVE document must be refused because ERP would
  // NOT. Live-bench-verified (frappe 15.96.0/erpnext 15.94.3): both the cancel and the amend return 200.
  //
  // The ownership witness is PMO's OWN `external_refs` mapping for this domain and this YEAR-QUALIFIED
  // identity — the row `record_outbox_ref` writes when PMO creates the document. Judged on the
  // year-qualified identity, never the bare version id: after the identity re-key a bare row is stale,
  // and a mapping for a DIFFERENT year says nothing about this one.
  //
  // ⚑ `owner` is deliberately NOT the test. It is the ERP user our API credentials authenticate as, and
  // a client whose accountant shares that user (or a PMO document later touched in Desk) would classify
  // wrongly in BOTH directions. PMO's own creation record is the only evidence PMO actually holds.
  if (live.length === 1) {
    // ⚑ THE WITNESS IS A REVERSE LOOKUP, and it has to be. `external_refs` is keyed on the
    // year-qualified `<budget_version_id>:<encoded_fy>`, and a REVISION is a NEW version — so asking
    // "is THIS version-year mapped?" would answer no for PMO's own prior document and refuse every
    // legitimate revise (the FR-BUD-121 upsert path, the ordinary way a budget changes). The fact that
    // actually matters is "did PMO create the document that is sitting on the grain", which is exactly
    // `external_refs(org, 'budget', external_record_id = <that document>)` — version-independent, and
    // unique by construction (0093's `unique(org_id, domain, external_record_id)`). Reported as a
    // deviation from the spec's literal "mapping for this year-qualified pmo_record_id" wording.
    const owner = await findPmoRecordId(
      deps.serviceClient as unknown as ExternalRefsLookupClient,
      deps.orgId,
      'budget',
      live[0],
    );
    if (owner === null) {
      throw new AppError(
        `budget push: ERPNext already holds a LIVE Budget for (${company}, ${fiscalYear}, ${project}) — ${live[0]} — ` +
          'that PMO did not create. PMO will not cancel or amend a Budget it does not own: an operator must ' +
          'either remove that document or accept it as the authority for this project and fiscal year.',
        'budget-unowned-live-occupant',
      );
    }
    refs.self = live[0];
  }
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
  /** Threaded straight into `ErpAdapterDeps.afterCancelHook` (⚑ HIGH-1 — the `after-cancel-before-create`
   *  fault seam). Optional; omitted callers are a true no-op. */
  afterCancelHook?: () => Promise<void>;
  /** #858: a sweep recovery of an already-persisted command. A sales-invoice create then keeps the server-built `items`/`taxes`
   *  the outbox payload already carries (they are inside its digest) and makes no ERPNext read; only the foreground create resolves them. */
  replay?: boolean;
}

/**
 * #762 — the currencies of the two accounts a withholding receipt posts between. DD-RCPT-1's shape (the
 * cash in both headers, the tax as a deduction) holds only when they match; `peReceiveToBody` refuses
 * otherwise. Read only for a receipt with tax withheld, so no other command pays for the two reads.
 */
async function readReceiptAccountCurrencies(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ paid_from_account_currency: string | null; paid_to_account_currency: string | null }> {
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  const currencyOf = async (account: unknown): Promise<string | null> => {
    if (typeof account !== 'string' || !account) return null;
    const currency = (await getDoc(client, 'Account', account) as { account_currency?: unknown } | null)?.account_currency;
    return typeof currency === 'string' && currency ? currency : null;
  };
  const config = binding.config ?? {};
  return {
    paid_from_account_currency: await currencyOf(config.default_receivable_account),
    paid_to_account_currency: await currencyOf(config.default_cash_account ?? config.default_bank_account),
  };
}

/**
 * #766 / ADR-0077 — a Sales Invoice whose PMO record id is a billing claim's id IS that claim's invoice.
 * Its lines come from the claim alone and are rebuilt on EVERY resolution (a sweep recovery re-derives the
 * identical payload and digest); the caller's project and customer must be the claim's; the claim must carry
 * evidence (the outbox fence is the database half of this rule); and nothing but a create may build its
 * body — a wrong claim invoice is cancelled and a new claim raised (DD-PBL-7).
 */
const MAX_CLAIM_LINES = 500;
function taxBaseFraction(row: unknown): { numerator: number; denominator: number } {
  const r = (row ?? {}) as { tax_base_numerator?: unknown; tax_base_denominator?: unknown };
  const numerator = Number(r.tax_base_numerator ?? 1);
  const denominator = Number(r.tax_base_denominator ?? 1);
  return numerator > 0 && denominator >= numerator ? { numerator, denominator } : { numerator: 1, denominator: 1 };
}
/** A project that is subject to VAT is never invoiced untaxed: no ERP company or no default template is a setup action, not a free pass. */
const MISSING_TAX_SETUP = 'This project is subject to VAT, but ERPNext has no default Sales Taxes and Charges template for this company. Set a default Sales Taxes and Charges template in ERPNext for this company (or switch the project off VAT before its first invoice), then raise the invoice again.';
function requireTaxRows(rows: ErpTaxRow[]): ErpTaxRow[] {
  if (rows.length === 0) throw new AppError(MISSING_TAX_SETUP, 'config-rejected');
  return rows;
}

/**
 * #856 / OD-TAX-4 — an ordinary (non-claim) Sales Invoice create gets the same explicit tax rows a claim invoice does (ERPNext
 * does not expand a template over REST, so without them the client is billed untaxed). The project's "Subject to VAT" flag is
 * the gate: OFF sends NO rows and makes no template read; ON builds them with `resolveSalesTaxRows` at the project's
 * reduced-base fraction (0227). The flag is read server-side — a caller's value is never consulted, and a caller's `taxes`
 * was already stripped. Rows are built before the outbox snapshot, so the payload and digest cover them. Edits and amends send none.
 */
async function resolveOrdinaryInvoiceTaxes(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
  record: Record<string, unknown>,
): Promise<void> {
  const company = binding.config?.company;
  if (deps.command.operation !== 'create') return;
  let fraction = { numerator: 1, denominator: 1 };
  if (typeof record.projectId === 'string' && record.projectId) {
    const { data, error } = await deps.serviceClient.from('projects')
      .select('subject_to_vat,tax_base_numerator,tax_base_denominator')
      .eq('org_id', deps.orgId).eq('id', record.projectId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if ((data as { subject_to_vat?: unknown } | null)?.subject_to_vat === false) return;
    fraction = taxBaseFraction(data);
  }
  if (typeof company !== 'string' || !company) throw new AppError(MISSING_TAX_SETUP, 'config-rejected');
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  record.taxes = requireTaxRows(await resolveSalesTaxRows(client, company, fraction));
}

/**
 * #520 + #876 slice 2 — the tax a vendor invoice create on a flipped org sends. Exactly one of:
 *   • a user-chosen ERPNext Purchase Taxes and Charges Template (#520): resolved, validated against the binding's
 *     company and expanded into its rows here;
 *   • the VAT / PPh AMOUNTS the user entered (DD-VWH-13): fixed `Actual` rows on the org's tax accounts, marked
 *     `taxesFromAmounts` so `piToBody` sends them with an empty template;
 *   • neither: a create naming neither is where ERPNext would apply the company's own default. #915: PMO looks that
 *     default up (the sales side's read) and runs it through the SAME resolver/validator a chosen template gets,
 *     BEFORE any ERP write — a malformed default used to be refused only by the database mirror AFTER the bill had
 *     posted (fail-closed, manual repair). None found (or no ERP company to look one up for) → unchanged: nothing is
 *     sent and the bill posts untaxed, as AC-520-2 and DD-VWH-15/DD-VI-3 keep for non-form callers.
 * Both is refused before any ERP call. Rows and the marker are written onto the record BEFORE the outbox snapshot, so
 * the payload and digest cover them and a sweep replay re-sends them with no ERPNext read. A caller's `taxes` and
 * `taxesFromAmounts` are always dropped; edits and amends send none.
 */
async function resolvePurchaseInvoiceTaxes(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, resolvedItems: ResolvedLineItem[] | undefined,
): Promise<void> {
  const record = deps.command.record as Record<string, unknown>;
  if (record.erp_doc_kind !== 'purchase-invoice') return;
  if (deps.replay && deps.command.operation === 'create') {
    // #915 fix round: a replay of a create whose persisted body sends NO tax fields (e.g. the earlier
    // "no default found" refusal stored no marker) lets ERPNext apply the company's CURRENT default at
    // POST time — so that default is looked up and validated here, before the re-POST, with the create
    // path's own refusals. Deliberately validate-only: the persisted record, body and digest are never
    // mutated (a valid default is ERPNext's to apply; `piBodyCarriesTaxes` is the body predicate this
    // mirrors, so the gate cannot drift from the body it guards).
    if (!piBodyCarriesTaxes(record)) await validateCurrentDefaultPurchaseTaxTemplate(deps, binding);
    return;
  }
  delete record.taxes;
  delete record.taxesFromAmounts;
  const chosen = typeof record.taxTemplate === 'string' ? record.taxTemplate.trim() : '';
  const entered = deps.command.operation === 'create' ? parseEnteredPurchaseTax(record) : null;
  if (deps.command.operation !== 'create' || (!chosen && !entered)) {
    for (const key of ['taxTemplate', 'vatAmount', 'withheldAmount', 'pphType']) delete record[key];
    if (deps.command.operation === 'create') await sendDefaultPurchaseTaxTemplate(deps, binding, record);
    return;
  }
  if (chosen && entered) throw new AdapterError('commit-rejected', ENTERED_TAX_AND_TEMPLATE);
  const company = binding.config?.company;
  if (typeof company !== 'string' || !company) {
    throw new AppError(chosen
      ? 'ERPNext has no company set for this organization, so the chosen purchase tax template cannot be checked. Set the ERP company in Administration → Integrations, then record the invoice again.'
      : 'ERPNext has no company set for this organization, so the vendor invoice tax cannot be checked. Set the ERP company in Administration → Integrations, then record the invoice again.',
    'config-rejected');
  }
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  if (chosen) {
    record.taxTemplate = chosen;
    record.taxes = await resolvePurchaseTaxRows(client, company, chosen);
    return;
  }
  if (!entered) return;
  delete record.taxTemplate;
  // The items the PI will carry: the command's own, else the case's (adapter.ts substitutes `resolvedItems`).
  const lines = (Array.isArray(record.items) && record.items.length > 0 ? record.items : resolvedItems ?? []) as ItemsNetLine[];
  // Both refusals land BEFORE any read (ADR-0072 style, DD-VWH-22): an unpriced line must not count as 0 — it
  // would understate the base the withheld bound checks against — and an unknown total (a line without a
  // quantity) must not SKIP the bound — ERPNext would accept the bill and every replay would then refuse it.
  if (lines.some((line) => lineRate(line) === null)) {
    throw new AppError('This case has unpriced lines: give every line a rate, then record the invoice again.', 'config-rejected');
  }
  const itemsTotal = itemsNetTotal(lines);
  if (lines.length > 0 && itemsTotal === null) {
    throw new AdapterError('commit-rejected', "The vendor invoice's items total cannot be computed: a line is missing its quantity. Complete the case's lines, then record the invoice again.");
  }
  const { data, error } = await deps.serviceClient.from('organizations')
    .select('input_vat_account,pph23_payable_account,pph4_2_payable_account').eq('id', deps.orgId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const settings = (data ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  record.taxes = await buildEnteredPurchaseTaxRows(client, company, entered, {
    inputVat: text(settings.input_vat_account), pph23: text(settings.pph23_payable_account), pph4_2: text(settings.pph4_2_payable_account),
  }, itemsTotal);
  record.taxesFromAmounts = true;
  record.vatAmount = entered.vatAmount;
  record.withheldAmount = entered.withheldAmount;
  record.pphType = entered.pphType;
}

/**
 * #915 — the ERP company's CURRENT default Purchase Taxes and Charges Template, resolved through the
 * SAME validator a chosen template goes through (`findDefaultPurchaseTaxTemplate` +
 * `resolvePurchaseTaxRows`, so a malformed default refuses `config-rejected` with the chosen path's
 * exact wording, naming the template — never the company, ADR-0072). Null when no ERP company is
 * configured to look one up for, or no default exists — callers treat that as "send nothing".
 */
async function resolveCurrentDefaultPurchaseTax(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow,
): Promise<{ template: string; rows: ErpPurchaseTaxRow[] } | null> {
  const company = binding.config?.company;
  if (typeof company !== 'string' || !company) return null;
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  const template = await findDefaultPurchaseTaxTemplate(client, company);
  if (!template) return null;
  return { template, rows: await resolvePurchaseTaxRows(client, company, template) };
}

/** #915 fix round — the replay gate: validate the current default, write NOTHING anywhere. */
async function validateCurrentDefaultPurchaseTaxTemplate(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow,
): Promise<void> {
  await resolveCurrentDefaultPurchaseTax(deps, binding);
}

/**
 * #915 — the create-naming-neither path: resolve the ERP company's default Purchase Taxes and Charges Template through
 * the same validator a chosen template goes through, so a malformed default is refused BEFORE the ERP write instead of
 * by the database mirror after the bill posted. The refusals and wording are the chosen path's own (`config-rejected`,
 * naming the template). No default — or no company configured to look one up for — sends nothing, exactly as before.
 */
async function sendDefaultPurchaseTaxTemplate(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, record: Record<string, unknown>,
): Promise<void> {
  const resolved = await resolveCurrentDefaultPurchaseTax(deps, binding);
  if (!resolved) return;
  record.taxTemplate = resolved.template;
  record.taxes = resolved.rows;
}

/** #858: the currency ERPNext will bill the customer in: the Customer's default currency, else the Company's. */
async function assertClaimCurrencyMatchesErp(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, client: ErpClientDeps, claimCurrency: string | undefined, customerId: unknown, subject: 'claim' | 'invoice' = 'claim',
): Promise<void> {
  const externalId = typeof customerId === 'string'
    ? await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'companies', customerId) : null;
  const customerName = externalId?.startsWith('Customer:') ? externalId.slice('Customer:'.length) : externalId;
  const pick = (doc: unknown): string | null => {
    const value = (doc as { default_currency?: unknown } | null)?.default_currency;
    return typeof value === 'string' && value ? value : null;
  };
  let erpCurrency = customerName ? pick(await getDoc(client, 'Customer', customerName)) : null;
  const company = binding.config?.company;
  if (!erpCurrency && typeof company === 'string' && company) erpCurrency = pick(await getDoc(client, 'Company', company));
  if (!erpCurrency) {
    throw new AppError('PMO cannot tell which currency ERPNext bills this customer in. Set a default currency on the customer (or the company) in ERPNext, then raise the invoice again.', 'config-rejected');
  }
  if (erpCurrency !== claimCurrency) {
    throw new AppError(`This ${subject} is in ${claimCurrency ?? 'an unknown currency'}, but ERPNext bills this customer in ${erpCurrency}. Align the customer's default currency in ERPNext with the project currency (or raise the ${subject} from a project in ${erpCurrency}), then raise the invoice again.`, 'config-rejected');
  }
}

/**
 * #866: an ordinary invoice create is stated in its project's currency (the org's default when it has no project). Refuse a
 * mismatch with the customer's ERPNext billing currency before any write, and put the currency on the record so the body
 * (and so the persisted outbox payload a replay re-sends) carries it explicitly.
 * OD-BILL-1: an edit or amend (it rebuilds the body; the caller only reaches here for those) is stated in the invoice's
 * own mirrored currency, so ERPNext refuses a re-denomination and the work-order fence (0262) compares currencies.
 */
async function resolveOrdinaryInvoiceCurrency(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, record: Record<string, unknown>,
): Promise<void> {
  if (deps.command.operation !== 'create') {
    const { data, error } = await deps.serviceClient.from('sales_invoices').select('currency')
      .eq('org_id', deps.orgId).eq('id', record.id as string).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    const value = (data as { currency?: unknown } | null)?.currency;
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      throw new AppError('PMO cannot tell which currency this invoice is in. Refresh the invoice from ERPNext, then edit it again.', 'config-rejected');
    }
    record.currency = value;
    return;
  }
  const projectId = typeof record.projectId === 'string' && record.projectId ? record.projectId : null;
  const { data, error } = projectId
    ? await deps.serviceClient.from('projects').select('currency').eq('org_id', deps.orgId).eq('id', projectId).maybeSingle()
    : await deps.serviceClient.from('organizations').select('default_currency').eq('id', deps.orgId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const row = data as { currency?: unknown; default_currency?: unknown } | null;
  const value = projectId ? row?.currency : row?.default_currency;
  const currency = typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : undefined;
  if (!currency) throw new AppError('PMO cannot tell which currency this invoice is in. Set a currency on the project, then raise the invoice again.', 'config-rejected');
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  await assertClaimCurrencyMatchesErp(deps, binding, client, currency, record.customerId, 'invoice');
  record.currency = currency;
}

/** #858: the integration user may lack read on Selling Settings; say what to do instead of surfacing the raw permission error. */
async function negativeRatesAllowedOrAction(client: ErpClientDeps): Promise<boolean> {
  try {
    return await readNegativeRatesAllowed(client);
  } catch {
    throw new AppError('PMO cannot read Selling Settings in ERPNext, which this claim needs to check that negative rates are allowed for the down-payment recovery. An ERP administrator must give the PMO integration user read access to Selling Settings (or turn on "Allow Negative rates for Items" and re-run ERP onboarding), then raise the invoice again.', 'config-rejected');
  }
}

async function resolveProgressClaimInvoice(deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow): Promise<'ordinary' | 'claim' | 'none'> {
  const record = deps.command.record as Record<string, unknown>;
  if (record.erp_doc_kind !== 'sales-invoice') return 'none';
  // #858: a recovery replays the persisted, server-built items and taxes (the digest covers them); re-deriving them would read
  // ERPNext again and could drift from the original digest if the template, the VAT flag or the negative-rates setting moved since.
  if (deps.replay && deps.command.operation === 'create') return 'none';
  delete record.taxes;
  delete record.currency; // only a claim sets it, from the claim row below
  if (!buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: record.verb } })) return 'none';
  if (typeof record.id !== 'string' || !record.id.trim()) {
    // A create without a usable id would skip the currency check and the VAT rows below; refuse it before any ERPNext call.
    if (deps.command.operation === 'create') throw new AppError('A sales invoice needs a valid id', 'commit-rejected');
    return 'none';
  }
  const { data: claimData, error } = await deps.serviceClient.from('progress_claims')
    .select('id,kind,project_id,work_order_id,currency,down_payment_amount,dp_recovery_amount,dp_item_code,withdrawn_at')
    .eq('org_id', deps.orgId).eq('id', record.id).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  // `taxes` is server-resolved for a claim only (deleted above): a caller can never smuggle tax rows into an invoice.
  // OD-BILL-1 / DD-BWO-8: an ordinary invoice CREATE may name the work order it bills ("Invoice this work order", the
  // assistant's work-order draft). Its org is checked by the link pre-flight (DOMAIN_LINK_FIELDS); its project, status
  // and what is still to invoice by the outbox fence (0262) before any ERP write. Edits and amends never move it —
  // their work order is the mirror row's, which that same fence reads.
  if (!claimData) {
    const named = typeof record.workOrderId === 'string' && record.workOrderId.trim() !== '';
    if (deps.command.operation !== 'create' || !named) delete record.workOrderId;
    return 'ordinary';
  }
  const claim = claimData as ProgressClaimRecord;
  // DD-PBL-7 (one claim, one invoice): ids are compared as TEXT downstream (external_refs, the one-in-flight
  // outbox index, withdraw_progress_claim), so a case-variant of the claim id would mint a second invoice.
  if (record.id !== claim.id) {
    throw new AppError('This progress claim must be raised under its own id', 'commit-rejected');
  }
  if (deps.command.operation !== 'create') {
    throw new AppError('A progress claim invoice cannot be edited or amended from PMO — cancel the invoice and raise a new claim', 'commit-rejected');
  }
  if (record.projectId !== claim.project_id) {
    throw new AppError('The invoice project must be the progress claim project', 'commit-rejected');
  }
  const { data: project, error: projectError } = await deps.serviceClient.from('projects')
    .select('client_id,subject_to_vat,tax_base_numerator,tax_base_denominator').eq('org_id', deps.orgId).eq('id', claim.project_id).maybeSingle();
  if (projectError) throw new AppError(projectError.message, projectError.code);
  const clientId = (project as { client_id?: string | null } | null)?.client_id ?? null;
  let fraction = taxBaseFraction(project);
  const subjectToVat = (project as { subject_to_vat?: unknown } | null)?.subject_to_vat !== false;
  if (!clientId || record.customerId !== clientId) {
    throw new AppError('The invoice customer must be the project client', 'commit-rejected');
  }
  const { data: evidence, error: evidenceError } = await deps.serviceClient.from('progress_claim_evidence')
    .select('id').eq('org_id', deps.orgId).eq('claim_id', claim.id).limit(1);
  if (evidenceError) throw new AppError(evidenceError.message, evidenceError.code);
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new AppError("Attach the billing evidence (for example the progress report or the client's acceptance) before raising this invoice", 'commit-rejected');
  }
  let lines: ProgressClaimLineRecord[] = [];
  if (claim.kind === 'progress') {
    const { data, error: linesError } = await deps.serviceClient.from('progress_claim_lines')
      .select('item_code,description,unit,quantity,rate')
      .eq('org_id', deps.orgId).eq('claim_id', claim.id)
      .order('boq_item_id', { ascending: true }).limit(MAX_CLAIM_LINES + 1);
    if (linesError) throw new AppError(linesError.message, linesError.code);
    lines = (data ?? []) as ProgressClaimLineRecord[];
    if (lines.length > MAX_CLAIM_LINES) {
      throw new AppError(`A progress claim may have at most ${MAX_CLAIM_LINES} lines`, 'commit-rejected');
    }
  }
  if (claim.work_order_id) {
    const { data: workOrder, error: workOrderError } = await deps.serviceClient.from('work_orders')
      .select('tax_base_numerator,tax_base_denominator').eq('org_id', deps.orgId).eq('id', claim.work_order_id).maybeSingle();
    if (workOrderError) throw new AppError(workOrderError.message, workOrderError.code);
    if (workOrder) fraction = taxBaseFraction(workOrder);
  }
  record.items = progressClaimItems(claim, lines);
  record.workOrderId = claim.work_order_id;
  // #858: sent explicitly so ERPNext itself rejects a mismatch with the party account currency; part of the persisted body, so a replay sends the same.
  if (claim.currency) record.currency = claim.currency;
  // DD-PBL-7: the server builds the invoice from the claim alone — a caller's PO reference or receipt date is dropped
  // (the PO is re-derived from the claim's work order by `resolveSalesInvoicePo`).
  delete record.reference_number;
  delete record.po_date;
  delete record.received_date;
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  // #858: the claim is stated in its own currency, but ERPNext bills in the customer's (else the company's). Refuse a mismatch
  // before a draft exists rather than book the amounts in the wrong currency.
  await assertClaimCurrencyMatchesErp(deps, binding, client, claim.currency, record.customerId);
  // DD-PBL-12a: a recovery line is a negative rate, which ERPNext refuses at submit unless the site allows it.
  // Fail fast (before a draft exists) with the action to take; onboarding enables it, this catches a site that never
  // ran onboarding or had it switched back off.
  if (Number(claim.dp_recovery_amount) > 0 && !(await negativeRatesAllowedOrAction(client))) {
    throw new AppError('ERPNext does not allow negative rates yet, which this claim needs to recover the down payment. An ERP administrator must turn on "Allow Negative rates for Items" in Selling Settings (or re-run ERP onboarding), then raise the invoice again.', 'config-rejected');
  }
  // DD-PBL-12b: ERPNext does not expand a template named over REST, so the tax rows are sent explicitly.
  // OD-TAX-4: a project that is not subject to VAT sends no tax rows and reads no template (the flag is read above, server-side).
  if (subjectToVat) {
    const company = binding.config?.company;
    if (typeof company !== 'string' || !company) throw new AppError(MISSING_TAX_SETUP, 'config-rejected');
    record.taxes = requireTaxRows(await resolveSalesTaxRows(client, company, fraction));
  } else {
    delete record.taxes;
  }
  return 'claim';
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
  const invoiceKind = await resolveProgressClaimInvoice(deps, binding);
  let receiptConfig = binding.config;
  if (deps.command.record.erp_doc_kind === 'incoming-payment'
      && Number(deps.command.record.withheld_amount ?? 0) > 0) {
    const { data: settings, error: settingError } = await deps.serviceClient.from('organizations')
      .select('tax_prepaid_account').eq('id', deps.orgId).maybeSingle();
    const account = (settings as { tax_prepaid_account?: unknown } | null)?.tax_prepaid_account;
    if (settingError || typeof account !== 'string' || !account.trim() || account.length > 140) {
      throw new AppError('Set the Tax-prepaid account in Administration → Accounting before recording withheld tax.', 'config-rejected');
    }
    receiptConfig = { ...binding.config, tax_prepaid_account: account.trim(),
      ...(await readReceiptAccountCurrencies(deps, binding)) };
  }
  // Luna re-audit BLOCK 4 — the SI project gate, likewise ahead of any ERP write.
  assertSiProjectGate(deps, binding);

  // Ref resolution (supplier/PO/PO-item) — task 5.3 wires the PO/GR case; slice 3 wires the
  // companies-domain party create/update path (which needs no cross-doctype resolution of its own).
  const contactRefs: Record<string, string | null> = {};
  if (deps.command.record.erp_doc_kind === 'contact') {
    const companyId = deps.command.record.company_id;
    if (typeof companyId !== 'string' || !companyId) throw new AppError('Contact company is required', 'commit-rejected');
    await assertLinkBelongsToOrg(deps.serviceClient, deps.orgId, 'companies', companyId);
    const externalId = await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'companies', companyId);
    const match = externalId?.match(/^(Customer|Supplier):(.+)$/);
    if (!match) throw new AppError('Contact company must be mapped to ERPNext', 'commit-rejected');
    contactRefs.contact_party_type = match[1];
    contactRefs.contact_party_name = match[2];
  }
  const { refs: purchaseProjectRefs } = await resolvePurchaseProjectRefs(deps, binding);
  const { refs: procurementRefs, resolvedItems } = await resolveProcurementOrderRefs(deps, binding);
  const { refs: revenueRefs } = await resolveRevenueRefs(deps, binding);
  // #856: ordinary-invoice tax rows read ERPNext, so they wait for the project gate and the PMO source reads (all fail closed before any ERP call).
  if (invoiceKind === 'ordinary') await resolveOrdinaryInvoiceCurrency(deps, binding, deps.command.record as Record<string, unknown>);
  if (invoiceKind === 'ordinary') await resolveOrdinaryInvoiceTaxes(deps, binding, deps.command.record as Record<string, unknown>);
  await resolvePurchaseInvoiceTaxes(deps, binding, resolvedItems);
  // Resolve authoring items before the outbox snapshot. Catalog validation belongs to the actual
  // adapter commit, so an already-committed recovery can converge its mirror without ERP reads.
  const itemKind = deps.command.record.erp_doc_kind;
  let validateAuthoringItems: ErpAdapterDeps['validateAuthoringItems'];
  if (
    ['sales-invoice', 'purchase-order', 'purchase-invoice'].includes(String(itemKind)) &&
    buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: deps.command.record.verb } })
  ) {
    const record = deps.command.record;
    const lines = Array.isArray(record.items) && record.items.length > 0 ? record.items : resolvedItems;
    if (lines?.length) {
      record.items = lines;
      validateAuthoringItems = async (command, client) => {
        if (!buildsSalesInvoiceBody({ operation: command.operation, record: { verb: command.record.verb } })) return;
        const catalog = await listErpItems(client, itemKind === 'sales-invoice' ? 'sales' : 'purchase');
        validateItemLines(Array.isArray(command.record.items) ? command.record.items : [], catalog);
      };
    }
  }
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
    : receiptConfig;
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
    validateAuthoringItems,
    // Ref resolution: PO/GR commands (task 5.3, FR-ENA-103) resolve `refs`/`resolvedItems` above via
    // the case's `procurementId` (supplier + line items + PO/PO-item-child-row for a GR). Every other
    // kind — MR/RFQ/SQ (task 4.6/4.7, FR-ENA-111/112) — carries no `procurementId`, so `refs.supplier`
    // comes back unset there; fall back to resolving the command's own `vendorId` through the SAME
    // `companies` domain external_refs mapping (`resolveExternalRef`, task 1.6). The PO/GR path never
    // pays for this fallback call — `??` short-circuits once `refs.supplier` is already resolved.
    // Revenue commands (sales-invoice/incoming-payment) resolve customer + project + SI ref via
    // `resolveRevenueRefs` (task 2.3, FR-SAR-100/101/121).
    ctx: {
      refs: { ...contactRefs, ...procurementRefs, ...purchaseProjectRefs, ...revenueRefs, ...budgetRefs, ...timesheetRefs, supplier: procurementRefs.supplier ?? (await resolveSupplierRef(deps.serviceClient, deps.orgId, deps.command)) },
      config: budgetConfig,
      resolvedItems,
    },
    validateAuthoringPartyIdentity: async (command) => {
      const kind = command.record.erp_doc_kind;
      if (command.domain !== 'companies' || !['contact', 'customer', 'supplier'].includes(String(kind))) return;
      if (kind === 'contact' && command.operation === 'create') {
        const { data: existing, error } = await deps.serviceClient.from('contacts')
          .select('id').eq('id', command.record.id).maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        if (existing) throw new AppError('Contact create requires a new record identity', 'commit-rejected');
      }
      const oppositeTable = kind === 'contact' ? 'companies' : 'contacts';
      const { data: opposite, error: identityError } = await deps.serviceClient.from(oppositeTable)
        .select('id').eq('org_id', deps.orgId).eq('id', command.record.id).maybeSingle();
      if (identityError) throw new AppError(identityError.message, identityError.code);
      if (opposite) throw new AppError('This record identity already belongs to another party type', 'commit-rejected');
    },
    afterSubmitHook: deps.afterSubmitHook,
    afterCancelHook: deps.afterCancelHook,
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
