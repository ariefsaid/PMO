/*
 * erpnext/purchaseMirrorFeed.ts (FR-EPR-001..004, docs/specs/erp-purchases-readonly.spec.md) — the sweep pass
 * that mirrors ERP-native Purchase Orders / Purchase Invoices into `erp_purchase_documents` (0335) for a
 * READ-ONLY list. DD-XING-2: read, never adopted — nothing here creates a PMO procurement case, and nothing
 * sums these rows into spent/committed/actuals (their cost already arrives through the GL mirror).
 */
import { AppError } from '../../appError.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { readWm, type LedgerFeedServiceClient } from './ledgerMirrorFeed.ts';

export type PurchaseDoctype = 'Purchase Order' | 'Purchase Invoice';
export const PURCHASE_DOCTYPES: readonly PurchaseDoctype[] = ['Purchase Order', 'Purchase Invoice'];
export const purchaseWmDomain = (doctype: PurchaseDoctype) => `purchases::${doctype}`;
const CURSOR_VERSION = 2;
const purchaseCursorDomain = (doctype: PurchaseDoctype) => `purchases::v2::${doctype}`;

const FIELDS: Record<PurchaseDoctype, readonly string[]> = {
  'Purchase Order': ['name', 'supplier', 'supplier_name', 'transaction_date', 'schedule_date', 'currency',
    'grand_total', 'status', 'docstatus', 'project', 'modified'],
  'Purchase Invoice': ['name', 'supplier', 'supplier_name', 'posting_date', 'due_date', 'bill_no', 'currency',
    'grand_total', 'outstanding_amount', 'status', 'docstatus', 'is_return', 'project', 'modified'],
};
const PAGE_SIZE = 500;
const MAX_PAGE_READS = 12;
const PASS_BUDGET_MS = 25_000;
const REQUEST_TIMEOUT_MS = 5_000;

export interface PurchaseFeedServiceClient extends Pick<LedgerFeedServiceClient, 'from'> {
  rpc(name: 'upsert_erp_purchase_documents', args: { p_org_id: string; p_rows: PurchaseMirrorRow[] }):
    PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface PurchaseMirrorRow {
  erp_doctype: PurchaseDoctype;
  erp_name: string;
  supplier: string | null;
  supplier_name: string | null;
  doc_date: string | null;
  due_date: string | null;
  bill_no: string | null;
  currency: string | null;
  grand_total: string | null;
  outstanding_amount: string | null;
  erp_status: string | null;
  erp_docstatus: number;
  is_return: boolean;
  erp_project: string | null;
  erp_modified: string;
}

export interface FeedPurchaseMirrorResult { fed: number; caughtUp: boolean }

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const money = (v: unknown): string | null => {
  const t = str(v);
  if (t === null || !/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const whole = t.replace(/^-/, '').split('.')[0].replace(/^0+/, '') || '0';
  return whole.length <= 16 ? t : null;
};
const date = (v: unknown): string | null => {
  const t = str(v);
  if (t === null || !/^(\d{4})-(\d{2})-(\d{2})$/.test(t)) return null;
  const [, year, month, day] = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  const parsed = new Date(`${t}T00:00:00.000Z`);
  return parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day) ? t : null;
};

export function toPurchaseMirrorRow(doctype: PurchaseDoctype, d: Record<string, unknown>): PurchaseMirrorRow | null {
  const status = Number(d.docstatus);
  if (status !== 1 && status !== 2) return null;
  const isPi = doctype === 'Purchase Invoice';
  return {
    erp_doctype: doctype,
    erp_name: String(d.name),
    supplier: str(d.supplier),
    supplier_name: str(d.supplier_name) ?? str(d.supplier),
    doc_date: date(isPi ? d.posting_date : d.transaction_date),
    due_date: date(isPi ? d.due_date : d.schedule_date),
    bill_no: isPi ? str(d.bill_no) : null,
    currency: str(d.currency),
    grand_total: money(d.grand_total),
    outstanding_amount: isPi ? money(d.outstanding_amount) : null,
    erp_status: str(d.status),
    erp_docstatus: status,
    is_return: Boolean(d.is_return),
    erp_project: str(d.project),
    erp_modified: String(d.modified),
  };
}

interface PurchaseCursor { version: 2; modified: string; name?: string }
function parseCursor(value: string | null): PurchaseCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PurchaseCursor>;
    if (parsed.version === CURSOR_VERSION && typeof parsed.modified === 'string'
      && (!parsed.name || typeof parsed.name === 'string')) return parsed as PurchaseCursor;
  } catch { /* legacy cursors are plain Frappe timestamps */ }
  return { version: CURSOR_VERSION, modified: value };
}
function encodeCursor(cursor: PurchaseCursor): string { return JSON.stringify(cursor); }

