/**
 * taxNormalize.ts — the read-only tax re-basing, as a dependency-free LEAF so the agent edge function (Deno) can
 * import it (#787). Moved verbatim from taxTreatment.ts, which re-exports it — one implementation, two importers.
 */
type TaxTreatment = 'inclusive' | 'exclusive';

/**
 * Narrows an unknown (a DB column typed `string | null`, an RPC field, a form draft) to the
 * two-value domain. Anything else — null, '', a value from a future CHECK relaxation — is NOT a
 * treatment, and the caller must render NOTHING rather than guess. Rendering "excl. PPN" for an
 * unknown marker is precisely the confidently-wrong money statement OD-TAX-1 exists to prevent.
 */
export function isTaxTreatment(value: unknown): value is TaxTreatment {
  return value === 'inclusive' || value === 'exclusive';
}

/** Convert an already valid decimal to integer units without floating-point multiplication. */
export function decimalUnits(value: number, scale: number): bigint | null {
  const decimal = value.toFixed(scale);
  if (Number(decimal) !== value) return null;
  return BigInt(decimal.replace('.', ''));
}

/**
 * Re-express a stored amount on another tax basis using only the row's recorded tax facts.
 * This is a read-only conversion: it never calculates a tax rate or consults an org default.
 */
export function normalizeTaxAmount(
  amount: number,
  taxAmount: number,
  treatment: string,
  targetTreatment: string,
): number | null {
  if (
    !Number.isFinite(amount) || amount < 0 || amount >= 1e12 ||
    !Number.isFinite(taxAmount) || taxAmount < 0 || taxAmount >= 1e12 ||
    !isTaxTreatment(treatment) || !isTaxTreatment(targetTreatment) ||
    (treatment === 'inclusive' && taxAmount > amount)
  ) {
    return null;
  }

  const amountCents = decimalUnits(amount, 2);
  const taxCents = decimalUnits(taxAmount, 2);
  if (amountCents === null || taxCents === null) return null;
  const netCents = treatment === 'inclusive' ? amountCents - taxCents : amountCents;
  const grossCents = treatment === 'inclusive' ? amountCents : amountCents + taxCents;
  const resultCents = targetTreatment === 'inclusive' ? grossCents : netCents;
  if (resultCents < 0n || resultCents >= 100000000000000n) return null;
  return Number(resultCents) / 100;
}

