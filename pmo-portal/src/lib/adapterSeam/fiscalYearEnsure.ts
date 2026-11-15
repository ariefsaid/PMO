/**
 * fiscal-year.ensure (#1599 ECX-5, M-8/G-8) — PMO keeps the ERP one fiscal year ahead, so a posting dated in a new year is
 * never refused for want of a year. Tier-agnostic: the outcome a tier reports, and the date rules every tier shares. PMO terms
 * only; relative imports so the seam stays Deno-importable.
 *
 * The ERP is the source of truth: a tier looks the year up, creates it only when none covers the date, then reads it back, and
 * reports only what the read-back shows.
 */

/** How close to the current year's end the next year is made (AC-ECX-040). */
export const FISCAL_YEAR_LEAD_DAYS = 45;

/** One fiscal year as the ERP holds it. `companies` empty = the year covers every company. */
export interface FiscalYearSpan {
  name: string;
  start: string;
  end: string;
  companies: string[];
  disabled: boolean;
}

export type FiscalYearEnsureOutcome =
  /** The current year ends more than the lead time away: nothing to do yet. */
  | { state: 'not-due'; current: string }
  /** A year covering the day after the current one ends exists, read back from the ERP. `created` = PMO made it this run. */
  | { state: 'ready'; current: string; next: string; created: boolean }
  /** The ERP refused the create for lack of permission: an Operator task, never a client step. */
  | { state: 'needs-operator'; reason: 'missing-role' | 'no-current-year' }
  /** The ERP refused the create for another reason, or did not show the year afterwards. `message` is the ERP's plain words. */
  | { state: 'refused'; message: string | null };

/** ISO date (YYYY-MM-DD) arithmetic in UTC: a fiscal year is a calendar span, never a moment. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`not an ISO date: ${date}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The year after one that ends on `currentEnd`: it starts the next day and runs one full year, so its start month is the
 *  current year's (for a full current year). Feb 29 starts fall back to Mar 1 a year later minus a day, as the ERP expects. */
export function nextYearSpan(currentEnd: string): { start: string; end: string } {
  const start = addDays(currentEnd, 1);
  const [y, m, d] = start.split('-').map(Number);
  const oneYearOn = new Date(Date.UTC(y + 1, m - 1, d));
  // Date.UTC rolls Feb 29 of a non-leap year over to Mar 1; that is the day after the year ends either way.
  return { start, end: addDays(oneYearOn.toISOString().slice(0, 10), -1) };
}

/** The name PMO gives a year it creates: "2027" for a calendar year, "2027-2028" otherwise. */
export function fiscalYearName(span: { start: string; end: string }): string {
  const a = span.start.slice(0, 4);
  const b = span.end.slice(0, 4);
  return a === b ? a : `${a}-${b}`;
}

/** Whether a year serves `company`: enabled, and either global (no company rows) or listing the company. */
export function coversCompany(year: FiscalYearSpan, company: string): boolean {
  return !year.disabled && (year.companies.length === 0 || year.companies.includes(company));
}

/** Whether a year contains `date`. */
export function containsDate(year: Pick<FiscalYearSpan, 'start' | 'end'>, date: string): boolean {
  return year.start <= date && date <= year.end;
}
