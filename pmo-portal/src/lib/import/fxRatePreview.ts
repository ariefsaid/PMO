import type { FxCommitCounts, FxRateRow } from '@/src/lib/repositories/types';
import type { FxParsed } from './fxRateParser';

export type FxPreview = FxParsed & FxCommitCounts;

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
  return { ...parsed, ...counts };
}
