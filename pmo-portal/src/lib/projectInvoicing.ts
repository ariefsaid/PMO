import { normalizeTaxAmount, isTaxTreatment } from '@/src/lib/taxTreatment';

export interface ProjectInvoiceSummaryInput {
  contractAmount: number | null;
  contractCurrency: string;
  contractTreatment: string | null;
  invoices: ReadonlyArray<{
    amount: number | null;
    currency: string | null;
    tax_treatment: string | null;
    tax_amount: number | null;
    status: string;
  }>;
}

export interface ProjectInvoiceSummary {
  invoicedToDate: number;
  remainingToInvoice: number;
  currency: string;
  taxTreatment: 'inclusive' | 'exclusive';
}

/** The submitted states that count as revenue — shared with Revenue by Project (`db/revenue.ts`). */
export const REVENUE_STATUSES = ['Submitted', 'Unpaid', 'Paid'] as const;
const INVOICED_STATUSES = new Set<string>(REVENUE_STATUSES);

/**
 * Calculates the invoiced and remaining figures on the project's recorded contract basis.
 * Submitted, unpaid, and paid rows follow the existing revenue rollup; drafts and cancelled
 * rows do not represent submitted revenue. Any in-scope row that cannot be compared makes the
 * full summary unavailable instead of presenting a partial total.
 */
export function calculateProjectInvoiceSummary(
  input: ProjectInvoiceSummaryInput,
): ProjectInvoiceSummary | null {
  const { contractAmount, contractCurrency, contractTreatment, invoices } = input;
  if (
    contractAmount === null || !Number.isFinite(contractAmount) || contractAmount < 0 ||
    !contractCurrency.trim() || !isTaxTreatment(contractTreatment)
  ) {
    return null;
  }

  let invoicedCents = 0;
  for (const invoice of invoices) {
    if (!INVOICED_STATUSES.has(invoice.status)) continue;
    if (
      invoice.currency !== contractCurrency ||
      invoice.amount === null || invoice.tax_amount === null ||
      !Number.isFinite(invoice.amount) || !Number.isFinite(invoice.tax_amount)
    ) {
      return null;
    }

    const normalized = normalizeTaxAmount(
      invoice.amount,
      invoice.tax_amount,
      invoice.tax_treatment ?? '',
      contractTreatment,
    );
    if (normalized === null) return null;
    invoicedCents += Math.round(normalized * 100);
  }

  const contractCents = Math.round(contractAmount * 100);
  const invoicedToDate = invoicedCents / 100;
  return {
    invoicedToDate,
    remainingToInvoice: (contractCents - invoicedCents) / 100,
    currency: contractCurrency,
    taxTreatment: contractTreatment,
  };
}
