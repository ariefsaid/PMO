/**
 * ERP purchase documents (0335/0360/0361). Read: `erp_purchase_documents_linked` (RLS-scoped; procurementId = the purchase a
 * document is linked to, null = orphan). Write: only through the link/unlink RPCs (ADR-0093: linked, never adopted, never
 * pushed). Their cost reaches Actuals through the GL mirror only, so nothing here is summed into spent/committed.
 */
import { supabase } from '@/src/lib/supabase/client';
import type { Json } from '@/src/lib/supabase/database.types';
import { fetchAllRowsByKeyset, type PageResult } from '@/src/lib/pagedRead';
import { AppError } from '@/src/lib/appError';

export type ErpPurchaseDoctype = 'Purchase Order' | 'Purchase Receipt' | 'Purchase Invoice' | 'Payment Entry';

export interface ErpPurchaseRow {
  id: string;
  doctype: ErpPurchaseDoctype;
  name: string;
  supplier: string | null;
  docDate: string | null;
  dueDate: string | null;
  billNo: string | null;
  currency: string | null;
  grandTotal: number | null;
  netTotal: number | null;
  outstanding: number | null;
  erpStatus: string | null;
  isReturn: boolean;
  projectIds: string[];
  /** The purchase this document is linked to; null = not in a purchase (an orphan). */
  procurementId: string | null;
  linkId: string | null;
}

/** One row of a link call (FR-PFE-020/026): no procurement_id = a new purchase for it. */
export interface ErpLinkRow {
  erp_doctype?: ErpPurchaseDoctype;
  erp_name: string;
  procurement_id?: string | null;
  project_id?: string | null;
  group?: string;
  title?: string;
  budget_category?: string | null;
  sharepoint?: { drive_id: string; item_id: string; web_url: string; name: string; kind: 'file' | 'folder' };
}

export interface ErpLinkResult {
  row: number;
  erp_doctype: ErpPurchaseDoctype | null;
  erp_name: string | null;
  outcome: 'link' | 'skip' | 'refused';
  /** FR-PFE-023 reason code, or a guard's own sentence (e.g. the SoD refusal). */
  reason: string | null;
  procurement_id: string | null;
  new_purchase: boolean;
}

export interface ErpLinkResponse {
  dry_run: boolean;
  counts: { link: number; skip: number; refused: number };
  results: ErpLinkResult[];
}

const COLUMNS =
  'id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency, grand_total, net_total, outstanding_amount, erp_status, is_return, project_ids, procurement_id, link_id';

/** The view row as selected by COLUMNS (snake_case DB shape; the view's id is the document's primary key). */
type Raw = {
  id: string; erp_doctype: string; erp_name: string; supplier: string | null; supplier_name: string | null;
  doc_date: string | null; due_date: string | null; bill_no: string | null; currency: string | null;
  grand_total: number | string | null; net_total: number | string | null; outstanding_amount: number | string | null;
  erp_status: string | null; is_return: boolean | null; project_ids: string[] | null;
  /** Absent on the orphan view (an orphan is, by definition, not linked). */
  procurement_id?: string | null; link_id?: string | null;
};

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

const toRow = (r: Raw): ErpPurchaseRow => ({
  id: r.id,
  doctype: r.erp_doctype as ErpPurchaseDoctype,
  name: r.erp_name,
  supplier: r.supplier_name ?? r.supplier,
  docDate: r.doc_date,
  dueDate: r.due_date,
  billNo: r.bill_no,
  currency: r.currency,
  grandTotal: num(r.grand_total),
  netTotal: num(r.net_total),
  outstanding: num(r.outstanding_amount),
  erpStatus: r.erp_status,
  isReturn: r.is_return === true,
  projectIds: r.project_ids ?? [],
  procurementId: r.procurement_id ?? null,
  linkId: r.link_id ?? null,
});

const byDateDesc = (a: ErpPurchaseRow, b: ErpPurchaseRow) =>
  (b.docDate ?? '').localeCompare(a.docDate ?? '') || a.name.localeCompare(b.name);

