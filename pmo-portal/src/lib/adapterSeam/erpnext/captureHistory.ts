/** ERPNext mirror translation at the adapter boundary; no source-specific names escape it. */
import type { CaptureKind, CaptureSource, CaptureState } from '../captureHistory.ts';
import type { PurchaseDoctype } from './purchaseMirrorFeed.ts';

export interface CaptureMirrorRow {
  id: string;
  erp_doctype: PurchaseDoctype;
  erp_name: string;
  erp_docstatus: number;
  erp_status: string | null;
  erp_modified: string;
  project_ids: string[];
  procurement_id: string | null;
  supplier: string | null;
  supplier_name: string | null;
  doc_date: string | null;
  currency: string | null;
  net_total: string | null;
  is_return: boolean;
  purchase_orders: string[];
}

const KINDS: Record<PurchaseDoctype, CaptureKind> = {
  'Purchase Order': 'order', 'Purchase Receipt': 'receipt', 'Purchase Invoice': 'supplier_invoice', 'Payment Entry': 'supplier_payment',
};

export function normalisePurchaseMirror(row: CaptureMirrorRow): CaptureSource {
  if (!row.id || !row.erp_modified) throw new Error('source identity and revision are required');
  const kind: CaptureKind = row.is_return ? 'adjustment' : KINDS[row.erp_doctype];
  let state: CaptureState;
  if (row.erp_docstatus === 2) state = 'cancelled';
  else if (row.erp_docstatus !== 1) state = 'draft';
  else if (kind === 'order') state = 'ordered';
  else if (kind === 'receipt') state = 'received';
  else if (kind === 'supplier_payment' || row.erp_status === 'Paid') state = 'paid';
  else if (row.erp_status === 'Partly Paid') state = 'part_paid';
  else state = 'invoiced';
  return { id: row.id, kind, state, projectIds: row.project_ids, version: row.erp_modified,
    purchaseId: row.procurement_id, reference: row.erp_name, supplier: row.supplier,
    supplierName: row.supplier_name, date: row.doc_date, currency: row.currency,
    amount: row.net_total, parentIds: row.purchase_orders };
}
