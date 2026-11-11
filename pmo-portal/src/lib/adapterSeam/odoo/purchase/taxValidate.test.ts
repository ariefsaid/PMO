import { expect, it } from 'vitest';
import { validateTaxes, type PurchaseTax } from './taxValidate.ts';
const vat: PurchaseTax = { name: 'VAT', rate: 11, active: true, companyId: 1, scope: 'purchase', liabilityAccount: true };
const pph: PurchaseTax = { ...vat, name: 'PPh', rate: -2 };
it('AC-OPP-042 validates purchase tax sets before any call', () => {
  for (const taxes of [[vat], [pph], [vat, pph], [{ ...vat, rate: 100 }], [{ ...vat, rate: 99 }, pph]]) expect(validateTaxes(taxes, 1)).toEqual({ outcome: 'accepted' });
  expect(validateTaxes([{ ...pph, rate: -60 }, { ...pph, name: 'Second withholding', rate: -40 }], 1)).toEqual({ outcome: 'refused', code: 'config-rejected', tax: 'Second withholding' });
  for (const tax of [{ ...pph, liabilityAccount: false }, { ...pph, rate: -100 }, { ...vat, active: false }, { ...vat, companyId: 2 }, { ...vat, scope: 'sale' }]) {
    expect(validateTaxes([tax], 1)).toEqual({ outcome: 'refused', code: 'config-rejected', tax: tax.name });
  }
});
