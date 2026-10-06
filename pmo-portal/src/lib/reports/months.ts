/**
 * First-of-month ISO date arithmetic (`YYYY-MM-01`), done in UTC so no host timezone can move a day.
 * Month boundaries themselves are decided server-side in the ORG timezone (org_current_month); these
 * helpers only walk calendar dates the server already chose.
 */
const MS_PER_DAY = 86_400_000;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = parts(month);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthEnd(month: string): string {
  return addDays(addMonths(month, 1), -1);
}

/** Inclusive day count, `b >= a`. */
export function daysInclusive(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY) + 1;
}

/** `YYYY-MM` from an `<input type="month">` → `YYYY-MM-01`; null for anything else. */
export function monthInputToIso(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}
