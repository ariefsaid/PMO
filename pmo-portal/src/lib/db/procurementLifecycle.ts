import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ProcurementRow, ProcurementWithRefs } from './procurements';

// ---------------------------------------------------------------------------
// Type contract (plan §1.6)
// ---------------------------------------------------------------------------

export type ProcurementReceiptRow = Tables<'procurement_receipts'>;
export type ProcurementInvoiceRow = Tables<'procurement_invoices'>;
export type ProcurementStatus = ProcurementRow['status'];

/**
 * #505 (0196): does a recorded invoice `amount` ALREADY include its tax, or not?
 *
 * The one fact about an invoice that no later inference recovers — a total with no marker cannot be
 * disambiguated by any means afterwards. The DB column is `text` NOT NULL with no default and a
 * two-value CHECK, for the reason 0196 states: a boolean's falsy default silently writes a WRONG
 * value indistinguishable from a deliberate one. This union is the TypeScript mirror of that domain.
 *
 * Shared with the `sales_invoices` / `work_orders` tax columns (#478, 0187/0188), which carry the
 * identical two-value domain — deliberately ONE type, not a second copy per table.
 */
export type TaxTreatment = 'inclusive' | 'exclusive';

// ---------------------------------------------------------------------------
// Error contract — preserve the Postgres/PostgREST error.code through the DAL
// ---------------------------------------------------------------------------

/** Shape of a Supabase RPC / PostgREST error (only the fields we surface). */
interface RpcErrorLike {
  message: string;
  code?: string;
}

/**
 * Carries the verbatim RPC message AND the Postgres/PostgREST error `code`
 * (e.g. `P0001` illegal-stage, `42501` not-permitted/SoD) so the UI can
 * classify the toast by code instead of dropping it to a generic message.
 * Extends Error, so existing `err instanceof Error` / `.message` consumers
 * keep working unchanged.
 */
export class ProcurementError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ProcurementError';
    this.code = code;
  }
}

/** Throws a ProcurementError that preserves both message and code. */
function throwRpc(error: RpcErrorLike): never {
  throw new ProcurementError(error.message, error.code);
}

export type ProcurementItemRow = Tables<'procurement_items'>;

export type ProcurementDetail = ProcurementWithRefs & {
  approved_by: { full_name: string } | null;
  /** Editable line items (CRUD+RBAC Procurement slice) joined into the detail. */
  items: ProcurementItemRow[];
  quotations: Tables<'procurement_quotations'>[];
  receipts: ProcurementReceiptRow[];
  invoices: ProcurementInvoiceRow[];
  // Slice 5 — new record types (loaded in Slice 6.1 DETAIL_SELECT extension)
  purchase_requests: Tables<'purchase_requests'>[];
  rfqs: Tables<'rfqs'>[];
  purchase_orders: Tables<'purchase_orders'>[];
  payments: Tables<'payments'>[];
  /** Transition-event log ([PD-7] / FR-PR-025) loaded from procurement_status_events. */
  statusEvents: Tables<'procurement_status_events'>[];
};

// ---------------------------------------------------------------------------
// Transition map (OD-PROC-6 config seam — single source of truth, mirrors the
// data literal inside transition_procurement() SQL, AC-800/801)
// ---------------------------------------------------------------------------

export const LEGAL_TRANSITIONS: Record<string, string[]> = {
  Draft:            ['Requested', 'Cancelled'],
  Requested:        ['Approved', 'Rejected', 'Cancelled'],
  Approved:         ['Vendor Quoted', 'Ordered', 'Cancelled'],
  'Vendor Quoted':  ['Quote Selected', 'Cancelled'],
  'Quote Selected': ['Ordered', 'Cancelled'],
  Ordered:          ['Received', 'Cancelled'],
  Received:         ['Vendor Invoiced', 'Cancelled'],
  'Vendor Invoiced':['Paid', 'Cancelled'],
  Rejected:         ['Draft'],
  Paid:             [],
  Cancelled:        [],
};

/**
 * Returns true when (from → to) is in the legal transition superset (AC-800/801, FR-PROC-001/002).
 * Pure function; mirrors the map in transition_procurement().
 */
export function isLegalTransition(from: ProcurementStatus, to: ProcurementStatus): boolean {
  const allowed = LEGAL_TRANSITIONS[from as string];
  if (!allowed) return false;
  return allowed.includes(to as string);
}

