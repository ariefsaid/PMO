/**
 * #876 — vendor withholding (PPh 23 / PPh 4(2)) helpers. Every money figure is computed in integer cents.
 *
 * Slice 1 (DD-VWH-6, FR-VWH-007): `withholdingFigures`, the three labelled figures a bill with tax withheld shows.
 * Slice 2 (OD-VWH-1, DD-VWH-17/20, OQ-VWH-6): the vendor's default tax treatment, the amounts a NEW bill is pre-filled
 * with, and the parsers for what a bill is recorded with. A suggestion is only a starting value — the bill records
 * exactly what the user submits (DD-VWH-13/19).
 */
import { parseMoneyInputAtScale } from './format';

export type TaxBasis = 'inclusive' | 'exclusive';
export type PphType = 'pph23' | 'pph4_2';
export const isPphType = (value: unknown): value is PphType => value === 'pph23' || value === 'pph4_2';

export interface WithholdingFigures {
  vat: number;
  withheld: number;
  netPayable: number;
}

const cents = (n: number): number => Math.round(n * 100);

/**
 * Null when nothing was withheld or any figure — or the basis — is unknown: the caller then renders the bill as before.
 * Gross = `amount` for a tax-inclusive bill (every ERP-mirrored bill, DD-VWH-1) and `amount + VAT` for a standalone
 * bill recorded tax-exclusive (DD-VWH-20); net payable = gross − withheld.
 */
export function withholdingFigures(
  amount: number | null | undefined,
  taxAmount: number | null | undefined,
  withheldAmount: number | null | undefined,
  taxTreatment: string | null | undefined,
): WithholdingFigures | null {
  if (amount == null || taxAmount == null || withheldAmount == null) return null;
  if (![amount, taxAmount, withheldAmount].every(Number.isFinite) || withheldAmount === 0) return null;
  if (taxTreatment !== 'inclusive' && taxTreatment !== 'exclusive') return null;
  const gross = taxTreatment === 'exclusive' ? cents(amount) + cents(taxAmount) : cents(amount);
  return { vat: taxAmount, withheld: withheldAmount, netPayable: (gross - cents(withheldAmount)) / 100 };
}

// ── slice 2: vendor defaults and pre-fill suggestions ─────────────────────────────────────────────────────────────

/** The vendor's default tax treatment (companies.default_*, migration 0272). Rates are percentages. */
export interface VendorTaxDefault {
  vatRate: number | null;
  pphType: PphType | null;
  pphRate: number | null;
}

/** What the vendor-default editor saves (`set_vendor_tax_defaults`). */
export type VendorTaxDefaultsInput = VendorTaxDefault;

/** A withholding as recorded on a bill: its amount and — whenever something is withheld — its type (OQ-VWH-6). */
export interface VendorWithholding {
  withheldAmount: number;
  pphType: PphType | null;
}

/** The VAT / PPh an ERP-bound bill was entered with — the dispatch record's `vatAmount` / `withheldAmount` / `pphType`. */
export interface ErpVendorTaxAmounts extends VendorWithholding {
  vatAmount: number;
}

interface CompanyTaxColumns {
  default_vat_rate?: number | null;
  default_pph_type?: string | null;
  default_pph_rate?: number | null;
}

/** A company row's default, or null when it states neither a VAT rate nor a complete withholding. */
export function vendorTaxDefaultOf(row: CompanyTaxColumns | null | undefined): VendorTaxDefault | null {
  if (!row) return null;
  const vatRate = typeof row.default_vat_rate === 'number' && Number.isFinite(row.default_vat_rate) ? row.default_vat_rate : null;
  const pphType = isPphType(row.default_pph_type) ? row.default_pph_type : null;
  const pphRate = pphType && typeof row.default_pph_rate === 'number' && Number.isFinite(row.default_pph_rate)
    ? row.default_pph_rate : null;
  if (vatRate === null && pphRate === null) return null;
  return { vatRate, pphType: pphRate === null ? null : pphType, pphRate };
}

