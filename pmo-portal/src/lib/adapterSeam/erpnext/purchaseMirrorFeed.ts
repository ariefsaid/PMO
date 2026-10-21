/**
 * erpnext/purchaseMirrorFeed.ts (FR-EPR-001..004, docs/specs/erp-purchases-readonly.spec.md) — the sweep pass
 * that mirrors ERP-native Purchase Orders / Purchase Invoices into `erp_purchase_documents` (0335) for a
 * READ-ONLY list. DD-XING-2: read, never adopted — nothing here creates a PMO procurement case, and nothing
 * sums these rows into spent/committed/actuals (their cost already arrives through the GL mirror).
 *
 * Per doctype: read the `purchases::<doctype>` watermark, list submitted/cancelled docs `modified >=` it,
 * hand them to `upsert_erp_purchase_documents` (newer-or-equal `modified` wins; the RPC also re-stamps
 * project attribution + the PMO-owned flag for the whole org), then advance the watermark. Drafts are never
 * listed: draft → submitted → cancelled each bump `modified`, so a document is re-read at every state it can
 * be shown in (#901's rule — never filter on a state the original can leave unseen — holds).
 */
import { AppError } from '../../appError.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import { advanceWm, readWm, type LedgerFeedServiceClient } from './ledgerMirrorFeed.ts';

export type PurchaseDoctype = 'Purchase Order' | 'Purchase Invoice';
export const PURCHASE_DOCTYPES: readonly PurchaseDoctype[] = ['Purchase Order', 'Purchase Invoice'];
export const purchaseWmDomain = (doctype: PurchaseDoctype) => `purchases::${doctype}`;

const FIELDS: Record<PurchaseDoctype, readonly string[]> = {
  'Purchase Order': ['name', 'supplier', 'supplier_name', 'transaction_date', 'schedule_date', 'currency',
    'grand_total', 'status', 'docstatus', 'project', 'modified'],
  'Purchase Invoice': ['name', 'supplier', 'supplier_name', 'posting_date', 'due_date', 'bill_no', 'currency',
    'grand_total', 'outstanding_amount', 'status', 'docstatus', 'is_return', 'project', 'modified'],
};
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

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

export function toPurchaseMirrorRow(doctype: PurchaseDoctype, d: Record<string, unknown>): PurchaseMirrorRow {
  const isPi = doctype === 'Purchase Invoice';
  return {
    erp_doctype: doctype,
    erp_name: String(d.name),
    supplier: str(d.supplier),
    supplier_name: str(d.supplier_name) ?? str(d.supplier),
    doc_date: str(isPi ? d.posting_date : d.transaction_date),
    due_date: str(isPi ? d.due_date : d.schedule_date),
    bill_no: isPi ? str(d.bill_no) : null,
    currency: str(d.currency),
    grand_total: str(d.grand_total),
    outstanding_amount: isPi ? str(d.outstanding_amount) : null,
    erp_status: str(d.status),
    erp_docstatus: Number(d.docstatus),
    is_return: Boolean(d.is_return),
    erp_project: str(d.project),
    erp_modified: String(d.modified),
  };
}

async function fetchSince(client: ErpClientDeps, doctype: PurchaseDoctype, company: string, since: string | null) {
  const filters: unknown[] = [['company', '=', company], ['docstatus', 'in', [1, 2]]];
  if (since) filters.push(['modified', '>=', since]);
  const docs: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = `filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(JSON.stringify(FIELDS[doctype]))}`
      + `&limit_page_length=${PAGE_SIZE}&limit_start=${page * PAGE_SIZE}&order_by=${encodeURIComponent('modified asc, name asc')}`;
    const body = await erpnextRequest(client, { method: 'GET', path: `/api/resource/${encodeURIComponent(doctype)}?${qs}` });
    const rows = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === 'object' && typeof (r as Record<string, unknown>).name === 'string'
      && typeof (r as Record<string, unknown>).modified === 'string')) {
      throw new AppError(`ERPNext ${doctype} list response was malformed`, 'external-unreachable');
    }
    docs.push(...(rows as Record<string, unknown>[]));
    if (rows.length < PAGE_SIZE) return { docs, caughtUp: true };
  }
  return { docs, caughtUp: false };
}

/** Feed both purchase doctypes for one org. Always calls the RPC (even with no rows) so a project remap
 *  re-stamps attribution on the next tick without a refetch (FR-EPR-003). */
export async function feedPurchaseMirror(
  sc: PurchaseFeedServiceClient,
  opts: { client: ErpClientDeps; orgId: string; company: string },
): Promise<FeedPurchaseMirrorResult> {
  if (!opts.company?.trim()) throw new AppError('ERPNext company is required for the purchase feed', 'config-rejected');
  let fed = 0;
  let caughtUp = true;
  for (const doctype of PURCHASE_DOCTYPES) {
    const domain = purchaseWmDomain(doctype);
    const prev = await readWm(sc, opts.orgId, domain);
    const result = await fetchSince(opts.client, doctype, opts.company, prev);
    const rows = result.docs.map((d) => toPurchaseMirrorRow(doctype, d));
    const { data, error } = await sc.rpc('upsert_erp_purchase_documents', { p_org_id: opts.orgId, p_rows: rows });
    if (error) throw new AppError(error.message, error.code);
    fed += Number(data ?? 0);
    caughtUp &&= result.caughtUp;
    let next: string | null = null;
    for (const r of rows) if (next === null || r.erp_modified > next) next = r.erp_modified;
    await advanceWm(sc, opts.orgId, domain, next, prev);
  }
  return { fed, caughtUp };
}
