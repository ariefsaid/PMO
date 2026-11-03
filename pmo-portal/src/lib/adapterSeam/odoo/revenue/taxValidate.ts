export interface SaleTax { id: number; name: string; rate: number; active: boolean; companyId: number; scope: string; priceIncluded: boolean; taxGroup: string | null }

/**
 * The tax groups of the stock Indonesian chart whose sale taxes are PPN output tax (FR-OCI-023, Director ruling 2026-11-03): non-luxury
 * (the effective 11%), luxury (12%) and zero-rated. Read on the dev bed: "Collected by VAT Collector" (taxes at rate 100 booked by the
 * collector), "SLTG", "Tax Exempted" and the generic "Taxes" group are not PPN output, and neither is a group of another country's chart.
 * Names are the group's display name in the key user's language, so a connection whose user reads another language refuses, never guesses.
 */
export const PPN_OUTPUT_TAX_GROUPS: ReadonlySet<string> = new Set(['Non-luxury Good Taxes', 'Luxury Good Taxes', 'Zero-rated Taxes']);
export type SaleTaxSelection = { outcome: 'accepted'; taxIds: number[] } | { outcome: 'refused'; code: 'config-rejected'; tax: string | null };

const refuse = (tax: string | null): SaleTaxSelection => ({ outcome: 'refused', code: 'config-rejected', tax });

/**
 * The tax ids every invoice line carries (OQ-OCI-3). VAT on: the org's default sales tax, picked by id from the mirrored
 * directory and validated (active, same company, sale scope, a PPN output tax group, a non-negative output rate, not price-included because PMO
 * sends net-of-tax prices). VAT off: an explicit empty set, so a product's hidden default tax is never applied. A refusal
 * names the tax only.
 */
export function selectSaleTaxes(input: { vatFlag: boolean; defaultTaxId: number | null; taxes: readonly SaleTax[]; companyId: number }): SaleTaxSelection {
  if (!input.vatFlag) return { outcome: 'accepted', taxIds: [] };
  const tax = input.taxes.find((t) => t.id === input.defaultTaxId);
  if (!tax) return refuse(null);
  const ok = tax.active && tax.companyId === input.companyId && tax.scope === 'sale' && tax.taxGroup !== null && PPN_OUTPUT_TAX_GROUPS.has(tax.taxGroup) && Number.isFinite(tax.rate) && tax.rate >= 0 && !tax.priceIncluded;
  return ok ? { outcome: 'accepted', taxIds: [tax.id] } : refuse(tax.name);
}
