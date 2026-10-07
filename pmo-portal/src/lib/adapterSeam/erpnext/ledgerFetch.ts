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
 * Filters: ONLY the scope — `company` and `modified >= since` (the sweep's per-org watermark cursor; omit
 * for a full backfill). Never a cancellation filter (#901): on cancel ERPNext keeps the original ledger rows
 * at docstatus 1, flips their state (`GL Entry.is_cancelled`, `Payment Ledger Entry.delinked`) and bumps
 * `modified`, then adds reversal rows carrying the same flag. A fetch that filters on that state can never
 * re-read the flipped originals, so their mirror copies stay live. The state crosses as a flag instead
 * (docstatus 2 folded in), and the mirror READERS exclude flagged rows.
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
  /** ERPNext `is_cancelled` (a cancelled original or its reversal) OR docstatus 2 — never counted. */
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
  /** ERPNext `delinked` (cancel / unreconcile) OR docstatus 2 — never counted (ERPNext's own `delinked=0` rule). */
  delinked: boolean;
  modified: string;
}

export interface LedgerFetchOpts {
  /** `external_org_bindings.config.company` — the ERP Company the rows are scoped to. */
  company: string;
  /** Frappe `modified >= since` (ISO-ish datetime string). Omit for a full backfill. */
  since?: string;
  /** Page size for the list endpoint. Default 500 (a safe, commonly-allowed Frappe page length). */
  pageSize?: number;
  /** Maximum pages fetched in one tick. The small bounded default prevents a first backfill from
   * monopolizing a sweep; the inclusive modified cursor makes the next tick safe and resumable. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 500;
/** 20 × 500 = at most 10,000 rows per doctype per tick; a later tick resumes at the inclusive watermark. */
export const DEFAULT_MAX_PAGES = 20;
const LEDGER_ORDER_BY = 'modified asc, name asc';

export interface LedgerFetchResult<T> {
  rows: T[];
  /** False means the page budget ended on a full page; the next tick must continue from the watermark. */
  caughtUp: boolean;
}

const GL_FIELDS = [
  'name', 'account', 'cost_center', 'fiscal_year', 'project', 'party_type', 'party',
  'voucher_type', 'voucher_no', 'posting_date', 'debit', 'credit', 'is_cancelled', 'docstatus', 'modified',
] as const;

const PLE_FIELDS = [
  'name', 'account', 'party_type', 'party', 'against_voucher_type', 'against_voucher_no',
  'amount', 'posting_date', 'due_date', 'docstatus', 'delinked', 'modified',
] as const;

/** Coerces a Frappe money value to a decimal-string (R4). A Frappe `null`/absent → `null`. */
function money(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/** Frappe `docstatus` as a number (null-safe). */
function docstatusOf(v: unknown): number | null {
  return typeof v === 'number' ? v : v !== null && v !== undefined ? Number(v) : null;
}

/** The two ERP-side "scope only" filters every ledger fetch sends (#901: never a cancellation filter). */
function scopeFilters(opts: LedgerFetchOpts): unknown[] {
  const filters: unknown[] = [['company', '=', opts.company]];
  if (opts.since !== undefined) filters.push(['modified', '>=', opts.since]);
  return filters;
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
  const orderBy = encodeURIComponent(LEDGER_ORDER_BY);
  const qs = `filters=${f}&fields=${fld}&limit_page_length=${pageSize}&limit_start=${limitStart}&order_by=${orderBy}`;
  return `/api/resource/${encodedDoctype}?${qs}`;
}

/** Pages a list endpoint until a short page is returned, accumulating all rows. */
async function fetchAllPages(
  client: ErpClientDeps,
  doctype: string,
  filters: unknown[],
  fields: readonly string[],
  pageSize: number,
  maxPages: number,
): Promise<{ rows: Record<string, unknown>[]; caughtUp: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let limitStart = 0;
  // A full page is not proof that the source is drained. Stop after the bounded budget and let the
  // inclusive modified watermark re-read the boundary row on the next tick.
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const body = await erpnextRequest(client, { method: 'GET', path: listPath(doctype, filters, fields, pageSize, limitStart) });
    const page = (body as { data?: Record<string, unknown>[] } | null)?.data;
    if (!Array.isArray(page) || page.length === 0) return { rows, caughtUp: true };
    rows.push(...page);
    if (page.length < pageSize) return { rows, caughtUp: true };
    limitStart += pageSize;
  }
  return { rows, caughtUp: false };
}

/** The ledger doctypes the sweep's ledger-mirror feed reads for EVERY activated org (not domain-gated) —
 *  named once here so the activation read-permission probe (#656) checks exactly these. */
export const GL_ENTRY_DOCTYPE = 'GL Entry';
export const PAYMENT_LEDGER_ENTRY_DOCTYPE = 'Payment Ledger Entry';
export const LEDGER_MIRROR_DOCTYPES: readonly string[] = [GL_ENTRY_DOCTYPE, PAYMENT_LEDGER_ENTRY_DOCTYPE];

/** `GET /api/resource/GL Entry` — mirrored GL Entry truth (FR-ENA-150). Pure fetch; never persists. */
export async function fetchGlEntries(client: ErpClientDeps, opts: LedgerFetchOpts): Promise<LedgerFetchResult<GlEntryRow>> {
  // OD-INT-6: fail loud on missing Company (config-rejected) instead of silently filtering ['company','=',null]
  // which returns zero rows silently — no error, no sync, no alert.
  if (!opts.company || typeof opts.company !== 'string' || opts.company.trim() === '') {
    throw new AppError(
      'ERPNext company is required for ledger fetch — set config.company in the org binding',
      'config-rejected'
    );
  }
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const result = await fetchAllPages(client, GL_ENTRY_DOCTYPE, scopeFilters(opts), GL_FIELDS, pageSize, maxPages);
  return {
    ...result,
    rows: result.rows.map((r) => {
      const docstatus = docstatusOf(r.docstatus);
      return {
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
        is_cancelled: Boolean(r.is_cancelled) || docstatus === 2,
        docstatus,
        modified: String(r.modified),
      };
    }),
  };
}

/** `GET /api/resource/Payment Ledger Entry` — mirrored Payment Ledger Entry truth (FR-ENA-162).
 *  Pure fetch; never persists. */
export async function fetchPaymentLedgerEntries(client: ErpClientDeps, opts: LedgerFetchOpts): Promise<LedgerFetchResult<PaymentLedgerEntryRow>> {
  // OD-INT-6: fail loud on missing Company (config-rejected) instead of silently filtering ['company','=',null]
  if (!opts.company || typeof opts.company !== 'string' || opts.company.trim() === '') {
    throw new AppError(
      'ERPNext company is required for ledger fetch — set config.company in the org binding',
      'config-rejected'
    );
  }
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const result = await fetchAllPages(client, PAYMENT_LEDGER_ENTRY_DOCTYPE, scopeFilters(opts), PLE_FIELDS, pageSize, maxPages);
  return {
    ...result,
    rows: result.rows.map((r) => {
      const docstatus = docstatusOf(r.docstatus);
      return {
        name: String(r.name),
        account: String(r.account),
        party_type: str(r.party_type),
        party: str(r.party),
        against_voucher_type: str(r.against_voucher_type),
        against_voucher_no: str(r.against_voucher_no),
        amount: money(r.amount),
        posting_date: str(r.posting_date),
        due_date: str(r.due_date),
        docstatus,
        delinked: Boolean(r.delinked) || docstatus === 2,
        modified: String(r.modified),
      };
    }),
  };
}