async function readPage(client: ErpClientDeps, doctype: PurchaseDoctype, company: string, cursor: PurchaseCursor | null,
  equalBoundary: boolean, offset: number, timeoutMs: number) {
  const filters: unknown[] = [['company', '=', company], ['docstatus', 'in', [1, 2]]];
  if (cursor) {
    if (equalBoundary) {
      filters.push(['modified', '=', cursor.modified]);
      if (cursor.name) filters.push(['name', '>', cursor.name]);
    } else filters.push(['modified', '>', cursor.modified]);
  }
  const qs = `filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(FIELDS[doctype]))}`
    + `&limit_page_length=${PAGE_SIZE}&limit_start=${offset}&order_by=${encodeURIComponent('modified asc, name asc')}`;
  const body = await erpnextRequest({ ...client, timeoutMs }, { method: 'GET', path: `/api/resource/${encodeURIComponent(doctype)}?${qs}` });
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === 'object' && typeof (r as Record<string, unknown>).name === 'string'
    && typeof (r as Record<string, unknown>).modified === 'string')) {
    throw new AppError(`ERPNext ${doctype} list response was malformed`, 'external-unreachable');
  }
  return rows as Record<string, unknown>[];
}

async function saveCursor(sc: PurchaseFeedServiceClient, orgId: string, domain: string, previous: string | null, next: string): Promise<void> {
  const table = sc.from('external_sync_watermarks');
  if (previous === null) {
    const { error } = await table.upsert({ org_id: orgId, external_tier: 'erpnext', domain, watermark_cursor: next },
      { onConflict: 'org_id,external_tier,domain', ignoreDuplicates: true });
    if (error) throw new AppError(error.message, error.code);
  } else {
    const { count, error } = await table.update({ watermark_cursor: next }, { count: 'exact' })
      .eq('org_id', orgId).eq('external_tier', 'erpnext').eq('domain', domain).eq('watermark_cursor', previous);
    if (error) throw new AppError(error.message, error.code);
    if (count === 0) {
      const current = await readWm(sc, orgId, domain);
      if (current !== next) throw new AppError('Purchase feed cursor changed concurrently; resume on the next sweep', 'cursor-conflict');
    }
  }
  const stored = await readWm(sc, orgId, domain);
  if (stored !== next && stored !== previous) throw new AppError('Purchase feed cursor changed concurrently; resume on the next sweep', 'cursor-conflict');
}

/** Persist each successful page before making another remote request. Cursor JSON is a v2 namespace,
 * separate from the shared timestamp-only monotonic feeds; the legacy timestamp is read only to seed it. */
export async function feedPurchaseMirror(sc: PurchaseFeedServiceClient, opts: { client: ErpClientDeps; orgId: string; company: string }): Promise<FeedPurchaseMirrorResult> {
  if (!opts.company?.trim()) throw new AppError('ERPNext company is required for the purchase feed', 'config-rejected');
  const deadline = Date.now() + PASS_BUDGET_MS;
  const transport = { ...opts.client, maxRetries: 0, timeoutMs: REQUEST_TIMEOUT_MS };
  let reads = 0;
  let fed = 0;
  let wroteAny = false;
  const pending: Array<{ doctype: PurchaseDoctype; domain: string; stored: string | null; cursor: PurchaseCursor | null; equalityDone: boolean }> = [];
  for (const doctype of PURCHASE_DOCTYPES) {
    const domain = purchaseCursorDomain(doctype);
    const stored = await readWm(sc, opts.orgId, domain);
    const legacy = stored === null ? await readWm(sc, opts.orgId, purchaseWmDomain(doctype)) : null;
    pending.push({ doctype, domain, stored, cursor: parseCursor(stored ?? legacy), equalityDone: false });
  }

  // Alternate durable pages so both document types progress within the shared budget.
  while (pending.length > 0 && reads < MAX_PAGE_READS) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const state = pending.shift()!;
    const { doctype, domain, cursor, equalityDone } = state;
    const rows = await readPage(transport, doctype, opts.company, cursor, !equalityDone, 0, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
    reads += 1;
    if (rows.length === 0) {
      if (!equalityDone && cursor) {
        state.equalityDone = true;
        pending.push(state);
      } else if (cursor) {
        const canonical = encodeCursor({ version: CURSOR_VERSION, modified: cursor.modified });
        if (canonical !== state.stored) await saveCursor(sc, opts.orgId, domain, state.stored, canonical);
      }
      continue;
    }
    const pageLatest = new Map<string, PurchaseMirrorRow>();
    for (const source of rows) {
      const row = toPurchaseMirrorRow(doctype, source);
      if (!row) continue;
      const existing = pageLatest.get(row.erp_name);
      if (!existing || row.erp_modified > existing.erp_modified) pageLatest.set(row.erp_name, row);
    }
    const { data, error } = await sc.rpc('upsert_erp_purchase_documents', { p_org_id: opts.orgId, p_rows: [...pageLatest.values()] });
    if (error) throw new AppError(error.message, error.code);
    fed += Number(data ?? 0);
    wroteAny = true;
    const last = rows[rows.length - 1];
    const completed = rows.length < PAGE_SIZE && equalityDone;
    state.cursor = completed
      ? { version: CURSOR_VERSION, modified: String(last.modified) }
      : { version: CURSOR_VERSION, modified: String(last.modified), name: String(last.name) };
    const next = encodeCursor(state.cursor);
    await saveCursor(sc, opts.orgId, domain, state.stored, next);
    state.stored = next;
    if (!completed) {
      state.equalityDone = rows.length < PAGE_SIZE;
      pending.push(state);
    }
  }
  if (!wroteAny) {
    const { error } = await sc.rpc('upsert_erp_purchase_documents', { p_org_id: opts.orgId, p_rows: [] });
    if (error) throw new AppError(error.message, error.code);
  }
  return { fed, caughtUp: pending.length === 0 };
}
