/**
 * The one decimal module for quantities and money in the front end: parse, format, multiply-and-round and sum,
 * all exact in BigInt (never a JS float). The database computes every stored figure; these functions restate its
 * rules exactly so a preview cannot drift from the saved number. Rounding is half away from zero, which is what
 * Postgres `round(numeric)` does (C7, #2748).
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parse a decimal of any precision into [integer units, fraction length]; null when malformed. */
function parseUnits(value: string): { units: bigint; scale: number } | null {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const units = BigInt(match[2] + fraction);
  return { units: match[1] ? -units : units, scale: fraction.length };
}

/** Round integer `units` held at `from` decimals to `to` decimals, half away from zero, once. */
function roundUnits(units: bigint, from: number, to: number): bigint {
  if (from <= to) return units * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const abs = units < 0n ? -units : units;
  const rounded = abs / divisor + ((abs % divisor) * 2n >= divisor ? 1n : 0n);
  return units < 0n ? -rounded : rounded;
}

/** Parse a decimal into integer units at `scale` decimals; null when malformed, empty, or finer than the scale with a non-zero remainder. */
export function parseDecimal(value: string, scale: number): bigint | null {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? '';
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return null;
  return (match[1] ? -1n : 1n) * BigInt(match[2] + fraction.slice(0, scale).padEnd(scale, '0'));
}

/** Format integer units at `scale` decimals; `trim` drops trailing fraction zeros (never integer zeros). */
export function formatDecimal(units: bigint, scale: number, opts?: { trim?: boolean }): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  let fraction = scale === 0 ? '' : digits.slice(-scale);
  if (opts?.trim) fraction = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${digits.slice(0, digits.length - scale)}${fraction ? `.${fraction}` : ''}`;
}

/** `a × b` rounded once to `scale` decimals as integer units, half away from zero; null when either input is malformed. */
export function mulRound(a: string, b: string, scale: number): bigint | null {
  const x = parseUnits(a);
  const y = parseUnits(b);
  if (x === null || y === null) return null;
  return roundUnits(x.units * y.units, x.scale + y.scale, scale);
}

/** Exact sum of decimal strings at `scale` decimals; null and malformed entries are skipped. */
export function sumDecimal(values: readonly (string | null)[], scale: number): string {
  let total = 0n;
  for (const value of values) {
    const units = value === null ? null : parseDecimal(value, scale);
    if (units !== null) total += units;
  }
  return formatDecimal(total, scale);
}

/** Convert a validated, signed scale-two decimal to integer minor units. */
export function parseExactCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -amount : amount;
}

export function formatExactCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/** Number adapter retains negative zero and the existing safe-integer limit. */
export function parseSafeCents(value: string): number | 'invalid' | 'range' {
  const units = parseExactCents(value);
  if (units === null) return 'invalid';
  const result = Number(units);
  if (!Number.isSafeInteger(result)) return 'range';
  return result === 0 && value.startsWith('-') ? -0 : result;
}

export function formatNumberCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
