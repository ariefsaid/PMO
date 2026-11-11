import type { FxCommitCounts, FxRateInput, FxRateRow } from '@/src/lib/repositories/types';
import type { FxParsed } from './fxRateParser';

/** The file's accepted date range and calendar dates absent inside it; no rates are inferred. */
export type FxCoverage = {
  firstDate: string | null;
  lastDate: string | null;
  missingDates: string[];
  gapSummary?: { count: number; ranges: { first: string; last: string }[] };
};

export type FxPreview = FxParsed & FxCommitCounts & { coverage: FxCoverage };

/** Calendar dates absent between the earliest and latest published dates, without inferring schedules. */
const DAY = 86_400_000;
const MAX_LISTED_GAPS = 1000;

type GapRange = { first: string; last: string };
function gapDetails(dates: string[]): { missingDates: string[]; gapSummary?: { count: number; ranges: GapRange[] } } {
  const ordered = [...new Set(dates)].sort();
  const ranges: GapRange[] = [];
  let count = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const start = Date.parse(`${ordered[i - 1]}T00:00:00.000Z`);
    const end = Date.parse(`${ordered[i]}T00:00:00.000Z`);
    const length = (end - start) / DAY - 1;
    if (length > 0) {
      count += length;
      ranges.push({ first: new Date(start + DAY).toISOString().slice(0, 10), last: new Date(end - DAY).toISOString().slice(0, 10) });
    }
  }
  if (count > MAX_LISTED_GAPS) return { missingDates: [], gapSummary: { count, ranges } };
  const missingDates: string[] = [];
  for (const range of ranges) {
    const last = Date.parse(`${range.last}T00:00:00.000Z`);
    for (let day = Date.parse(`${range.first}T00:00:00.000Z`); day <= last; day += DAY)
      missingDates.push(new Date(day).toISOString().slice(0, 10));
  }
  return { missingDates };
}

export function missingFxRateDates(dates: string[]): string[] {
  return gapDetails(dates).missingDates;
}

function coverageWindow(rows: FxRateInput[]): FxCoverage {
  const dates = rows.map(({ rate_date }) => rate_date).sort();
  return { firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, ...gapDetails(dates) };
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
