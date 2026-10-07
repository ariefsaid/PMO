import type { WorkOrderStatus } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';

/**
 * Work-order billing, derived for display (OD-BILL-1, DD-BWO-1..3 / 10). The figures come from the view
 * `work_order_billing` (0262); these helpers only classify and add them, in integer cents. The database is the
 * authority on what may be invoiced — `canInvoiceWorkOrder` only decides whether to OFFER the button.
 */
export type WorkOrderBillingState =
  | 'not-billable' | 'incomplete' | 'over-invoiced' | 'not-invoiced' | 'paid' | 'fully-invoiced' | 'partly-invoiced';

const cents = (value: number): number => Math.round(value * 100);
const BILLABLE: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>(['Issued', 'Closed']);

export function deriveWorkOrderBillingState(status: WorkOrderStatus, f: WorkOrderBillingRow): WorkOrderBillingState {
  if (!f.figuresComplete) return 'incomplete';
  if (cents(f.remaining) < 0) return 'over-invoiced';
  if (!BILLABLE.has(status)) return 'not-billable';
  if (cents(f.invoiced) + cents(f.pending) <= 0) return 'not-invoiced';
  // DD-BWO-2: Paid = nothing left, nothing in draft, every submitted invoice Paid.
  if (cents(f.remaining) === 0 && cents(f.pending) === 0 && f.unpaidCount === 0) return 'paid';
  if (cents(f.remaining) === 0) return 'fully-invoiced';
  return 'partly-invoiced';
}

export function canInvoiceWorkOrder(status: WorkOrderStatus, f: WorkOrderBillingRow): boolean {
  return BILLABLE.has(status) && f.figuresComplete && cents(f.remaining) > 0;
}

export interface ProjectWorkOrderBillingTotals {
  invoiced: number;
  paid: number;
  /** Drafts and unraised claims (`pending`): they use up the work order but are not invoiced yet (DD-BWO-2). */
  inDraft: number;
  stillToInvoice: number;
  /** false when any Issued/Closed work order's figures cannot be totalled — render "Unavailable", never a sum. */
  complete: boolean;
}

/** AC-UNB-002: totals over the project's Issued and Closed work orders; an over-invoiced one adds nothing left. */
export function summarizeProjectWorkOrderBilling(rows: ReadonlyArray<WorkOrderBillingRow>): ProjectWorkOrderBillingTotals {
  let invoiced = 0;
  let paid = 0;
  let draft = 0;
  let still = 0;
  let complete = true;
  for (const r of rows) {
    if (!BILLABLE.has(r.status)) continue;
    if (!r.figuresComplete) {
      complete = false;
      continue;
    }
    invoiced += cents(r.invoiced);
    paid += cents(r.paid);
    draft += cents(r.pending);
    still += Math.max(0, cents(r.remaining));
  }
  return { invoiced: invoiced / 100, paid: paid / 100, inDraft: draft / 100, stillToInvoice: still / 100, complete };
}

export type InvoiceAmountProblem = 'invalid' | 'not-positive' | 'over-remaining';

/** The dialog's check; the database repeats it (and counts in-flight commands the client cannot see). */
export function invoiceAmountProblem(amount: number | null, remaining: number): InvoiceAmountProblem | null {
  if (amount === null || !Number.isFinite(amount)) return 'invalid';
  if (cents(amount) <= 0) return 'not-positive';
  if (cents(amount) > cents(remaining)) return 'over-remaining';
  return null;
}
