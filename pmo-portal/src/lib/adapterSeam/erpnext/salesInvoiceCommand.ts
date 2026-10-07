/**
 * salesInvoiceCommand.ts — the ONE builder of a sales-invoice CREATE command's fields, shared by the FE
 * repository (revenue.createInvoice) and the agent's draft_invoice (#787, ADR-0079 §4), so the two clients of
 * the money path can never send different shapes. Leaf (no imports): Deno-importable. The caller adds `id`.
 */
export interface SalesInvoiceLine { item_code: string; qty: number; rate: number; description?: string }
export interface SalesInvoiceCreateInput {
  customerId: string;
  projectId?: string | null;
  items: SalesInvoiceLine[];
  /** Client PO / contract ref (→ ERPNext po_no). Omit to let the dispatch fall back to the work order / project. */
  reference_number?: string | null;
  /** OD-BILL-1 (DD-BWO-8): the work order this invoice bills. The outbox fence (0262) refuses one that is not Issued or
   *  Closed, is on another project, or has too little left. */
  workOrderId?: string | null;
}
export function salesInvoiceCreateFields(input: SalesInvoiceCreateInput): Record<string, unknown> {
  return { ...input, erp_doc_kind: 'sales-invoice' };
}
