import type { PurchaseKind } from './nextStep.ts';
const POSTED_PAYMENT = ['posted', 'in_process', 'paid'];
export function purchaseStatus(kind: PurchaseKind, state: string, residual?: string): { status: string; cancelled: boolean } {
  const cancelled = state === 'cancel' || state === 'cancelled' || state === 'canceled';
  switch (kind) {
    case 'order': return { status: cancelled ? 'Closed' : ['purchase', 'done'].includes(state) ? 'Issued' : 'Draft', cancelled };
    case 'receipt': return { status: state === 'done' ? 'Complete' : 'Partial', cancelled };
    case 'bill': return { status: state === 'posted' && residual != null && /^0+(?:\.0+)?$/.test(residual) ? 'Paid' : 'Received', cancelled };
    case 'payment': return { status: POSTED_PAYMENT.includes(state) ? 'Posted' : 'Draft', cancelled };
  }
}
/** The number the mirror's `erp_docstatus` stores: 1 issued, done or posted, 2 cancelled, 0 anything else (an unknown state is never read as money). */
export function purchaseDocstatus(kind: PurchaseKind, state: string): 0 | 1 | 2 {
  if (purchaseStatus(kind, state).cancelled || state === 'rejected') return 2;
  switch (kind) {
    case 'order': return state === 'purchase' || state === 'done' ? 1 : 0;
    case 'receipt': return state === 'done' ? 1 : 0;
    case 'bill': return state === 'posted' ? 1 : 0;
    case 'payment': return POSTED_PAYMENT.includes(state) ? 1 : 0;
  }
}

/**
 * What a vendor bill shows about its payment (FR-OPP-054, AC-OPP-055): Paid only when Odoo's own residual is zero on a posted bill;
 * a payment Odoo accepted that the last read does not yet show settled is "payment sent, awaiting Odoo"; otherwise unpaid.
 */
export function billPaymentView(bill: { state: string; residual: string | null; paymentsSent: number }): 'paid' | 'awaiting-odoo' | 'unpaid' {
  if (purchaseStatus('bill', bill.state, bill.residual ?? undefined).status === 'Paid') return 'paid';
  return bill.state === 'posted' && bill.paymentsSent > 0 ? 'awaiting-odoo' : 'unpaid';
}
