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

/** The statement's display rule for fraction digits; mirrors the read payload's `presentation`. */
export interface StatementAmountPresentation {
  readonly precision: number;
  readonly roundingMethod: string;
}

export interface FormattedStatementAmount {
  /** Grouped, fixed-precision text; negatives in accounting parentheses. */
  readonly text: string;
  /** True when the displayed figure is zero at the presentation precision. */
  readonly zero: boolean;
  readonly negative: boolean;
}

const MAX_STATEMENT_EXPONENT = 64;

function expandedDigits(integerDigits: string, fractionDigits: string, exponent: number): { int: string; frac: string } {
  const digits = integerDigits + fractionDigits;
  const point = integerDigits.length + exponent;
  if (point <= 0) return { int: '0', frac: '0'.repeat(-point) + digits };
  if (point >= digits.length) return { int: digits + '0'.repeat(point - digits.length), frac: '' };
  return { int: digits.slice(0, point), frac: digits.slice(point) };
}

function roundsUp(kept: bigint, dropped: string, method: string): boolean {
  if (dropped === '' || /^0*$/.test(dropped)) return false;
  const first = dropped.charCodeAt(0) - 48;
  if (first > 5) return true;
  if (first < 5) return false;
  const exactHalf = /^0*$/.test(dropped.slice(1));
  if (!exactHalf) return true;
  if (method === 'Commercial Rounding') return true;
  return kept % 2n === 1n;
}

/**
 * Presents a native decimal token the way a financial statement prints it: grouped by the viewer's
 * number locale, fixed to the generation's `precision` (rounded lexically by its rounding method —
 * never through a binary float), negatives in parentheses. The ERP figure itself is not recomputed.
 */
export function formatStatementAmount(
  token: string,
  presentation: StatementAmountPresentation,
  locale = getNumberLocale(),
): FormattedStatementAmount {
  if (typeof token !== 'string' || token.length > MAX_NATIVE_AMOUNT_TOKEN_LENGTH) {
    throw new TypeError('Invalid native statement amount token');
  }
  const match = NATIVE_DECIMAL_TOKEN.exec(token);
  if (!match) throw new TypeError('Invalid native statement amount token');
  const [, sign, integerDigits, fractionDigits = '', exponentMarker, exponentSign = '', exponentDigits = '0'] = match;
  const exponent = exponentMarker === undefined ? 0 : Number(`${exponentSign}${exponentDigits}`);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_STATEMENT_EXPONENT) {
    throw new TypeError('Invalid native statement amount token');
  }
  const precision = presentation.precision;
  if (!Number.isInteger(precision) || precision < 0 || precision > 9) throw new TypeError('Invalid statement precision');

  const { int, frac } = expandedDigits(integerDigits, fractionDigits, exponent);
  const paddedFraction = frac.padEnd(precision, '0');
  const keptDigits = `${int}${paddedFraction.slice(0, precision)}`;
  let scaled = BigInt(keptDigits);
  if (roundsUp(scaled, paddedFraction.slice(precision), presentation.roundingMethod)) scaled += 1n;

  const zero = scaled === 0n;
  const negative = sign === '-' && !zero;
  const scaledText = scaled.toString().padStart(precision + 1, '0');
  const wholeDigits = scaledText.slice(0, scaledText.length - precision);
  const fraction = scaledText.slice(scaledText.length - precision);
  const symbols = numberSymbols(locale);
  const digits = localizedDigits(locale);
  const body = `${groupedInteger(wholeDigits, locale)}${precision > 0 ? `${symbols.decimal}${localizeDigitSequence(fraction, digits)}` : ''}`;
  return { text: negative ? `(${body})` : body, zero, negative };
}