const toCents = (n: number): bigint => BigInt(Math.round(n * 100));
const rateMilli = (rate: number): bigint => BigInt(Math.round(rate * 1000));
const fromCents = (c: bigint): number => Number(c) / 100;
/** num / den rounded half away from zero (den > 0). */
function divRound(num: bigint, den: bigint): bigint {
  const negative = num < 0n;
  const magnitude = negative ? -num : num;
  const q = (magnitude * 2n + den) / (2n * den);
  return negative ? -q : q;
}

/** The VAT on an amount: rate × amount when tax-exclusive; amount × rate / (100 + rate) inside a tax-inclusive one. */
export function suggestVat(amount: number, treatment: TaxBasis, vatRate: number): number {
  const a = toCents(amount);
  const r = rateMilli(vatRate);
  return fromCents(treatment === 'exclusive' ? divRound(a * r, 100000n) : divRound(a * r, 100000n + r));
}

/** The PPh on the net (DPP): rate × net. */
export function suggestWithheld(net: number, pphRate: number): number {
  return fromCents(divRound(toCents(net) * rateMilli(pphRate), 100000n));
}

/** The net (before VAT): the amount itself when tax-exclusive, amount − VAT when tax-inclusive. */
export function netOf(amount: number, treatment: TaxBasis, vat: number): number {
  return treatment === 'exclusive' ? amount : fromCents(toCents(amount) - toCents(vat));
}

export { itemsNetTotal } from './itemsNet';

/** The withholding drafts both bill kinds share: no type = none; a type needs its amount (≥ 0, at most two decimals). */
function parseWithholding(pphTypeRaw: string, withheldRaw: string): VendorWithholding | null {
  if (pphTypeRaw === '') return { withheldAmount: 0, pphType: null };
  if (!isPphType(pphTypeRaw)) return null;
  const withheld = withheldRaw.trim() ? parseMoneyInputAtScale(withheldRaw, 2) : null;
  if (withheld === null || withheld < 0) return null;
  return { withheldAmount: withheld, pphType: withheld > 0 ? pphTypeRaw : null };
}

/** An ERP-bound bill's entered amounts, or null while not submittable. VAT is required (0 allowed). */
export function parseErpTaxAmounts(vatRaw: string, pphTypeRaw: string, withheldRaw: string): ErpVendorTaxAmounts | null {
  const vat = vatRaw.trim() ? parseMoneyInputAtScale(vatRaw, 2) : null;
  if (vat === null || vat < 0) return null;
  const withholding = parseWithholding(pphTypeRaw, withheldRaw);
  return withholding === null ? null : { vatAmount: vat, ...withholding };
}

/**
 * A standalone bill's withholding (DD-VWH-10; OQ-VWH-6 stores its type): no type = none; otherwise it needs its amount
 * and a bill amount, and may not exceed the bill amount. Null = not submittable.
 */
export function parseNativeWithholding(pphTypeRaw: string, withheldRaw: string, amount: number | null): VendorWithholding | null {
  const parsed = parseWithholding(pphTypeRaw, withheldRaw);
  if (parsed === null) return null;
  if (parsed.withheldAmount > 0 && (amount === null || parsed.withheldAmount > amount)) return null;
  return parsed;
}

export type VendorTaxDefaultsDraft =
  | { ok: true; value: VendorTaxDefaultsInput }
  | { ok: false; field: 'vat' | 'pph' };

/** The default editor's drafts: VAT blank or 0–100; a PPh type needs a rate above 0 and below 100 (3 decimals). */
export function parseVendorTaxDefaultsDraft(vatRaw: string, pphTypeRaw: string, pphRaw: string): VendorTaxDefaultsDraft {
  let vatRate: number | null = null;
  if (vatRaw.trim()) {
    const parsed = parseMoneyInputAtScale(vatRaw, 3);
    if (parsed === null || parsed < 0 || parsed > 100) return { ok: false, field: 'vat' };
    vatRate = parsed;
  }
  if (pphTypeRaw === '') return { ok: true, value: { vatRate, pphType: null, pphRate: null } };
  if (!isPphType(pphTypeRaw)) return { ok: false, field: 'pph' };
  const pphRate = pphRaw.trim() ? parseMoneyInputAtScale(pphRaw, 3) : null;
  if (pphRate === null || pphRate <= 0 || pphRate >= 100) return { ok: false, field: 'pph' };
  return { ok: true, value: { vatRate, pphType: pphTypeRaw, pphRate } };
}
