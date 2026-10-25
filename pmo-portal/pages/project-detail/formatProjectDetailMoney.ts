import { formatExactMoney } from '@/src/lib/format';

/** Preserve cents and use the currency's standard fraction width in project-detail figures. */
export function formatProjectDetailMoney(
  value: number | string | null,
  currency: string,
  locale: string,
): string | null {
  if (value === null) return null;
  const amount = typeof value === 'number'
    ? Number.isFinite(value) ? value.toFixed(2) : null
    : value;
  if (amount === null) return null;
  const normalized = /^-?0(?:\.0{1,2})?$/.test(amount) ? '0' : amount;
  let trimZeroFraction = false;
  try {
    trimZeroFraction = new Intl.NumberFormat(locale, { style: 'currency', currency })
      .resolvedOptions().maximumFractionDigits === 0;
  } catch {
    return null;
  }
  return formatExactMoney(normalized, currency, locale, { trimZeroFraction });
}
