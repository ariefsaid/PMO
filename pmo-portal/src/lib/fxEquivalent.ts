import type { TFunction } from 'i18next';
import { formatDateOnly, formatNumberMax2, formatNumberWhole, formatTileMoney } from './format';
import type { FxRateMatch } from './repositories/types';

/** THE USD→IDR conversion (display only). Null for any unusable amount or rate; every caller goes through here. */
export function convertUsdToIdr(amount: number | null, rate: number | null): number | null {
  if (amount === null || rate === null || !Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return null;
  const converted = amount * rate;
  return Number.isFinite(converted) ? converted : null;
}

/** THE rupiah figure format: `IDR 1,623,456` on the shared whole-number formatter; `approx` prefixes `≈ `. */
export function formatIdr(amount: number, opts: { approx?: boolean } = {}): string {
  return `${opts.approx ? '≈ ' : ''}IDR ${formatNumberWhole(amount)}`;
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
  const converted = convertUsdToIdr(amount, match.rate);
  if (converted === null) throw new RangeError('Equivalent is unavailable');
  if (options.eachDate) {
    const whole = formatIdr(converted).slice('IDR '.length);
    return t('finance:fx.equivalentEachDate', '≈ IDR {{amount}} (using IDR rate of each date)', { amount: whole });
  }
  return formatIdrLine(converted, match, t);
}

/** The full line for an amount already in rupiah (converted at `match`): `≈ IDR 55,500,000 (using IDR 18,500 rate)`. */
export function formatIdrLine(idrAmount: number, match: FxRateMatch, t: TFunction): string {
  const whole = formatIdr(idrAmount).slice('IDR '.length);
  return t('finance:fx.equivalent', '≈ IDR {{amount}} (using IDR {{rate}} rate)', { amount: whole, rate: formatFxRate(match.rate) });
}

/**
 * The compact rupiah line under a compact figure (`≈ IDR 111M`), the same conversion as the full line. Only a
 * figure that is itself compact takes it; the full `≈ IDR … (using IDR … rate)` line goes in its title.
 */
export function formatFxEquivalentCompact(amount: number, match: FxRateMatch): string {
  const converted = convertUsdToIdr(amount, match.rate);
  const compact = converted === null ? null : formatTileMoney(converted, 'IDR', { code: true });
  if (compact === null) throw new RangeError('Equivalent is unavailable');
  return `≈ ${compact}`;
}

/** The same approximate amount in IDR with no rate wording (a card puts the rate in its caption). */
export function formatIdrApprox(amount: number): string {
  return formatIdr(amount, { approx: true });
}

/**
 * Publication-date wording kept off the visible text: element `title` and screen-reader text.
 * Null when the rate is dated the same day as the document (nothing to explain).
 */
export function fxRateSourceNote(match: FxRateMatch, t: TFunction, documentDay?: string | null): string | null {
  if (documentDay && match.rate_date === documentDay) return null;
  return t('finance:fx.rateOfDate', 'JISDOR rate of {{date}}', { date: formatDateOnly(match.rate_date) });
}

/** Caption under a position card: `using IDR 18,500 rate`. */
export function fxRateCaption(match: FxRateMatch, t: TFunction): string {
  return t('finance:fx.usingRate', 'using IDR {{rate}} rate', { rate: formatFxRate(match.rate) });
}
