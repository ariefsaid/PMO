/**
 * #876 (DD-VWH-6, FR-VWH-007) — the three labelled figures a vendor invoice with tax withheld shows: the VAT on the
 * bill, the tax withheld (PPh — owed to the tax office, not the vendor) and the net payable to the vendor. `amount` is
 * the GROSS bill (DD-VWH-1), so net payable = amount − withheld, in integer cents so it never carries a float artifact.
 * Null when nothing was withheld or any figure is unknown: the caller then renders the bill exactly as before.
 */
export interface WithholdingFigures {
  vat: number;
  withheld: number;
  netPayable: number;
}

const cents = (n: number): number => Math.round(n * 100);

export function withholdingFigures(
  amount: number | null | undefined,
  taxAmount: number | null | undefined,
  withheldAmount: number | null | undefined,
): WithholdingFigures | null {
  if (amount == null || taxAmount == null || withheldAmount == null) return null;
  if (![amount, taxAmount, withheldAmount].every(Number.isFinite) || withheldAmount === 0) return null;
  return { vat: taxAmount, withheld: withheldAmount, netPayable: (cents(amount) - cents(withheldAmount)) / 100 };
}
