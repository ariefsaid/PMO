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
