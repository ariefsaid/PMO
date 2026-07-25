/**
 * erpnext/ledgerFetch.ts (task 7.2): the confined ERP ledger fetchers — the source the slice-8 sweep
 * feed reads to populate `erp_gl_entry_mirror` / `erp_payment_ledger_mirror` (the ADR-0048 mirrored-
 * rows basis FR-ENA-150/162 require). All Frappe vocabulary (doctype names, the list-endpoint
 * filter/field shapes) stays HERE in erpnext/** (FR-ENA-013 confinement).
 *
 * This module is a PURE FETCH — it issues `GET /api/resource/<DocType>` list requests through the
 * injected `client.ts` (every call an injected `fetchImpl`, NFR-ENA-CONTRACT-001) and returns rows.
 * It NEVER persists anything: the slice-8 sweep feed (8.x) owns the upsert into the mirror tables
 * (applying the per-row `erp_modified >=` guard against the existing mirror row). Money fields cross
 * as decimal-strings (R4) — a Frappe number is coerced, `null`/absent stays `null`.
 *
 * Filters (version-pinned, FR-ENA-150/162): GL Entry excludes cancelled
 * (`is_cancelled=0` AND `docstatus!=2`); Payment Ledger Entry excludes cancelled (`docstatus!=2` —
 * a cancelled PLE is docstatus 2). Both scope by `company` and by `modified >= since` (the sweep's
 * per-org watermark cursor; omit for a full backfill).
 */
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { AppError } from '../../appError.ts';

/** The mirrored GL Entry row shape — feeds erp_gl_entry_mirror. Money is decimal-string (R4). */
export interface GlEntryRow {
  name: string;
  account: string;
  cost_center: string | null;
  fiscal_year: string | null;
  project: string | null;
  party_type: string | null;
  party: string | null;
  voucher_type: string | null;
  voucher_no: string | null;
  posting_date: string | null;
  debit: string | null;
  credit: string | null;
  is_cancelled: boolean;
  docstatus: number | null;
  /** Frappe `modified` — the per-row source-mod cursor (the slice-8 feed's `>=` guard). */
  modified: string;
}

/** The mirrored Payment Ledger Entry row shape — feeds erp_payment_ledger_mirror. Money is signed
 *  decimal-string (ERP credits the payable on payment → negative amount). */
export interface PaymentLedgerEntryRow {
  name: string;
  account: string;
  party_type: string | null;
  party: string | null;
  against_voucher_type: string | null;
  against_voucher_no: string | null;
  amount: string | null;
  posting_date: string | null;
  due_date: string | null;
  docstatus: number | null;
  modified: string;
}

