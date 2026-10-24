/*
 * erpnext/purchaseMirrorFeed.ts (FR-EPR-001..004, FR-PFE-040) — the sweep pass that mirrors ERP-native
 * Purchase Orders, Purchase Receipts, Purchase Invoices and supplier Payment Entries into
 * `erp_purchase_documents` (0335, +net_total 0360). ADR-0093: documents are linked into purchases by
 * `link_erp_purchase_documents`, never adopted; nothing here creates a procurement.
 */
import { AppError } from '../../appError.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { readWm, type LedgerFeedServiceClient } from './ledgerMirrorFeed.ts';

export type PurchaseDoctype = 'Purchase Order' | 'Purchase Receipt' | 'Purchase Invoice' | 'Payment Entry';
export const PURCHASE_DOCTYPES: readonly PurchaseDoctype[] = ['Purchase Order', 'Purchase Receipt', 'Purchase Invoice', 'Payment Entry'];
export const purchaseWmDomain = (doctype: PurchaseDoctype) => `purchases::${doctype}`;
const CURSOR_VERSION = 2;
// Orders and invoices moved to a v3 cursor namespace so rows mirrored before net_total / purchase_orders existed
// are re-read once (the 0374 upsert fills those fields on the unchanged ERP version). A v3 namespace never falls
// back to the legacy timestamp (that would skip the re-read).
const REREAD_DOCTYPES: readonly PurchaseDoctype[] = ['Purchase Order', 'Purchase Invoice'];
const purchaseCursorDomain = (doctype: PurchaseDoctype) => `purchases::${REREAD_DOCTYPES.includes(doctype) ? 'v3' : 'v2'}::${doctype}`;

const FIELDS: Record<PurchaseDoctype, readonly string[]> = {
  'Purchase Order': ['name', 'supplier', 'supplier_name', 'transaction_date', 'schedule_date', 'currency',
    'grand_total', 'net_total', 'status', 'docstatus', 'project', 'modified'],
  'Purchase Receipt': ['name', 'supplier', 'supplier_name', 'posting_date', 'currency',
    'grand_total', 'net_total', 'status', 'docstatus', 'is_return', 'project', 'modified'],
  'Purchase Invoice': ['name', 'supplier', 'supplier_name', 'posting_date', 'due_date', 'bill_no', 'currency',
    'grand_total', 'net_total', 'outstanding_amount', 'status', 'docstatus', 'is_return', 'project', 'modified'],
  'Payment Entry': ['name', 'party', 'party_name', 'posting_date', 'paid_to_account_currency',
    'received_amount', 'status', 'docstatus', 'project', 'modified'],
};
/** Extra list filters per doctype: only supplier payments are purchase documents. */
const EXTRA_FILTERS: Partial<Record<PurchaseDoctype, unknown[]>> = {
  'Payment Entry': [['payment_type', '=', 'Pay'], ['party_type', '=', 'Supplier']],
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
  net_total: string | null;
  outstanding_amount: string | null;
  erp_status: string | null;
  erp_docstatus: number;
  is_return: boolean;
  erp_project: string | null;
  erp_modified: string;
  /** Purchase Invoices only: distinct ERP Purchase Order names billed by the item lines (0361 link check). */
  purchase_orders?: string[];
}

