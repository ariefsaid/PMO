/**
 * Decimal-string money shape (AC-ENA-030/031, FR-ENA-070/071/072, design decision #4). Every money/
 * rate/qty/outstanding/allocated/total value crosses the P0/P2 contract as a `string` — never a raw
 * JS `number` — so a mirrored ERP total never picks up a float-arithmetic artifact on its way into a
 * `numeric(14,2)` column. The mirrored ERP HEADER total (`grand_total`/`outstanding_amount`/
 * `paid_amount`) is always the money oracle (ADR-0048) — this module never sums line rows.
 */
import { AdapterError } from '../contract.ts';

/** `numeric(14,2)`: 14 total digits, 2 after the decimal point -> at most 12 integer digits. */
const NUMERIC_14_2_INTEGER_DIGIT_LIMIT = 12;

/**
 * Convert decimal text to cents, rounding ties away from zero. Numeric inputs use their canonical
 * decimal representation; precision already lost before this boundary cannot be recovered.
 * Values must fit numeric(14,2) after rounding, including a carry into the integer part.
 */
export function toDecimalString(value: number | string): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new AdapterError('commit-rejected', `invalid decimal value: ${JSON.stringify(value)}`);
  }
  // JavaScript uses exponent notation for finite numeric values below 1e-6 or at least 1e21.
  // The former rounds to zero cents; the latter is outside numeric(14,2).
  if (typeof value === 'number' && value !== 0 && Math.abs(value) < 1e-6) return '0.00';
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    if (typeof value === 'number' && Math.abs(value) >= 1e21) {
      throw new AdapterError('commit-rejected', `value exceeds numeric(14,2) range: ${value}`);
    }
    throw new AdapterError('commit-rejected', `invalid decimal value: ${JSON.stringify(value)}`);
  }
  const whole = match[2].replace(/^0+/, '') || '0';
  if (whole.length > NUMERIC_14_2_INTEGER_DIGIT_LIMIT) {
    throw new AdapterError('commit-rejected', `value exceeds numeric(14,2) range: ${value}`);
  }
  const fraction = (match[3] ?? '').padEnd(3, '0');
  let cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2));
  if (fraction[2] >= '5') cents += 1n;
  if (cents >= 100000000000000n) {
    throw new AdapterError('commit-rejected', `value exceeds numeric(14,2) range: ${value}`);
  }
  const sign = match[1] && cents !== 0n ? '-' : '';
  return `${sign}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/**
 * Maps an ERP-sourced money field into the PMO mirror value: ERP `null`/`undefined`/empty-string
 * (an absent optional, e.g. `paid_from_account_currency` on an unreferenced field) maps to SQL
 * `NULL` — NEVER `0` (a real zero balance must stay distinguishable from "not returned"). A present
 * value is converted through `toDecimalString` (same over-scale `commit-rejected` guard).
 */
export function mirrorMoney(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new AdapterError('commit-rejected', `unexpected money value type: ${typeof value}`);
  }
  return toDecimalString(value);
}
