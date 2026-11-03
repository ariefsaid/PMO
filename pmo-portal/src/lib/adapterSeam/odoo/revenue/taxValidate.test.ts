import { expect, it } from 'vitest';
import { selectSaleTaxes, type SaleTax } from './taxValidate.ts';

const ppn: SaleTax = { id: 5, name: '12% (Non-Luxury Good)', rate: 11, active: true, companyId: 1, scope: 'sale', priceIncluded: false, taxGroup: 'Non-luxury Good Taxes' };
const zero: SaleTax = { ...ppn, id: 10, name: '0%', rate: 0, taxGroup: 'Zero-rated Taxes' };
const directory = [ppn, zero, { ...ppn, id: 7, name: '12%', rate: 12, taxGroup: 'Luxury Good Taxes' }];
const refused = (tax: string | null) => ({ outcome: 'refused', code: 'config-rejected', tax });

it('AC-OCI-015 flag on sends the validated default sales tax by id, never by name', () => {
  expect(selectSaleTaxes({ vatFlag: true, defaultTaxId: 5, taxes: directory, companyId: 1 })).toEqual({ outcome: 'accepted', taxIds: [5] });
  expect(selectSaleTaxes({ vatFlag: true, defaultTaxId: 7, taxes: directory, companyId: 1 })).toEqual({ outcome: 'accepted', taxIds: [7] });
  expect(selectSaleTaxes({ vatFlag: true, defaultTaxId: 10, taxes: directory, companyId: 1 })).toEqual({ outcome: 'accepted', taxIds: [10] });
});

it('AC-OCI-015 flag off sends an explicit empty set, whatever the mirror holds, and needs no default', () => {
  expect(selectSaleTaxes({ vatFlag: false, defaultTaxId: 5, taxes: directory, companyId: 1 })).toEqual({ outcome: 'accepted', taxIds: [] });
  expect(selectSaleTaxes({ vatFlag: false, defaultTaxId: null, taxes: [], companyId: 1 })).toEqual({ outcome: 'accepted', taxIds: [] });
});

it('AC-OCI-015 an inactive, foreign-company, wrong-scope, withholding or price-included tax refuses naming the tax only', () => {
  for (const bad of [{ active: false }, { companyId: 2 }, { scope: 'purchase' }, { rate: -2 }, { rate: Number.NaN }, { priceIncluded: true }]) {
    const result = selectSaleTaxes({ vatFlag: true, defaultTaxId: 5, taxes: [{ ...ppn, ...bad }], companyId: 1 });
    expect(result, JSON.stringify(bad)).toEqual(refused('12% (Non-Luxury Good)'));
    expect(JSON.stringify(result)).not.toMatch(/company|account/i);
  }
});

it('AC-OCI-015 flag on with no default, or a default the mirror does not hold, refuses before any write', () => {
  expect(selectSaleTaxes({ vatFlag: true, defaultTaxId: null, taxes: directory, companyId: 1 })).toEqual(refused(null));
  expect(selectSaleTaxes({ vatFlag: true, defaultTaxId: 99, taxes: directory, companyId: 1 })).toEqual(refused(null));
});

it('AC-OCI-015 FR-OCI-023 the default sales tax must be a PPN output tax: a collector, exempt, luxury-surcharge, generic or unknown group refuses naming the tax', () => {
  for (const taxGroup of ['Collected by VAT Collector', 'Tax Exempted', 'SLTG', 'Taxes', 'Tax 15%', '', null]) {
    expect(selectSaleTaxes({ vatFlag: true, defaultTaxId: 5, taxes: [{ ...ppn, taxGroup }], companyId: 1 }), String(taxGroup)).toEqual(refused('12% (Non-Luxury Good)'));
  }
});

it('AC-OCI-015 the PPN rule does not apply when the project carries no VAT: no tax is read, so no group matters', () => {
  expect(selectSaleTaxes({ vatFlag: false, defaultTaxId: 5, taxes: [{ ...ppn, taxGroup: null }], companyId: 1 })).toEqual({ outcome: 'accepted', taxIds: [] });
});
