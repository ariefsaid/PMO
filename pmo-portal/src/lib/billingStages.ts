/**
 * #2522 — pure date arithmetic for billing stages (docs/specs/billing-stages.spec.md FR-BST-030..032). Dates are ISO
 * `YYYY-MM-DD` calendar days in the organisation's zone (the server's `native_org_today`); no clock is read here, the
 * caller passes today, so the figures are the same on every device.
 */

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function iso(y: number, monthIndex: number, d: number): string {
  return new Date(Date.UTC(y, monthIndex, d)).toISOString().slice(0, 10);
}

/** Days a stage has been current: start to completion, or to today while open. Null before it starts. */
export function stageAgeDays(stage: { startedOn: string | null; completedOn: string | null }, today: string): number | null {
  if (!stage.startedOn) return null;
  return dayNumber(stage.completedOn ?? today) - dayNumber(stage.startedOn);
}

/** Index of the first stage neither completed nor marked not needed (the current one), or null when none is left. */
export function currentStageIndex(stages: ReadonlyArray<{ completedOn: string | null; skippedOn?: string | null }>): number | null {
  const i = stages.findIndex((s) => !s.completedOn && !s.skippedOn);
  return i === -1 ? null : i;
}

/**
 * #2592 — a current stage is overdue when its age in calendar days is greater than its target (FR-BSX-010). Returns the age and
 * the target for the label, or null: no target, not started, completed or skipped, or still within the target. The server's job
 * applies the same rule on the organisation's calendar (`notify_overdue_billing_stages`).
 */
export function stageOverdue(
  stage: { startedOn: string | null; completedOn: string | null; skippedOn?: string | null; targetDays?: number | null },
  today: string,
): { age: number; target: number } | null {
  if (stage.targetDays == null || stage.completedOn || stage.skippedOn) return null;
  const age = stageAgeDays({ startedOn: stage.startedOn, completedOn: null }, today);
  return age !== null && age > stage.targetDays ? { age, target: stage.targetDays } : null;
}

export interface InvoiceDeadline {
  date: string;
  daysLeft: number;
  warn: boolean;
}

/**
 * The next monthly invoice deadline on or after today: this month's day (clamped to the month's last day), or next
 * month's once this month's has passed. Warns when the days left are within the window.
 */
export function nextInvoiceDeadline(today: string, day: number | null, warnDays: number): InvoiceDeadline | null {
  if (day == null) return null;
  const [y, m] = today.split('-').map(Number);
  const inMonth = (year: number, monthIndex: number) => {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return iso(year, monthIndex, Math.min(day, last));
  };
  let date = inMonth(y, m - 1);
  if (dayNumber(date) < dayNumber(today)) date = inMonth(m === 12 ? y + 1 : y, m % 12);
  const daysLeft = dayNumber(date) - dayNumber(today);
  return { date, daysLeft, warn: daysLeft <= warnDays };
}

/**
 * #2680 — days past a step's own target date, or null: no target date, completed, skipped, or not yet past it. The step's target
 * date wins over its target days (the server's `billing_stage_due_on`), so a step with a date is judged by it alone.
 */
export function stageDaysPastTargetDate(
  stage: { completedOn: string | null; skippedOn?: string | null; targetOn?: string | null },
  today: string,
): number | null {
  if (!stage.targetOn || stage.completedOn || stage.skippedOn) return null;
  const over = dayNumber(today) - dayNumber(stage.targetOn);
  return over > 0 ? over : null;
}
