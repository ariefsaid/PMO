import type { TFunction } from 'i18next';
import { formatNumberMax2, formatNumberWhole } from './format';
import type { FxRateMatch } from './repositories/types';

function assertUsable(amount: number, match: FxRateMatch): number {
  const converted = amount * match.rate;
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(match.rate) ||
    match.rate <= 0 ||
    !Number.isFinite(converted)
  ) {
    throw new RangeError('Equivalent is unavailable');
  }
  return converted;
}

/** The rate as printed: thousands separators, no decimals when whole, otherwise at most two. */
export function formatFxRate(rate: number): string {
  return formatNumberMax2(rate);
}

/**
 * Display-only conversion. A match must already have been resolved by the shared selector.
 * `≈ IDR 1,623,456 (using IDR 18,500 rate)`; with `eachDate` the total sums rows converted at their own date's rate.
 */
export function formatFxEquivalent(
  amount: number,
  match: FxRateMatch,
  t: TFunction,
  options: { eachDate?: boolean } = {},
): string {
  const converted = assertUsable(amount, match);
  const whole = formatNumberWhole(converted);
  if (options.eachDate) {
    return t('finance:fx.equivalentEachDate', '≈ IDR {{amount}} (using IDR rate of each date)', { amount: whole });
  }
  return t('finance:fx.equivalent', '≈ IDR {{amount}} (using IDR {{rate}} rate)', { amount: whole, rate: formatFxRate(match.rate) });
}

/** The same approximate amount in IDR with no rate wording (a card puts the rate in its caption). */
export function formatIdrApprox(amount: number): string {
  return `≈ IDR ${formatNumberWhole(amount)}`;
}

/** Publication-date wording kept off the visible text: element `title` and screen-reader text. */
export function fxRateSourceNote(match: FxRateMatch, t: TFunction): string {
  return t('finance:fx.rateOfDate', 'JISDOR rate of {{date}}', { date: match.rate_date });
}

/** Caption under a position card: `using IDR 18,500 rate`. */
export function fxRateCaption(match: FxRateMatch, t: TFunction): string {
  return t('finance:fx.usingRate', 'using IDR {{rate}} rate', { rate: formatFxRate(match.rate) });
}
