import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { numberSymbols } from './format';

const NATIVE_DECIMAL_TOKEN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:([eE])([+-]?)(\d+))?$/;
const MAX_NATIVE_AMOUNT_TOKEN_LENGTH = 128;
const groupingFormatters = new Map<string, Intl.NumberFormat>();
const digitSets = new Map<string, readonly string[]>();

/** Removes only the native report's known cosmetic strong wrappers; React still renders text. */
export function plainNativeStatementLabel(value: string): string {
  return value.split('<strong>').join('').split('</strong>').join('');
}

/** Reports the source's known cosmetic emphasis without interpreting arbitrary markup. */
export function hasNativeStatementEmphasis(value: string): boolean {
  return value.includes('<strong>') && value.includes('</strong>');
}

function localizedDigits(locale: string): readonly string[] {
  const cached = digitSets.get(locale);
  if (cached) return cached;
  // These are fixed 0–9 locale samples, never a parsed or converted report amount.
  // eslint-disable-next-line no-restricted-syntax -- exact-token display needs locale digits without routing the amount through the binary formatter.
  const formatter = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 0 });
  const digits = Array.from({ length: 10 }, (_, digit) =>
    formatter.formatToParts(digit).find((part) => part.type === 'integer')?.value ?? String(digit),
  );
  digitSets.set(locale, digits);
  return digits;
}

function groupedInteger(digits: string, locale: string): string {
  let formatter = groupingFormatters.get(locale);
  if (!formatter) {
    // BigInt preserves the source integer digits exactly; this formatter is only for grouping.
    // eslint-disable-next-line no-restricted-syntax -- exact native tokens require BigInt grouping beyond Number's safe range.
    formatter = new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 0 });
    groupingFormatters.set(locale, formatter);
  }
  return formatter.format(BigInt(digits));
}

function localizeDigitSequence(value: string, digits: readonly string[]): string {
  return value.replace(/\d/g, (digit) => digits[digit.charCodeAt(0) - 48] ?? digit);
}

/**
 * Presents a bounded native JSON decimal token using the viewer's number convention without
 * parsing or rounding the report amount. Integer grouping uses BigInt only; fractional and
 * exponent digits remain lexical source digits.
 */
export function formatNativeStatementAmount(token: string, locale = getNumberLocale()): string {
  if (typeof token !== 'string' || token.length > MAX_NATIVE_AMOUNT_TOKEN_LENGTH) {
    throw new TypeError('Invalid native statement amount token');
  }
  const match = NATIVE_DECIMAL_TOKEN.exec(token);
  if (!match) throw new TypeError('Invalid native statement amount token');

  const [, sign, integerDigits, fractionDigits, exponentMarker, exponentSign = '', exponentDigits] = match;
  const symbols = numberSymbols(locale);
  const digits = localizedDigits(locale);
  const grouped = groupedInteger(integerDigits, locale);
  const localizedFraction = fractionDigits === undefined ? '' : `${symbols.decimal}${localizeDigitSequence(fractionDigits, digits)}`;
  const localizedExponent = exponentMarker === undefined
    ? ''
    : `${exponentMarker}${exponentSign}${localizeDigitSequence(exponentDigits!, digits)}`;

  return `${sign}${grouped}${localizedFraction}${localizedExponent}`;
}
