/** Odoo 20.0 `odoo/tools/float_utils.py`: `float_round` with HALF-UP ties and epsilon correction. */
export interface OdooFloatPrecision {
  precisionDigits?: number;
  precisionRounding?: number;
}

function floatInvert(value: number): number {
  const [coefficientText, exponentText = '0'] = value.toExponential(15).split('e');
  const coefficient = Number(coefficientText);
  return Number(`${coefficientText}e${-Number(exponentText)}`) / coefficient ** 2;
}

/** Mirror Odoo 20's float_round normalization, including rounding-increment inversion below one. */
export function odooFloatRound(value: number, precision: OdooFloatPrecision): number {
  const increment = precision.precisionRounding ?? (precision.precisionDigits === undefined ? Number.NaN : 10 ** -precision.precisionDigits);
  if (increment === 0 || value === 0) return 0;

  const invertedRounding = increment < 1 ? floatInvert(increment) : null;
  const normalized = invertedRounding === null ? value / increment : value * invertedRounding;
  const epsilon = 2 ** (Math.log2(Math.abs(normalized)) - 50);
  const rounded = Math.sign(normalized) * Math.floor(Math.abs(normalized) + epsilon + 0.5);
  return invertedRounding === null ? rounded * increment : rounded / invertedRounding;
}

/** Odoo's account.move.line quantity is rounded to Product Unit precision before its currency subtotal. */
export function odooLineSubtotal(qty: number, priceUnit: number, qtyRounding: number, currencyRounding: number): number {
  const roundedQuantity = odooFloatRound(qty, { precisionRounding: qtyRounding });
  return odooFloatRound(roundedQuantity * priceUnit, { precisionRounding: currencyRounding });
}
