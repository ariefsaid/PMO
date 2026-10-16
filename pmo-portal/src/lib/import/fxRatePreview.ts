import type { FxCommitCounts, FxRateInput, FxRateRow } from '@/src/lib/repositories/types';
import type { FxParsed } from './fxRateParser';

/** The file's accepted date range and calendar dates absent inside it; no rates are inferred. */
export type FxCoverage = {
  firstDate: string | null;
  lastDate: string | null;
  missingDates: string[];
};

export type FxPreview = FxParsed & FxCommitCounts & { coverage: FxCoverage };

/** Calendar dates absent between the earliest and latest published dates, without inferring schedules. */
export function missingFxRateDates(dates: string[]): string[] {
  if (dates.length < 2) return [];
  const present = new Set(dates);
  const first = dates.reduce((min, date) => (date < min ? date : min));
  const last = dates.reduce((max, date) => (date > max ? date : max));
  const cursor = new Date(`${first}T00:00:00.000Z`);
  const end = new Date(`${last}T00:00:00.000Z`);
  const missing: string[] = [];
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    if (date < last && !present.has(date)) missing.push(date);
  }
  return missing;
}

function coverageWindow(rows: FxRateInput[]): FxCoverage {
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  const dates = rows.map(({ rate_date }) => rate_date);
  for (const rate_date of dates) {
    if (firstDate === null || rate_date < firstDate) firstDate = rate_date;
    if (lastDate === null || rate_date > lastDate) lastDate = rate_date;
  }
  return { firstDate, lastDate, missingDates: missingFxRateDates(dates) };
}

export function buildFxPreview(
  parsed: FxParsed,
  existing: Pick<FxRateRow, 'rate_date' | 'rate'>[],
): FxPreview {
  const byDate = new Map(existing.map((row) => [row.rate_date, row.rate]));
  const counts: FxCommitCounts = { new: 0, changed: 0, unchanged: 0 };
  for (const incoming of parsed.rows) {
    const current = byDate.get(incoming.rate_date);
    if (current === undefined) counts.new += 1;
    else if (current === incoming.rate) counts.unchanged += 1;
    else counts.changed += 1;
  }
  return { ...parsed, ...counts, coverage: coverageWindow(parsed.rows) };
}
