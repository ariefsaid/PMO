import type { WaitingCloseoutItem } from '@/src/lib/db/closeoutChecklist';

export interface WaitingCloseoutItemsFact {
  count: number;
  overdue: number;
  href: string;
}

/** The needs-you pointer for the viewer's waiting close-out items; null when none. Derived on read: nothing to clear when an item is done. */
export function summariseWaitingCloseoutItems(rows: ReadonlyArray<WaitingCloseoutItem>, today: string): WaitingCloseoutItemsFact | null {
  if (rows.length === 0) return null;
  const overdue = rows.filter((r) => r.dueOn !== null && r.dueOn < today).length;
  const one = new Set(rows.map((r) => r.workOrderId)).size === 1 ? rows[0].workOrderId : null;
  return { count: rows.length, overdue, href: one ? `/work-orders/${encodeURIComponent(one)}` : '/work-orders' };
}
