import type { FxCommitCounts, FxRateInput, FxRateRow } from '@/src/lib/repositories/types';
import type { FxParsed } from './fxRateParser';

/**
 * The calendar-day window the file's accepted rows actually cover — nulls when nothing was
 * accepted. Interior gaps are deliberate: JISDOR does not publish every calendar day, so a
 * weekend inside the window is coverage, not a hole to fill (S-38: no invented prior-day rate).
 */
export type FxCoverage = { firstDate: string | null; lastDate: string | null };

export type FxPreview = FxParsed & FxCommitCounts & { coverage: FxCoverage };

function coverageWindow(rows: FxRateInput[]): FxCoverage {
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const { rate_date } of rows) {
    if (firstDate === null || rate_date < firstDate) firstDate = rate_date;
    if (lastDate === null || rate_date > lastDate) lastDate = rate_date;
  }
  return { firstDate, lastDate };
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
