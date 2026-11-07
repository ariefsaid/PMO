import type { WorkOrderStatus } from '@/src/lib/db/workOrders';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import { toCents } from '@/src/lib/moneyCents';

/**
 * Work-order billing, derived for display (OD-BILL-1, DD-BWO-1..3 / 10). The figures come from the view
 * `work_order_billing` (0262); these helpers only classify and add them, in integer cents. The database is the
 * authority on what may be invoiced — `canInvoiceWorkOrder` only decides whether to OFFER the button.
 */
export type WorkOrderBillingState =
  | 'not-billable' | 'incomplete' | 'over-invoiced' | 'not-invoiced' | 'paid' | 'awaiting-submission' | 'fully-invoiced'
  | 'partly-invoiced';

const BILLABLE: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>(['Issued', 'Closed']);

export function deriveWorkOrderBillingState(status: WorkOrderStatus, f: WorkOrderBillingRow): WorkOrderBillingState {
  if (!f.figuresComplete) return 'incomplete';
  if (toCents(f.remaining) < 0) return 'over-invoiced';
  if (!BILLABLE.has(status)) return 'not-billable';
  if (toCents(f.invoiced) + toCents(f.pending) <= 0) return 'not-invoiced';
  // DD-BWO-2: Paid = nothing left, nothing in draft, every submitted invoice Paid.
  if (toCents(f.remaining) === 0 && toCents(f.pending) === 0 && f.unpaidCount === 0) return 'paid';
  // Nothing left, but some of it only in a draft or an unraised claim: not invoiced until someone submits it (#785).
  if (toCents(f.remaining) === 0 && toCents(f.pending) > 0) return 'awaiting-submission';
  if (toCents(f.remaining) === 0) return 'fully-invoiced';
  return 'partly-invoiced';
}

export function canInvoiceWorkOrder(status: WorkOrderStatus, f: WorkOrderBillingRow): boolean {
  return BILLABLE.has(status) && f.figuresComplete && toCents(f.remaining) > 0;
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
    invoiced += toCents(r.invoiced);
    paid += toCents(r.paid);
    draft += toCents(r.pending);
    still += Math.max(0, toCents(r.remaining));
  }
  return { invoiced: invoiced / 100, paid: paid / 100, inDraft: draft / 100, stillToInvoice: still / 100, complete };
}

export type InvoiceAmountProblem = 'invalid' | 'not-positive' | 'over-remaining';

/** The dialog's check; the database repeats it (and counts in-flight commands the client cannot see). */
export function invoiceAmountProblem(amount: number | null, remaining: number): InvoiceAmountProblem | null {
  if (amount === null || !Number.isFinite(amount)) return 'invalid';
  if (toCents(amount) <= 0) return 'not-positive';
  if (toCents(amount) > toCents(remaining)) return 'over-remaining';
  return null;
}
