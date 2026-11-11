/** Decimal line pricing shared by browser and Deno. SQL remains the write authority. */
function decimalParts(value: number): { units: bigint; scale: number } {
  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  return { units: BigInt(whole + fraction), scale: fraction.length - Number(exponentText ?? 0) };
}

/** Round a signed decimal product to cents, with exact midpoint ties away from zero. */
export function lineCents(quantity: number, rate: number): bigint | null {
  if (!Number.isFinite(quantity) || !Number.isFinite(rate)) return null;
  const qty = decimalParts(quantity);
  const price = decimalParts(rate);
  const product = qty.units * price.units;
  const scale = qty.scale + price.scale - 2;
  if (scale <= 0) return product * 10n ** BigInt(-scale);
  const divisor = 10n ** BigInt(scale);
  const magnitude = product < 0n ? -product : product;
  const rounded = (magnitude + divisor / 2n) / divisor;
  return product < 0n ? -rounded : rounded;
}
