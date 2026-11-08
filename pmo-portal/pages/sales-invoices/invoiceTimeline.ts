import type { TFunction } from 'i18next';
import type { LifecycleStep } from '@/src/components/ui/LifecycleStepper';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** Draft → Submitted → Received by client → Paid, read from fields the row already carries (dates stay in the key facts and delivery block, not repeated here). Cancelled has no forward path. */
export function invoiceTimelineSteps(inv: Pick<SalesInvoiceRow, 'status' | 'received_date'>, t: TFunction): LifecycleStep[] | null {
  if (inv.status === 'Cancelled') return null;
  const reached = inv.status === 'Paid' ? 3 : inv.status === 'Draft' ? 0 : inv.received_date ? 2 : 1;
  const labels = [
    t('finance:invoiceTimeline.draft', 'Draft'),
    t('finance:invoiceTimeline.submitted', 'Submitted'),
    t('finance:invoiceTimeline.received', 'Received by client'),
    t('finance:invoiceTimeline.paid', 'Paid'),
  ];
  return labels.map((label, i) => ({
    label,
    state: i < reached ? 'done' : i === reached ? (i === 3 ? 'paid' : 'current') : 'upcoming',
  }));
}