export interface FeedPurchaseMirrorResult { fed: number; caughtUp: boolean }

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const money = (v: unknown): string | null => {
  const t = str(v);
  if (t === null || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const whole = t.replace(/^-/, '').split('.')[0].replace(/^0+/, '') || '0';
  return whole.length <= 15 ? t : null;
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
  const isPo = doctype === 'Purchase Order';
  const isPe = doctype === 'Payment Entry';
  return {
    erp_doctype: doctype,
    erp_name: String(d.name),
    supplier: str(isPe ? d.party : d.supplier),
    supplier_name: str(isPe ? d.party_name : d.supplier_name) ?? str(isPe ? d.party : d.supplier),
    doc_date: date(isPo ? d.transaction_date : d.posting_date),
    due_date: isPi ? date(d.due_date) : isPo ? date(d.schedule_date) : null,
    bill_no: isPi ? str(d.bill_no) : null,
    // Payment Entry: the supplier (payables) side, not the bank side, so a USD supplier paid from an IDR bank mirrors USD.
    currency: str(isPe ? d.paid_to_account_currency : d.currency),
    grand_total: money(isPe ? d.received_amount : d.grand_total),
    net_total: isPe ? null : money(d.net_total),
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
  filters.push(...(EXTRA_FILTERS[doctype] ?? []));
  if (cursor) {
    if (equalBoundary) {
      filters.push(['modified', '=', cursor.modified]);
      if (cursor.name) filters.push(['name', '>=', cursor.name]);
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

const ITEM_PAGE_SIZE = 1000;
// Per batch: 50 invoices x up to ~1000 lines each is far beyond any real invoice; still, hitting it is reported honestly.
const MAX_ITEM_PAGES_PER_BATCH = 50;
// 50 names keep the item URL near 1.5 KB (500 names was ~14 KB and risked rejection, wedging the pass).
const ITEM_BATCH_SIZE = 50;

/** Distinct, non-empty Purchase Order names per invoice, read from the Purchase Invoice Item child rows.
 * A failed or malformed read throws: sending an empty list would silently skip the link check.
 * Request cost: ceil(invoices / 50) item reads (more only for very long invoices) per Purchase Invoice page. */
async function readInvoiceOrders(client: ErpClientDeps, invoiceNames: string[], deadline: number): Promise<Map<string, string[]>> {
  const orders = new Map<string, Set<string>>(invoiceNames.map((n) => [n, new Set<string>()]));
  for (let at = 0; at < invoiceNames.length; at += ITEM_BATCH_SIZE) {
    const batch = invoiceNames.slice(at, at + ITEM_BATCH_SIZE);
    let complete = false;
    for (let page = 0; page < MAX_ITEM_PAGES_PER_BATCH && !complete; page += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new AppError('Purchase mirror pass deadline exceeded', 'external-unreachable');
      const qs = `parent=${encodeURIComponent('Purchase Invoice')}&filters=${encodeURIComponent(JSON.stringify([['parent', 'in', batch]]))}`
        + `&fields=${encodeURIComponent(JSON.stringify(['parent', 'purchase_order']))}`
        + `&limit_page_length=${ITEM_PAGE_SIZE}&limit_start=${page * ITEM_PAGE_SIZE}&order_by=${encodeURIComponent('parent asc, idx asc')}`;
      const body = await erpnextRequest({ ...client, timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remainingMs) },
        { method: 'GET', path: `/api/resource/${encodeURIComponent('Purchase Invoice Item')}?${qs}` });
      const rows = (body as { data?: unknown } | null)?.data;
      if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === 'object' && typeof (r as Record<string, unknown>).parent === 'string')) {
        throw new AppError('ERPNext Purchase Invoice Item list response was malformed', 'external-unreachable');
      }
      for (const r of rows as Array<{ parent: string; purchase_order?: unknown }>) {
        const po = str(r.purchase_order);
        if (po !== null) orders.get(r.parent)?.add(po);
      }
      complete = rows.length < ITEM_PAGE_SIZE;
    }
    if (!complete) {
      throw new AppError(`Purchase Invoice item lines for ${batch.length} invoices exceeded ${MAX_ITEM_PAGES_PER_BATCH * ITEM_PAGE_SIZE} rows; `
        + 'the invoice list was not mirrored (no partial purchase-order list is sent)', 'external-unreachable');
    }
  }
  return new Map([...orders].map(([k, v]) => [k, [...v]]));
}

async function withinBudget<T>(deadline: number, operation: () => PromiseLike<T>): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new AppError('Purchase mirror pass deadline exceeded', 'external-unreachable');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AppError('Purchase mirror pass deadline exceeded', 'external-unreachable')), remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function saveCursor(sc: PurchaseFeedServiceClient, orgId: string, domain: string, previous: string | null, next: string, deadline: number): Promise<void> {
  const table = sc.from('external_sync_watermarks');
  if (previous === null) {
    const { error } = await withinBudget(deadline, () => table.upsert({ org_id: orgId, external_tier: 'erpnext', domain, watermark_cursor: next },
      { onConflict: 'org_id,external_tier,domain', ignoreDuplicates: true }));
    if (error) throw new AppError(error.message, error.code);
  } else {
    const { count, error } = await withinBudget(deadline, () => table.update({ watermark_cursor: next }, { count: 'exact' })
      .eq('org_id', orgId).eq('external_tier', 'erpnext').eq('domain', domain).eq('watermark_cursor', previous));
    if (error) throw new AppError(error.message, error.code);
    if (count === 0) {
      const current = await withinBudget(deadline, () => readWm(sc, orgId, domain));
      if (current !== next) throw new AppError('Purchase feed cursor changed concurrently; resume on the next sweep', 'cursor-conflict');
    }
  }
  const stored = await withinBudget(deadline, () => readWm(sc, orgId, domain));
  if (stored !== next && stored !== previous) throw new AppError('Purchase feed cursor changed concurrently; resume on the next sweep', 'cursor-conflict');
}

// Invoices are written in item-read-sized units so a slow ERP still makes durable progress each pass, and
// each turn handles at most this many units before the other doctypes get theirs (the rest of the page is kept).
const INVOICE_UNITS_PER_TURN = 2;

type Phase = 'all' | 'equal' | 'after';
interface FeedState {
  doctype: PurchaseDoctype; domain: string; stored: string | null; cursor: PurchaseCursor | null; equalityDone: boolean;
  /** Rows of the current list page not yet written, with how that page was read. */
  page?: { rows: Record<string, unknown>[]; full: boolean; phase: Phase };
}

/** Persist each written unit and its cursor before making another remote request. Cursor JSON is a v2 namespace,
 * separate from the shared timestamp-only monotonic feeds; the legacy timestamp is read only to seed it.
 * Each cursor resumes inclusively at its timestamp boundary and then always reads strictly later documents. */
export async function feedPurchaseMirror(sc: PurchaseFeedServiceClient, opts: { client: ErpClientDeps; orgId: string; company: string }): Promise<FeedPurchaseMirrorResult> {
  if (!opts.company?.trim()) throw new AppError('ERPNext company is required for the purchase feed', 'config-rejected');
  const deadline = Date.now() + PASS_BUDGET_MS;
  const transport = { ...opts.client, maxRetries: 0, timeoutMs: REQUEST_TIMEOUT_MS };
  let reads = 0;
  let fed = 0;
  let wroteRows = false;
  let deferred: unknown;
  let outOfTime = false;
  const pending: FeedState[] = [];
  for (const doctype of PURCHASE_DOCTYPES) {
    const domain = purchaseCursorDomain(doctype);
    const stored = await withinBudget(deadline, () => readWm(sc, opts.orgId, domain));
    const legacy = stored === null && !REREAD_DOCTYPES.includes(doctype) ? await withinBudget(deadline, () => readWm(sc, opts.orgId, purchaseWmDomain(doctype))) : null;
    const cursor = parseCursor(stored ?? legacy);
    // Every cursor resumes inclusively: name-bearing cursors replay their boundary row, while legacy
    // and name-less cursors replay the whole timestamp boundary before advancing strictly past it.
    pending.push({ doctype, domain, stored, cursor, equalityDone: false });
  }

  // Alternate durable units so every document type progresses within the shared budget.
  while (pending.length > 0) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const state = pending[0];
    if (!state.page && reads >= MAX_PAGE_READS) break;
    pending.shift();
    const { doctype, domain } = state;
    if (!state.page) {
      const phase: Phase = !state.cursor ? 'all' : state.equalityDone ? 'after' : 'equal';
      const rows = await readPage(transport, doctype, opts.company, state.cursor, phase === 'equal', 0, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
      reads += 1;
      if (rows.length === 0) {
        // A finished boundary always continues with the strictly-later read; anything else is caught up.
        if (phase === 'equal') {
          state.equalityDone = true;
          pending.push(state);
        }
        continue;
      }
      state.page = { rows, full: rows.length >= PAGE_SIZE, phase };
    }

    const page = state.page;
    const isInvoice = doctype === 'Purchase Invoice';
    const unitSize = isInvoice ? ITEM_BATCH_SIZE : PAGE_SIZE;
    let units = 0;
    try {
      while (page.rows.length > 0 && (!isInvoice || units < INVOICE_UNITS_PER_TURN)) {
        // Start an invoice unit only when its item read can finish within the pass; the rest waits for the next sweep.
        if (isInvoice && deadline - Date.now() <= REQUEST_TIMEOUT_MS) { outOfTime = true; break; }
        const unit = page.rows.slice(0, unitSize);
        const latest = new Map<string, PurchaseMirrorRow>();
        for (const source of unit) {
          const row = toPurchaseMirrorRow(doctype, source);
          if (!row) continue;
          const existing = latest.get(row.erp_name);
          if (!existing || row.erp_modified > existing.erp_modified) latest.set(row.erp_name, row);
        }
        if (isInvoice && latest.size > 0) {
          const orders = await readInvoiceOrders(transport, [...latest.keys()], deadline);
          for (const [name, row] of latest) row.purchase_orders = orders.get(name) ?? [];
        }
        if (latest.size > 0) {
          const { data, error } = await withinBudget(deadline, () => sc.rpc('upsert_erp_purchase_documents', { p_org_id: opts.orgId, p_rows: [...latest.values()] }));
          if (error) throw new AppError(error.message, error.code);
          fed += Number(data ?? 0);
          wroteRows = true;
        }
        const last = unit[unit.length - 1];
        const cursor: PurchaseCursor = { version: CURSOR_VERSION, modified: String(last.modified), name: String(last.name) };
        const next = encodeCursor(cursor);
        await saveCursor(sc, opts.orgId, domain, state.stored, next, deadline);
        state.cursor = cursor;
        state.stored = next;
        page.rows = page.rows.slice(unit.length);
        units += 1;
      }
    } catch (error) {
      // Invoice enrichment failures leave the invoice cursor at its last written unit and let the other doctypes
      // run; the pass still fails once they have had their turn. Other failures stop the pass immediately.
      if (!isInvoice || deadline - Date.now() <= 0) throw error;
      deferred ??= error;
      continue;
    }
    if (page.rows.length > 0) {
      if (!outOfTime) pending.push(state);
      continue;
    }
    state.page = undefined;
    // A short page ends the boundary (go strictly later) or the feed (strictly-later/initial read); a full page
    // resumes inclusively at its last row.
    if (page.full || page.phase === 'equal') {
      state.equalityDone = !page.full;
      pending.push(state);
    }
  }
  if (deferred !== undefined) throw deferred;
  if (!wroteRows) {
    const { error } = await withinBudget(deadline, () => sc.rpc('upsert_erp_purchase_documents', { p_org_id: opts.orgId, p_rows: [] }));
    if (error) throw new AppError(error.message, error.code);
  }
  return { fed, caughtUp: pending.length === 0 && !outOfTime };
}
