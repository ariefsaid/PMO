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

/** Documents the `procurement_items.amount` GENERATED-column divergence (design decision #4): PMO
 *  cannot set the DB-generated `amount` (`quantity*rate` STORED, migration 0001), so the ERP line
 *  `amount` mirrors into `erp_line_amount` instead — THAT column is the money oracle for a line, the
 *  generated `amount` is a display convenience only, never ERP truth. */
export const PROCUREMENT_ITEMS_AMOUNT_ORACLE_COLUMN = 'erp_line_amount';

/** Formats a currency-range number to exactly 2 decimal places via integer-cents arithmetic —
 *  avoids `Number.prototype.toFixed`'s documented binary-float misrounding (e.g. `(1.005).toFixed(2)`
 *  -> `"1.00"` on most engines) so a mirrored ERP amount round-trips exactly, never a float artifact. */
function formatCentsExact(num: number): string {
  const scaledCents = Math.round((Math.abs(num) + Number.EPSILON) * 100);
  const sign = num < 0 && scaledCents !== 0 ? '-' : '';
  const wholePart = Math.floor(scaledCents / 100);
  const centsPart = String(scaledCents % 100).padStart(2, '0');
  return `${sign}${wholePart}.${centsPart}`;
}

/**
 * Converts a money/rate/qty value (a JS number OR an already-decimal string, both as ERP/PMO may
 * hand it in) into the canonical 2-decimal-place string. Rejects a non-numeric value or one whose
 * integer part exceeds `numeric(14,2)`'s 12-digit capacity as `commit-rejected` (design decision #4).
 */
export function toDecimalString(value: number | string): string {
  if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    throw new AdapterError('commit-rejected', `invalid decimal value: ${JSON.stringify(value)}`);
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new AdapterError('commit-rejected', `invalid decimal value: ${JSON.stringify(value)}`);
  }
  const integerDigits = Math.floor(Math.abs(num)).toString().length;
  if (integerDigits > NUMERIC_14_2_INTEGER_DIGIT_LIMIT) {
    throw new AdapterError('commit-rejected', `value exceeds numeric(14,2) range: ${value}`);
  }
  return formatCentsExact(num);
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
