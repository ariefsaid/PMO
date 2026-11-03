import type { PurchaseKind } from './nextStep.ts';
export function purchaseStatus(kind: PurchaseKind, state: string, residual?: string): { status: string; cancelled: boolean } {
  const cancelled = state === 'cancel' || state === 'cancelled';
  switch (kind) {
    case 'order': return { status: cancelled ? 'Closed' : ['purchase', 'done'].includes(state) ? 'Issued' : 'Draft', cancelled };
    case 'receipt': return { status: state === 'done' ? 'Complete' : 'Partial', cancelled };
    case 'bill': return { status: state === 'posted' && residual != null && /^0+(?:\.0+)?$/.test(residual) ? 'Paid' : 'Received', cancelled };
    case 'payment': return { status: state === 'posted' || state === 'paid' ? 'Posted' : 'Draft', cancelled };
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
