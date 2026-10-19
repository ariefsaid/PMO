/**
 * #784 — the pure display rules the PMO-native revenue surfaces share (docs/specs/no-erp-revenue.spec.md).
 * Display only: migration 0275's RPCs are the authority for every figure these read.
 */
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { calculateStandaloneTax, type TaxBaseFraction } from '@/src/lib/taxTreatment';
import { decimalUnits } from '@/src/lib/taxNormalize';

export interface InvoiceDraftLineAmount {
  qty: number;
  rate: number;
}

export interface InvoiceDraftTaxFacts {
  treatment: 'exclusive' | 'inclusive';
  rate: number;
  fraction: TaxBaseFraction;
}

export interface InvoiceDraftPreview {
  /** The known net/subtotal value in source currency, or null while the lines are invalid. */
  subtotal: number | null;
  /** Null means the tax cannot be established from available facts; zero is known zero tax. */
  tax: number | null;
  /** Null means the final value is not yet known. */
  total: number | null;
  reason: 'invalid-lines' | 'tax-unavailable' | null;
}

/**
 * A read-only native draft preview. It rounds each authored line to cents before summing,
 * matching the native create RPC; tax uses the existing standalone calculator and stored facts.
 * This preview is never supplied to the writer and is not ERP tax authority.
 */
export function previewInvoiceDraft(
  lines: readonly InvoiceDraftLineAmount[],
  tax: InvoiceDraftTaxFacts | null,
): InvoiceDraftPreview {
  if (lines.length === 0) return { subtotal: null, tax: null, total: null, reason: 'invalid-lines' };

  let subtotalCents = 0n;
  for (const line of lines) {
    if (
      !Number.isFinite(line.qty) || line.qty <= 0 || line.qty >= 1e12 ||
      !Number.isFinite(line.rate) || line.rate < 0 || line.rate >= 1e12
    ) {
      return { subtotal: null, tax: null, total: null, reason: 'invalid-lines' };
    }
    const qtyThousandths = decimalUnits(line.qty, 3);
    const rateCents = decimalUnits(line.rate, 2);
    if (qtyThousandths === null || rateCents === null) {
      return { subtotal: null, tax: null, total: null, reason: 'invalid-lines' };
    }

    // qty(1/1000) × rate(cents) gives 1/1000 cents; round half-up per line.
    subtotalCents += (qtyThousandths * rateCents + 500n) / 1000n;
    if (subtotalCents >= 100_000_000_000_000n) {
      return { subtotal: null, tax: null, total: null, reason: 'invalid-lines' };
    }
  }

  const amount = Number(subtotalCents) / 100;
  if (!tax) return { subtotal: amount, tax: null, total: null, reason: 'tax-unavailable' };

  const amounts = calculateStandaloneTax(amount, tax.treatment, tax.rate, tax.fraction);
  if (!amounts) return { subtotal: amount, tax: null, total: null, reason: 'tax-unavailable' };
  return { subtotal: amounts.netAmount, tax: amounts.taxAmount, total: amounts.grossAmount, reason: null };
}

/** One line of a PMO invoice as raised (DD-NAR-8). */
export interface NativeInvoiceLine {
  item_code: string | null;
  description: string | null;
  qty: number;
  rate: number;
  amount: number;
}

/** The number a person reads for an invoice: the ERP's document name when it has one, else PMO's own (DD-NAR-9). */
export function invoiceNumber(inv: { si_number: string | null; pmo_number?: string | null }): string | null {
  return inv.si_number ?? inv.pmo_number ?? null;
}

/** The number a person reads for a receipt: the ERP's, else PMO's own. */
export function receiptNumber(p: { ip_number: string | null; pmo_number?: string | null }): string | null {
  return p.ip_number ?? p.pmo_number ?? null;
}

/** The invoice value before tax: inclusive amounts have their tax removed; exclusive amounts are already net. */
export function invoiceNet(inv: { amount: number | null; tax_amount: number; tax_treatment: string }): number | null {
  if (inv.amount == null) return null;
  if (inv.tax_treatment === 'inclusive') return Math.round((inv.amount - inv.tax_amount) * 100) / 100;
  return inv.amount;
}

/** What the client owes in full, by 0188's rule: an inclusive amount already holds its tax. */
export function invoiceGross(inv: { amount: number | null; tax_amount: number; tax_treatment: string }): number | null {
  if (inv.amount == null) return null;
  if (inv.tax_treatment === 'inclusive') return inv.amount;
  return Math.round((inv.amount + inv.tax_amount) * 100) / 100;
}

/** A submitted/unpaid invoice with a known balance below gross reads "Partly paid". Never stored. */
export function isPartlyPaid(
  inv: Pick<SalesInvoiceRow, 'status' | 'erp_outstanding_amount' | 'amount' | 'tax_amount' | 'tax_treatment'> & {
    pmo_native?: boolean;
  },
): boolean {
  if ((inv.status !== 'Unpaid' && inv.status !== 'Submitted') || inv.erp_outstanding_amount == null) return false;
  const gross = invoiceGross(inv);
  return gross != null && inv.erp_outstanding_amount > 0 && inv.erp_outstanding_amount < gross;
}

/** DD-NAR-17: what a PMO invoice received beyond its gross, or null when nothing was overpaid. */
export function overpaidBy(inv: { pmo_native?: boolean; overpaid_amount?: number | null }): number | null {
  if (!inv.pmo_native || inv.overpaid_amount == null || inv.overpaid_amount <= 0) return null;
  return inv.overpaid_amount;
}

/**
 * I-4: what a PMO invoice has been paid so far, so gross − paid = outstanding reads by eye. By DD-NAR-4 the balance is
 * gross − live receipts and any excess is `overpaid_amount` (DD-NAR-17), so paid = gross − balance + overpaid. Null for
 * a Draft, a Cancelled invoice (its balance is zeroed, not paid), an ERP invoice, or one with no balance reported.
 */
export function paidToDate(
  inv: Pick<SalesInvoiceRow, 'status' | 'erp_outstanding_amount' | 'amount' | 'tax_amount' | 'tax_treatment'> & {
    pmo_native?: boolean;
    overpaid_amount?: number | null;
  },
): number | null {
  if (!inv.pmo_native || (inv.status !== 'Unpaid' && inv.status !== 'Paid') || inv.erp_outstanding_amount == null) return null;
  const gross = invoiceGross(inv);
  if (gross == null) return null;
  return Math.round((gross - inv.erp_outstanding_amount + (inv.overpaid_amount ?? 0)) * 100) / 100;
}

/** What a PMO invoice bills, in one line of text: its first line, plus how many more. */
export function nativeInvoiceSummary(inv: { native_lines?: NativeInvoiceLine[] | null }): string | null {
  const lines = inv.native_lines ?? [];
  if (lines.length === 0) return null;
  const first = lines[0].description ?? lines[0].item_code ?? '';
  return lines.length > 1 ? `${first} +${lines.length - 1}` : first;
}
