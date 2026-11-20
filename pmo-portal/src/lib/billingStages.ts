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

/** Index of the first stage not completed (the current one), or null when all are complete. */
export function currentStageIndex(stages: ReadonlyArray<{ completedOn: string | null }>): number | null {
  const i = stages.findIndex((s) => !s.completedOn);
  return i === -1 ? null : i;
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