// ---------------------------------------------------------------------------
// Cancel boundary (OD-PROC-B, AC-802, FR-PROC-002/009)
// ---------------------------------------------------------------------------

/** Terminal statuses — cannot be cancelled or transitioned away (except Rejected→Draft). */
const TERMINAL = new Set<string>(['Paid', 'Cancelled', 'Rejected']);

/** "Early" statuses where the requester is still allowed to cancel their own request. */
const EARLY_CANCEL = new Set<string>(['Draft', 'Requested']);

/**
 * Returns true when the given role/requester combination may cancel at the given status (AC-802).
 * Requester may cancel while status ∈ {Draft, Requested}; PM/Finance/Exec may cancel at any
 * non-terminal status; nobody may cancel from a terminal status.
 */
export function canCancel(role: string, isRequester: boolean, from: ProcurementStatus): boolean {
  const fromStr = from as string;
  if (TERMINAL.has(fromStr)) return false;
  if (isRequester && EARLY_CANCEL.has(fromStr)) return true;
  // Late cancel: only PM / Finance / Executive (and Admin break-glass)
  return ['Project Manager', 'Finance', 'Executive', 'Admin'].includes(role);
}

// ---------------------------------------------------------------------------
// Reference-number formatter (AC-803, FR-PROC-010)
// Pure TS mirror of the SQL: prefix-YYMMDD####
// ---------------------------------------------------------------------------

/**
 * Formats a procurement document number. Mirrors the SQL lpad/to_char in next_procurement_doc_number
 * (AC-803, FR-PROC-010). `date` is the server date; `seq` is the per-(org,prefix,day) sequence.
 *
 * Stays native-UTC intentionally: the `yyMMdd` parts use `getUTC*` (the C4 fix) so a date-only
 * value never drifts by one day in behind-UTC zones. date-fns `format` is LOCAL → it would shift
 * the day, and the UTC-correct fix (`date-fns-tz` `formatInTimeZone`) is a second package we
 * intentionally do not add for a dependency-free getter that is already correct (ADR-0030 §F).
 */
