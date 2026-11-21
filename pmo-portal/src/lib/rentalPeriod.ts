/**
 * Calendar-day arithmetic for a rental period (#2697). ISO `YYYY-MM-DD` strings in, ISO strings out; computed on UTC
 * midnights so no time zone or daylight-saving shift can move a day. The database decides every rule; this only
 * proposes the defaults of the "Extend rental" step.
 */
const DAY_MS = 86_400_000;
const parse = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const format = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export function addDaysIso(iso: string, days: number): string {
  return format(parse(iso) + days * DAY_MS);
}

/** Whole days from `from` to `to`, both counted. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS) + 1;
}

/** FR-PTR-009: the next period starts the day after the current end and runs one period long. */
export function defaultExtensionPeriod(rentalFrom: string, rentalTo: string): { from: string; to: string } {
  const from = addDaysIso(rentalTo, 1);
  return { from, to: addDaysIso(from, inclusiveDays(rentalFrom, rentalTo) - 1) };
}
