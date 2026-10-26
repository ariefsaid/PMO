import { currencyFractionDigits, formatExactMoney, formatExactNumber } from '@/src/lib/format';

const normalizedAmount = (value: number | string | null): string | null => {
  if (value === null) return null;
  return typeof value === 'number'
    ? Number.isFinite(value)
      ? value.toFixed(2).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
      : null
    : value;
};

/** Preserve supplied fractional precision while suppressing insignificant trailing zeroes. */
export function formatProjectDetailMoney(
  value: number | string | null,
  currency: string,
  locale: string,
  code = false,
): string | null {
  const amount = normalizedAmount(value);
  if (amount === null) return null;
  const normalized = /^-?0(?:\.0{1,2})?$/.test(amount) ? '0' : amount;
  const fractionDigits = currencyFractionDigits(currency, locale);
  if (fractionDigits === null) return null;
  if (code) {
    const amountText = formatExactNumber(normalized, locale, { trimZeroFraction: true, trimTrailingFractionZeros: true });
    return amountText === null ? null : `${currency} ${amountText}`;
  }
  return formatExactMoney(normalized, currency, locale, { trimZeroFraction: true, trimTrailingFractionZeros: true });
}

/** Format an exact value without a currency mark when the containing group names its currency. */
export function formatProjectDetailAmount(
  value: number | string | null,
  currency: string,
  locale: string,
): string | null {
  const amount = normalizedAmount(value);
  if (amount === null || currencyFractionDigits(currency, locale) === null) return null;
  const normalized = /^-?0(?:\.0{1,2})?$/.test(amount) ? '0' : amount;
  return formatExactNumber(normalized, locale, { trimZeroFraction: true, trimTrailingFractionZeros: true });
}