export function formatDocNumber(
  prefix: 'PR' | 'VQ' | 'PO' | 'GR' | 'VI',
  date: Date,
  seq: number,
): string {
  // C4: use UTC parts so a date constructed from a UTC ISO string (e.g. new Date('2026-06-04'))
  // or the server date never shifts by one day in behind-UTC timezones (date-only convention).
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${prefix}-${yy}${mm}${dd}${String(seq).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// DAL reads — getProcurementDetail (AC-816)
// ---------------------------------------------------------------------------

// File-presence sub-select: only the 3 fields needed for the ledger File column.
// archived_at is null filtering is done client-side in buildLedgerRows (filePresence())
// since PostgREST embedded `.is(archived_at, null)` filters are applied via query
// params on the main select, not sub-selects. We fetch all and discard archived in JS.
const FILE_FIELDS = 'title, file_path, archived_at';

const DETAIL_SELECT = [
  '*',
  // The DecisionSupportPanel sources committed spend via useProjectCommittedSpend (the
  // honest Σ-PO-in-Ordered..Paid basis, OD-W5-4) — NOT the static projects.budget/spent
  // columns (0 in seed, contradict the dashboards). So this join stays name/code only.
  'project:projects(name,code)',
  'vendor:companies(name)',
  'requested_by:profiles!procurements_requested_by_id_fkey(full_name)',
  'approved_by:profiles!procurements_approved_by_id_fkey(full_name)',
  'items:procurement_items(*)',
  // Quotations + their files (compact — title/file_path/archived_at only).
  `quotations:procurement_quotations(*, files:procurement_quotation_files(${FILE_FIELDS}))`,
  // Receipts + their files.
  `receipts:procurement_receipts(*, files:procurement_receipt_files(${FILE_FIELDS}))`,
  // Invoices + their files.
  `invoices:procurement_invoices(*, files:procurement_invoice_files(${FILE_FIELDS}))`,
  // Slice 6.1 — four new ERP-canonical record types + transition-event log (one bounded
  // PostgREST embed, no N+1; NFR-PR-PERF-002, [PD-7]).
  `purchase_requests:purchase_requests(*, files:purchase_request_files(${FILE_FIELDS}))`,
  `rfqs:rfqs(*, files:rfq_files(${FILE_FIELDS}))`,
  `purchase_orders:purchase_orders(*, files:purchase_order_files(${FILE_FIELDS}))`,
  `payments:payments(*, files:payment_files(${FILE_FIELDS}))`,
  // Embed the actor's profile name so the timeline can display a real name instead
  // of the raw UUID (AC-PR-PROG-012).  The FK alias must match the constraint name.
  'statusEvents:procurement_status_events(*, actor:profiles!procurement_status_events_actor_id_fkey(full_name))',
].join(', ');

/**
 * Fetches a single procurement with all lifecycle children joined (AC-816 DAL).
 * org_id is NEVER sent — RLS scopes via auth_org_id().
 */
export async function getProcurementDetail(id: string): Promise<ProcurementDetail> {
  const { data, error } = await supabase
    .from('procurements')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .single();
  if (error) throwRpc(error);
  return data as unknown as ProcurementDetail;
}

// ---------------------------------------------------------------------------
// DAL writes — thin RPC wrappers (AC-806/816, FR-PROC-003/011/016)
// org_id is NEVER sent; the security-definer RPCs re-assert org from auth context.
// ---------------------------------------------------------------------------

/**
 * Transitions a procurement status. Throws and surfaces the RPC error (AC-806, FR-PROC-003/004).
 * org_id is NEVER sent.
 */
export async function transitionProcurement(
  id: string,
  to: ProcurementStatus,
  notes?: string,
): Promise<void> {
  const { error } = (await supabase.rpc('transition_procurement', {
    p_id: id,
    p_to: to,
    p_notes: notes,
  })) as unknown as { data: null; error: RpcErrorLike | null };
  if (error) throwRpc(error);
}

/**
 * Creates a procurement quotation via the security-definer RPC (AC-816, FR-PROC-011/016).
 * org_id is NEVER sent; the RPC re-asserts authz internally.
 */
export async function createQuotation(
  procurementId: string,
  vendorId: string,
  totalAmount: number,
  receivedDate: string,
  importKey?: string,
  importBatchId?: string,
  importedAt?: string,
): Promise<Tables<'procurement_quotations'>> {
  const { data, error } = (await supabase.rpc('create_procurement_quotation', {
    p_procurement_id: procurementId,
    p_vendor_id: vendorId,
    p_total_amount: totalAmount,
    p_received_date: receivedDate,
    p_import_key: importKey,
    p_import_batch_id: importBatchId,
    p_imported_at: importedAt,
  })) as unknown as { data: Tables<'procurement_quotations'>; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}

/**
 * Creates a goods-receipt record via the security-definer RPC (AC-816, FR-PROC-011/016).
 * org_id is NEVER sent; mints GR# server-side.
 * `referenceNumber` = supplier delivery-note number (optional, AC-PR-LEDGER-016).
 */
export async function createReceipt(
  procurementId: string,
  status: 'Partial' | 'Complete',
  receiptDate: string,
  referenceNumber?: string | null,
  importKey?: string,
  importBatchId?: string,
  importedAt?: string,
): Promise<ProcurementReceiptRow> {
  const { data, error } = (await supabase.rpc('create_procurement_receipt', {
    p_procurement_id: procurementId,
    p_status: status,
    p_receipt_date: receiptDate,
    p_reference_number: referenceNumber ?? undefined,
    p_import_key: importKey,
    p_import_batch_id: importBatchId,
    p_imported_at: importedAt,
  })) as unknown as { data: ProcurementReceiptRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}

/**
 * The tax facts every vendor-invoice write must carry (#505, migration 0196).
 *
 * `taxTreatment` and `taxAmount` are REQUIRED members — that is the whole point of this interface.
 * The DB columns are NOT NULL with no default and the RPC raises P0001 when either is omitted, so
 * the type system here MIRRORS THE NOT NULL CONSTRAINT: forgetting one is a `tsc` failure at the
 * call site rather than a runtime P0001 in front of a user. It is the reason `createInvoice` and
 * `captureVendorInvoice` take a single object instead of the positional lists they used to —
 * TypeScript forbids a required parameter after an optional one, and appending them as OPTIONAL
 * trailing params would have re-created exactly the omission this issue exists to make impossible.
 *
 * ⛔ Never give `taxTreatment` a default, a fallback, or a `?? 'inclusive'` anywhere on this path. A
 * silently-wrong marker is indistinguishable from a deliberate one, which is the defect itself.
 */
interface VendorInvoiceTaxInput {
  /** Does `amount` already include `taxAmount`? Not inferable later — the caller must state it. */
  taxTreatment: TaxTreatment;
  /** Total input tax in the invoice's currency. 0 means "no tax"; it never means "unknown". */
  taxAmount: number;
  /** Authored tax percentage (e.g. 11 for PPN 11%). null/undefined = not recorded — never 0%. */
  taxRate?: number | null;
  /** ERPNext "Purchase Taxes and Charges Template" name; absent for a standalone org. */
  taxTemplate?: string | null;
}

/** Input for {@link createInvoice}. See {@link VendorInvoiceTaxInput} for why this is an object. */
export interface CreateInvoiceInput extends VendorInvoiceTaxInput {
  procurementId: string;
  status: 'Received' | 'Scheduled' | 'Paid';
  invoiceDate: string;
  /** Supplier's invoice number (AC-PR-LEDGER-017). */
  referenceNumber?: string | null;
  /** Invoice total (AC-PR-LEDGER-017). Read WITH `taxTreatment` — alone it is ambiguous. */
  amount?: number | null;
  importKey?: string;
  importBatchId?: string;
  importedAt?: string;
}

/**
 * Creates a vendor-invoice record via the security-definer RPC (AC-816, FR-PROC-011/016).
 * org_id is NEVER sent; mints VI# server-side.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<ProcurementInvoiceRow> {
  const { data, error } = (await supabase.rpc('create_procurement_invoice', {
    p_procurement_id: input.procurementId,
    p_status: input.status,
    p_invoice_date: input.invoiceDate,
    p_reference_number: input.referenceNumber ?? undefined,
    p_amount: input.amount ?? undefined,
    p_import_key: input.importKey,
    p_import_batch_id: input.importBatchId,
    p_imported_at: input.importedAt,
    // #505: sent unconditionally — `taxTreatment`/`taxAmount` are required by the type, so there is
    // no `?? undefined` to fall through to the RPC's P0001 gate.
    p_tax_treatment: input.taxTreatment,
    p_tax_amount: input.taxAmount,
    p_tax_rate: input.taxRate ?? undefined,
    p_tax_template: input.taxTemplate ?? undefined,
  })) as unknown as { data: ProcurementInvoiceRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}

/**
 * Atomic vendor-invoice capture (reliability harden #2): transition the case to Vendor Invoiced,
 * create the invoice record, and log the status event in ONE transaction via the
 * capture_vendor_invoice security-definer RPC — so the case can never advance to Vendor Invoiced
 * with no invoice (or vice versa). The RPC REUSES transition_procurement's SoD/role guard (it is not
 * bypassed). org_id is NEVER sent. Throws (with the RPC error.code) on any failure — the form stays
 * open so the user can retry.
 */
/** Input for {@link captureVendorInvoice}. See {@link VendorInvoiceTaxInput} for why this is an object. */
export interface CaptureVendorInvoiceInput extends VendorInvoiceTaxInput {
  procurementId: string;
  /** N1: Paid excluded — "Mark as Paid" is the sole PR→Paid authority. */
  status: 'Received' | 'Scheduled';
  invoiceDate: string;
  referenceNumber?: string | null;
  amount?: number | null;
  /** Transition note, logged on the status event by the inner transition_procurement call. */
  notes?: string | null;
}

export async function captureVendorInvoice(
  input: CaptureVendorInvoiceInput,
): Promise<ProcurementInvoiceRow> {
  const { data, error } = (await supabase.rpc('capture_vendor_invoice', {
    p_procurement_id: input.procurementId,
    p_status: input.status,
    p_invoice_date: input.invoiceDate,
    p_reference_number: input.referenceNumber ?? undefined,
    p_amount: input.amount ?? undefined,
    p_notes: input.notes ?? undefined,
    // #505: see createInvoice — the RPC forwards these BY NAME to create_procurement_invoice.
    p_tax_treatment: input.taxTreatment,
    p_tax_amount: input.taxAmount,
    p_tax_rate: input.taxRate ?? undefined,
    p_tax_template: input.taxTemplate ?? undefined,
  })) as unknown as { data: ProcurementInvoiceRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}
