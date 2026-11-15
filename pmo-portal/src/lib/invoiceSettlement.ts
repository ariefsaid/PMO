export interface InvoiceSettlementInput {
  status: string;
  amount: number | null;
  erp_outstanding_amount: number | null;
}

export interface InvoiceSettlementSummary {
  invoiced: number | null;
  paid: number;
  unpaid: number | null;
  balancesKnown: boolean;
}

/** Submitted invoices settle from ERP balances; unknown balances contribute only fully Paid invoices. */
export function summarizeInvoiceSettlement(invoices: readonly InvoiceSettlementInput[]): InvoiceSettlementSummary {
  const submitted = invoices.filter((invoice) => invoice.status !== 'Draft' && invoice.status !== 'Cancelled');
  const cents = (value: number | null): number | null => value !== null && Number.isFinite(value) ? Math.round(value * 100) : null;
  const amounts = submitted.map((invoice) => cents(invoice.amount));
  const balances = submitted.map((invoice) => cents(invoice.erp_outstanding_amount));
  const balancesKnown = amounts.every((value) => value !== null) && balances.every((value) => value !== null);
  const invoiced = amounts.every((value) => value !== null)
    ? amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 100
    : null;
  const paidCents = balancesKnown
    ? submitted.reduce((sum, invoice) => sum + (cents(invoice.amount) ?? 0) - (cents(invoice.erp_outstanding_amount) ?? 0), 0)
    : submitted.reduce((sum, invoice) => invoice.status === 'Paid' ? sum + (cents(invoice.amount) ?? 0) : sum, 0);
  const unpaid = balancesKnown ? balances.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 100 : null;
  return { invoiced, paid: paidCents / 100, unpaid, balancesKnown };
}
