export interface PurchaseTax { name: string; rate: number; active: boolean; companyId: number; scope: string; liabilityAccount: boolean }
export function validateTaxes(taxes: readonly PurchaseTax[], companyId: number): { outcome: 'accepted' } | { outcome: 'refused'; code: 'config-rejected'; tax: string } {
  let sum = 0;
  for (const tax of taxes) {
    if (tax.rate < 0) sum += -tax.rate;
    if (!tax.active || tax.companyId !== companyId || tax.scope !== 'purchase' || (tax.rate < 0 && !tax.liabilityAccount) || !Number.isFinite(tax.rate) || sum >= 100) {
      return { outcome: 'refused', code: 'config-rejected', tax: tax.name };
    }
  }
  return { outcome: 'accepted' };
}
