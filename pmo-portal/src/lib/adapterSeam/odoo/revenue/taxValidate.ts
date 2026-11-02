export interface SaleTax { id: number; name: string; rate: number; active: boolean; companyId: number; scope: string; priceIncluded: boolean }
export type SaleTaxSelection = { outcome: 'accepted'; taxIds: number[] } | { outcome: 'refused'; code: 'config-rejected'; tax: string | null };

const refuse = (tax: string | null): SaleTaxSelection => ({ outcome: 'refused', code: 'config-rejected', tax });

/**
 * The tax ids every invoice line carries (OQ-OCI-3). VAT on: the org's default sales tax, picked by id from the mirrored
 * directory and validated (active, same company, sale scope, a non-negative output rate, not price-included because PMO
 * sends net-of-tax prices). VAT off: an explicit empty set, so a product's hidden default tax is never applied. A refusal
 * names the tax only.
 */
export function selectSaleTaxes(input: { vatFlag: boolean; defaultTaxId: number | null; taxes: readonly SaleTax[]; companyId: number }): SaleTaxSelection {
  if (!input.vatFlag) return { outcome: 'accepted', taxIds: [] };
  const tax = input.taxes.find((t) => t.id === input.defaultTaxId);
  if (!tax) return refuse(null);
  const ok = tax.active && tax.companyId === input.companyId && tax.scope === 'sale' && Number.isFinite(tax.rate) && tax.rate >= 0 && !tax.priceIncluded;
  return ok ? { outcome: 'accepted', taxIds: [tax.id] } : refuse(tax.name);
}