export interface LedgerFetchOpts {
  /** `external_org_bindings.config.company` — the ERP Company the rows are scoped to. */
  company: string;
  /** Frappe `modified >= since` (ISO-ish datetime string). Omit for a full backfill. */
  since?: string;
  /** Page size for the list endpoint. Default 500 (a safe, commonly-allowed Frappe page length). */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 500;

const GL_FIELDS = [
  'name', 'account', 'cost_center', 'fiscal_year', 'project', 'party_type', 'party',
  'voucher_type', 'voucher_no', 'posting_date', 'debit', 'credit', 'is_cancelled', 'docstatus', 'modified',
] as const;

const PLE_FIELDS = [
  'name', 'account', 'party_type', 'party', 'against_voucher_type', 'against_voucher_no',
  'amount', 'posting_date', 'due_date', 'docstatus', 'modified',
] as const;

/** Coerces a Frappe money value to a decimal-string (R4). A Frappe `null`/absent → `null`. */
function money(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/** Normalizes a Frappe list-row's common scalar fields (null-safe). */
function str(v: unknown): string | null {
  return v === null || v === undefined || v === '' ? null : String(v);
}

/** Builds the Frappe list-endpoint query path with paged filters + fields. */
function listPath(
  doctype: string,
  filters: unknown[],
  fields: readonly string[],
  pageSize: number,
  limitStart: number,
): string {
  const encodedDoctype = encodeURIComponent(doctype);
  const f = encodeURIComponent(JSON.stringify(filters));
  const fld = encodeURIComponent(JSON.stringify(fields));
  const qs = `filters=${f}&fields=${fld}&limit_page_length=${pageSize}&limit_start=${limitStart}`;
  return `/api/resource/${encodedDoctype}?${qs}`;
}

/** Pages a list endpoint until a short page is returned, accumulating all rows. */
async function fetchAllPages(
  client: ErpClientDeps,
  doctype: string,
  filters: unknown[],
  fields: readonly string[],
  pageSize: number,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let limitStart = 0;
  // Guard: a pathological server that returns full pages forever cannot loop us indefinitely.
  for (let safety = 0; safety < 1000; safety += 1) {
    const body = await erpnextRequest(client, { method: 'GET', path: listPath(doctype, filters, fields, pageSize, limitStart) });
    const page = (body as { data?: Record<string, unknown>[] } | null)?.data;
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break; // short page → done
    limitStart += pageSize;
  }
  return rows;
}

/** `GET /api/resource/GL Entry` — mirrored GL Entry truth (FR-ENA-150). Pure fetch; never persists. */
export async function fetchGlEntries(client: ErpClientDeps, opts: LedgerFetchOpts): Promise<GlEntryRow[]> {
  // OD-INT-6: fail loud on missing Company (config-rejected) instead of silently filtering ['company','=',null]
  // which returns zero rows silently — no error, no sync, no alert.
  if (!opts.company || typeof opts.company !== 'string' || opts.company.trim() === '') {
    throw new AppError(
      'ERPNext company is required for ledger fetch — set config.company in the org binding',
      'config-rejected'
    );
  }
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const filters: unknown[] = [
    ['is_cancelled', '=', 0],
    ['docstatus', '!=', 2],
    ['company', '=', opts.company],
  ];
  if (opts.since !== undefined) filters.push(['modified', '>=', opts.since]);
  const raw = await fetchAllPages(client, 'GL Entry', filters, GL_FIELDS, pageSize);
  return raw.map((r) => ({
    name: String(r.name),
    account: String(r.account),
    cost_center: str(r.cost_center),
    fiscal_year: str(r.fiscal_year),
    project: str(r.project),
    party_type: str(r.party_type),
    party: str(r.party),
    voucher_type: str(r.voucher_type),
    voucher_no: str(r.voucher_no),
    posting_date: str(r.posting_date),
    debit: money(r.debit),
    credit: money(r.credit),
    is_cancelled: Boolean(r.is_cancelled),
    docstatus: typeof r.docstatus === 'number' ? r.docstatus : r.docstatus !== null && r.docstatus !== undefined ? Number(r.docstatus) : null,
    modified: String(r.modified),
  }));
}

/** `GET /api/resource/Payment Ledger Entry` — mirrored Payment Ledger Entry truth (FR-ENA-162).
 *  Pure fetch; never persists. */
export async function fetchPaymentLedgerEntries(client: ErpClientDeps, opts: LedgerFetchOpts): Promise<PaymentLedgerEntryRow[]> {
  // OD-INT-6: fail loud on missing Company (config-rejected) instead of silently filtering ['company','=',null]
  if (!opts.company || typeof opts.company !== 'string' || opts.company.trim() === '') {
    throw new AppError(
      'ERPNext company is required for ledger fetch — set config.company in the org binding',
      'config-rejected'
    );
  }
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const filters: unknown[] = [
    ['docstatus', '!=', 2],
    ['company', '=', opts.company],
  ];
  if (opts.since !== undefined) filters.push(['modified', '>=', opts.since]);
  const raw = await fetchAllPages(client, 'Payment Ledger Entry', filters, PLE_FIELDS, pageSize);
  return raw.map((r) => ({
    name: String(r.name),
    account: String(r.account),
    party_type: str(r.party_type),
    party: str(r.party),
    against_voucher_type: str(r.against_voucher_type),
    against_voucher_no: str(r.against_voucher_no),
    amount: money(r.amount),
    posting_date: str(r.posting_date),
    due_date: str(r.due_date),
    docstatus: typeof r.docstatus === 'number' ? r.docstatus : r.docstatus !== null && r.docstatus !== undefined ? Number(r.docstatus) : null,
    modified: String(r.modified),
  }));
}
