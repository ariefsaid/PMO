/**
 * #2595 (AC-CWO-015): the derived view of a candidate work order's assessment checklist. Pure: `today` is the
 * organisation's calendar date as 'YYYY-MM-DD' (useOrgToday), never read from the browser clock here.
 * The database refuses an accept that this says is not ready (decide_work_order_candidate); this only explains it.
 */
export type AssessmentStatus = 'open' | 'passed' | 'failed' | 'not_applicable';

export interface AssessmentItem {
  id: string;
  label: string;
  position: number;
  required: boolean;
  status: AssessmentStatus;
  target_date: string | null;
}

export interface Assessment<T extends AssessmentItem> {
  requiredCount: number;
  /** Required items that are passed or not applicable. */
  readyRequired: number;
  readyToAccept: boolean;
  /** Required items that are not ready: what an accept would be refused for. */
  blocking: T[];
  /** Items still open or failed whose target date is before today. */
  overdue: T[];
}

const isReady = (status: AssessmentStatus) => status === 'passed' || status === 'not_applicable';

export function deriveAssessment<T extends AssessmentItem>(items: readonly T[], today: string): Assessment<T> {
  const required = items.filter((i) => i.required);
  const blocking = required.filter((i) => !isReady(i.status));
  return {
    requiredCount: required.length,
    readyRequired: required.length - blocking.length,
    readyToAccept: blocking.length === 0,
    blocking,
    overdue: items.filter((i) => !isReady(i.status) && i.target_date !== null && i.target_date < today),
  };
}
