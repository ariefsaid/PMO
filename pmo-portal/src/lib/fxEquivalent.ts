import { formatCalendarDayInTimeZone, formatNumberWhole } from './format';
import type { FxRateMatch } from './repositories/types';

/** Format an instant as a calendar day in the organization's timezone, not the viewer's. */
export function orgDay(instant: Date, timezone: string): string {
  return formatCalendarDayInTimeZone(instant, timezone);
}

/** Display-only conversion. A match must already have been resolved by the shared selector. */
export function formatFxEquivalent(amount: number, match: FxRateMatch): string {
  const converted = amount * match.rate;
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(match.rate) ||
    match.rate <= 0 ||
    !Number.isFinite(converted)
  ) {
    throw new RangeError('Equivalent is unavailable');
  }
  return `≈ Rp ${formatNumberWhole(converted)} (JISDOR ${match.rate_date})`;
}
