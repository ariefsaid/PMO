/**
 * FR-EPR-006/007 — client read of the ERP purchases read model (0335). SELECT-only; RLS scopes the org and the
 * audience. DD-XING-2: these are ERP-native documents shown for visibility — never adopted, never summed into
 * spent/committed (their cost already reaches Actuals through the GL mirror).
 */
import { supabase } from '@/src/lib/supabase/client';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import { AppError } from '@/src/lib/appError';

export type ErpPurchaseDoctype = 'Purchase Order' | 'Purchase Invoice';

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
  outstanding: number | null;
  erpStatus: string | null;
  isReturn: boolean;
  projectIds: string[];
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** Submitted documents PMO did not push itself (those show as procurement cases). Paged past PostgREST's cap. */
export async function listErpPurchases(projectId?: string): Promise<ErpPurchaseRow[]> {
  const rows = await fetchAllRowsByKeyset((afterId, limit) => {
    let q = supabase.from('erp_purchase_documents')
      .select('id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency, grand_total, outstanding_amount, erp_status, is_return, project_ids')
      .eq('erp_docstatus', 1).eq('pmo_owned', false);
    if (projectId) q = q.contains('project_ids', [projectId]);
    q = q.order('id', { ascending: true });
    return (afterId === null ? q : q.gt('id', afterId)).limit(limit);
  });
  return rows
    .map((r) => ({
      id: r.id,
      doctype: r.erp_doctype as ErpPurchaseDoctype,
      name: r.erp_name,
      supplier: r.supplier_name ?? r.supplier,
      docDate: r.doc_date,
      dueDate: r.due_date,
      billNo: r.bill_no,
      currency: r.currency,
      grandTotal: num(r.grand_total),
      outstanding: num(r.outstanding_amount),
      erpStatus: r.erp_status,
      isReturn: r.is_return,
      projectIds: r.project_ids ?? [],
    }))
    .sort((a, b) => (b.docDate ?? '').localeCompare(a.docDate ?? '') || a.name.localeCompare(b.name));
}

/** Whether the org has any listable ERP purchase — decides if Procurement links to the list at all. */
export async function hasErpPurchases(): Promise<boolean> {
  const { data, error } = await supabase.from('erp_purchase_documents').select('id')
    .eq('erp_docstatus', 1).eq('pmo_owned', false).limit(1);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).length > 0;
}
