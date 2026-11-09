/** Fiscal year of a posting date (DD-ODA-5): named by the year it ends in; calendar year when the company's year end is unknown. */
export interface FiscalYearEnd { month: number; day: number }

export function fiscalYearOf(date: string, end: FiscalYearEnd | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (!end) return String(year);
  // A 29 February year end is 28 February in a common year.
  const endDay = Math.min(end.day, new Date(Date.UTC(year, end.month, 0)).getUTCDate());
  return String(month > end.month || (month === end.month && day > endDay) ? year + 1 : year);
}