/** Submitted documents PMO did not push, linked or not (aging needs both; orphans = procurementId null). Paged past max_rows. */
export async function listErpPurchases(projectId?: string): Promise<ErpPurchaseRow[]> {
  const rows = await fetchAllRowsByKeyset<Raw>((afterId, limit) => {
    let q = supabase.from('erp_purchase_documents_linked').select(COLUMNS).eq('erp_docstatus', 1).eq('pmo_owned', false);
    if (projectId) q = q.contains('project_ids', [projectId]);
    q = q.order('id', { ascending: true });
    // The view types every column nullable; `id` is the document's primary key, so it is never null here.
    return (afterId === null ? q : q.gt('id', afterId)).limit(limit) as unknown as PromiseLike<PageResult<Raw>>;
  });
  return rows.map(toRow).sort(byDateDesc);
}

const ORPHAN_COLUMNS =
  'id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency, grand_total, net_total, outstanding_amount, erp_status, is_return, project_ids';

/**
 * The default orphan list: submitted ERP documents in no purchase, with the ones set aside left out — the same view the
 * presence check reads, so the count, the indicator and the rows agree. Paged past max_rows.
 */
export async function listErpOrphans(projectId?: string): Promise<ErpPurchaseRow[]> {
  const rows = await fetchAllRowsByKeyset<Raw>((afterId, limit) => {
    let q = supabase.from('erp_purchase_orphans').select(ORPHAN_COLUMNS);
    if (projectId) q = q.contains('project_ids', [projectId]);
    q = q.order('id', { ascending: true });
    return (afterId === null ? q : q.gt('id', afterId)).limit(limit) as unknown as PromiseLike<PageResult<Raw>>;
  });
  return rows.map(toRow).sort(byDateDesc);
}

/** Whether the org has any orphan — decides if Procurement links to the "not in a purchase" list at all. */
export async function hasErpPurchases(): Promise<boolean> {
  const { data, error } = await supabase.from('erp_purchase_orphans').select('id').limit(1);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).length > 0;
}

/** FR-PFE-032 — the ERP documents linked to one purchase. */
export async function listLinkedErpDocuments(procurementId: string): Promise<ErpPurchaseRow[]> {
  const { data, error } = await supabase.from('erp_purchase_documents_linked').select(COLUMNS).eq('procurement_id', procurementId);
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as Raw[]).map(toRow).sort(byDateDesc);
}

/** FR-PFE-020/030 — link (or dry-run) rows; per-row outcomes come back, refusals included. */
export async function linkErpPurchaseDocuments(rows: ErpLinkRow[], dryRun = false): Promise<ErpLinkResponse> {
  const { data, error } = await supabase.rpc('link_erp_purchase_documents', { p_rows: rows as unknown as Json, p_dry_run: dryRun });
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as ErpLinkResponse;
}

/** FR-PFE-031 — Admin/Finance; the RPC is the authority. */
export async function unlinkErpPurchaseDocument(linkId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_erp_purchase_document', { p_link_id: linkId });
  if (error) throw new AppError(error.message, error.code);
}

// Repository wrapper (ADR-0017 seam) — moved here from the composition root (T-29).
import { wrap } from './repositoryErrors';
import type { ErpPurchaseRepository } from './contracts/erpPurchases';

export const erpPurchasesRepository: ErpPurchaseRepository = {
  list: (projectId) => wrap(() => listErpPurchases(projectId)),
  listOrphans: (projectId) => wrap(() => listErpOrphans(projectId)),
  hasAny: () => wrap(() => hasErpPurchases()),
  listLinked: (procurementId) => wrap(() => listLinkedErpDocuments(procurementId)),
  link: (rows, dryRun) => wrap(() => linkErpPurchaseDocuments(rows, dryRun ?? false)),
  unlink: (linkId) => wrap(() => unlinkErpPurchaseDocument(linkId)),
};
