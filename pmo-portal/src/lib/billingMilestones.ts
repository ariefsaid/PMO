import type { WorkOrderStatus } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

/**
 * #1640 (OD-GRILL-20261101): a work order shown as a billing milestone. Derived from the shipped view
 * `work_order_billing` on every read, never stored (DD-BWO-2). The DB stays the authority on what may be invoiced.
 */
export type BillingMilestoneStatus = 'unknown' | 'planned' | 'in-progress' | 'invoiced' | 'paid';

const cents = (value: number): number => Math.round(value * 100);

export function deriveBillingMilestoneStatus(
  status: WorkOrderStatus, f: WorkOrderBillingRow,
): { status: BillingMilestoneStatus; overInvoiced: boolean } {
  if (!f.figuresComplete) return { status: 'unknown', overInvoiced: false };
  const overInvoiced = cents(f.remaining) < 0;
  if (status === 'Draft' || cents(f.invoiced) + cents(f.pending) <= 0) return { status: 'planned', overInvoiced };
  if (cents(f.remaining) > 0 || cents(f.pending) > 0) return { status: 'in-progress', overInvoiced };
  if (f.unpaidCount > 0) return { status: 'invoiced', overInvoiced };
  return { status: 'paid', overInvoiced };
}

interface Dated { id: string; wo_number: string | null; end_date: string | null; start_date: string | null; order_date: string | null }

/** FR-WOMS-004: milestone date = end, else start, else order date (ISO dates compare as strings); undated last. */
export function sortBillingMilestones<T extends Dated>(rows: readonly T[]): T[] {
  const key = (r: T) => r.end_date ?? r.start_date ?? r.order_date;
  return [...rows].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka < kb ? -1 : 1;
    const na = a.wo_number ?? '￿'; const nb = b.wo_number ?? '￿';
    if (na !== nb) return na < nb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
