/** Odoo 20.0 `odoo/tools/float_utils.py::float_round`, kept dependency-free for Deno and the browser. */
export interface OdooRoundingPrecision {
  precisionDigits?: number;
  precisionRounding?: number;
}

function roundingFactor({ precisionDigits, precisionRounding }: OdooRoundingPrecision): number {
  if (precisionRounding !== undefined && precisionDigits === undefined) {
    if (!Number.isFinite(precisionRounding) || precisionRounding <= 0) throw new RangeError('precisionRounding must be positive');
    return precisionRounding;
  }
  if (precisionDigits !== undefined && precisionRounding === undefined) {
    if (!Number.isInteger(precisionDigits) || precisionDigits < 0) throw new RangeError('precisionDigits must be a non-negative integer');
    return 10 ** -precisionDigits;
  }
  throw new TypeError('exactly one of precisionDigits and precisionRounding must be specified');
}

/**
 * Port of Odoo 20's `float_round` using HALF-UP (ties away from zero), including its scaled 2**-50 epsilon.
 * Provide either decimal digits or the rounding increment; increments support currencies such as 0.05.
 */
export function odooFloatRound(value: number, precision: OdooRoundingPrecision): number {
  if (!Number.isFinite(value)) throw new RangeError('value must be finite');
  let factor = roundingFactor(precision);
  if (factor === 0 || value === 0) return 0;

  let normalize = (amount: number) => amount / factor;
  let denormalize = (amount: number) => amount * factor;
  if (factor < 1) {
    factor = 1 / factor;
    normalize = (amount) => amount * factor;
    denormalize = (amount) => amount / factor;
  }

  const normalized = normalize(value);
  const epsilon = 2 ** (Math.log2(Math.abs(normalized)) - 50);
  const nudged = normalized + Math.sign(normalized) * epsilon;
  const rounded = Math.sign(nudged) * Math.floor(Math.abs(nudged) + 0.5);
  const result = denormalize(rounded);
  if (!Number.isFinite(result)) throw new RangeError('rounded value must be finite');
  return result;
}

/** The posted account.move.line subtotal: ORM-round quantity, multiply by the unrounded price, then round currency. */
export function odooLineSubtotal(qty: number, priceUnit: number, qtyRounding: number, currencyRounding: number): number {
  const roundedQty = odooFloatRound(qty, { precisionRounding: qtyRounding });
  return odooFloatRound(roundedQty * priceUnit, { precisionRounding: currencyRounding });
}

/** Compare money after Odoo rounds both sides; this avoids binary artifacts for increments such as 0.05. */
export function odooCurrencyAmountsEqual(left: number, right: number, currencyRounding: number): boolean {
  return odooFloatRound(left, { precisionRounding: currencyRounding }) === odooFloatRound(right, { precisionRounding: currencyRounding });
}
