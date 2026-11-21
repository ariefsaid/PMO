/** The purchase type and rental period chosen on the new-purchase form (#2697). */
export interface PurchaseTypeValue { id: string; isRental: boolean; from: string; to: string }
export const NO_PURCHASE_TYPE: PurchaseTypeValue = { id: '', isRental: false, from: '', to: '' };

/** The rental period errors for a value (FR-PTR-006). Empty when the type is not a rental. */
export function purchaseTypePeriodErrors(v: PurchaseTypeValue, t: (key: string, fallback: string) => string): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  if (!v.isRental) return out;
  if (!v.from) out.from = t('create.periodRequired', 'Enter the rental period.');
  if (!v.to) out.to = t('create.periodRequired', 'Enter the rental period.');
  else if (v.from && v.to < v.from) out.to = t('create.periodOrder', 'The end cannot be before the start.');
  return out;
}
