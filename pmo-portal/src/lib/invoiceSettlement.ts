/**
 * Invoice settlement — how much of the invoicing is settled and how much is still owed (#2204,
 * docs/specs/invoice-settlement.spec.md).
 *
 * This module owns the whole rule so no page re-derives it:
 * - which invoices count (Submitted / Unpaid / Paid, not cancelled in the accounting system);
 * - the comparable basis: GROSS (tax included), the rule `get_project_finances` applies server-side
 *   (0392 → 0791). `erp_outstanding_amount` is already gross — what the client still owes — so
 *   settled = gross − outstanding. Subtracting the balance from a tax-exclusive `amount` would read
 *   an unpaid invoice as "paid minus its tax";
 * - the denomination: amounts are added only within one invoice currency. Two currencies give a
 *   `mixed` result that carries no amount, and `settlementIn` hands figures to a caller only for the
 *   exact currency the result is in, so a sum is never relabelled as the project currency.
 *
 * Settlement is not cash received (that is the receipt projection's `cash_received`), and the
 * document total is not contract-normalised billing (`contract_invoiced`). Each stays its own figure.
 */

/** One invoice as the settlement rule reads it. Every field is the invoice's own. */
export interface SettlementInvoice {
  status: string;
  currency: string | null | undefined;
  /** Does `amount` already include its tax? (`inclusive` | `exclusive`; anything else is unknown.) */
  tax_treatment: string | null | undefined;
  /** The document total as stated, on the invoice's own tax basis. */
  amount: number | null;
  tax_amount: number | null | undefined;
  /** Accounting balance outstanding, gross (tax included). */
  erp_outstanding_amount: number | null;
  erp_docstatus?: number | null;
  erp_cancelled_at?: string | null;
}

export type DocumentBasis = 'inclusive' | 'exclusive' | 'mixed';

/** Figures for one currency. `null` = unknown, never zero. */
export interface CurrencySettlement {
  currency: string;
  /** Σ document amounts as stated (null when one is missing); `documentBasis` says which tax basis they are on. */
  documentTotal: number | null;
  documentBasis: DocumentBasis | null;
  /** Σ gross amounts — the comparable basis for outstanding and settled. */
  gross: number | null;
  /** Σ accounting balances outstanding (gross); null when any balance is unknown. */
  outstanding: number | null;
  /** gross − outstanding; null when either is unknown. */
  settled: number | null;
  /** Every counted invoice has an accounting balance. */
  balancesKnown: boolean;
}

export type InvoiceSettlement =
  | { denomination: 'none' }
  | { denomination: 'mixed'; currencies: string[] }
  | ({ denomination: 'single' } & CurrencySettlement);

const COUNTED_STATUSES = new Set(['Submitted', 'Unpaid', 'Paid']);

/** FR-SET-001: the same scope the server projection counts. */
export function countsTowardSettlement(invoice: Pick<SettlementInvoice, 'status' | 'erp_docstatus' | 'erp_cancelled_at'>): boolean {
  return COUNTED_STATUSES.has(invoice.status) && invoice.erp_docstatus !== 2 && !invoice.erp_cancelled_at;
}

const cents = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;

/** FR-SET-004: what the client owes in full, in cents; null when the basis or a figure is unknown. */
function grossCents(invoice: SettlementInvoice): number | null {
  const amount = cents(invoice.amount);
  if (amount === null) return null;
  if (invoice.tax_treatment === 'inclusive') return amount;
  if (invoice.tax_treatment !== 'exclusive') return null;
  const tax = cents(invoice.tax_amount);
  return tax === null ? null : amount + tax;
}

const sumOrNull = (values: Array<number | null>): number | null =>
  values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 100 : null;

export function summarizeInvoiceSettlement(invoices: readonly SettlementInvoice[]): InvoiceSettlement {
  const counted = invoices.filter(countsTowardSettlement);
  if (counted.length === 0) return { denomination: 'none' };

  // FR-SET-002: a missing currency is unknown denomination, never the caller's currency.
  const currencies = [...new Set(counted.map((invoice) => invoice.currency || ''))];
  if (currencies.length !== 1 || currencies[0] === '') {
    return { denomination: 'mixed', currencies: currencies.filter(Boolean).sort() };
  }

  const amounts = counted.map((invoice) => cents(invoice.amount));
  const grosses = counted.map(grossCents);
  const balances = counted.map((invoice) => cents(invoice.erp_outstanding_amount));
  const treatments = new Set(counted.map((invoice) => invoice.tax_treatment));
  const documentBasis: DocumentBasis = treatments.size === 1 && (treatments.has('inclusive') || treatments.has('exclusive'))
    ? (counted[0].tax_treatment as 'inclusive' | 'exclusive')
    : 'mixed';
  const gross = sumOrNull(grosses);
  const outstanding = sumOrNull(balances);
  const settledCents = gross !== null && outstanding !== null
    ? grosses.reduce<number>((sum, value) => sum + (value ?? 0), 0) - balances.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  return {
    denomination: 'single',
    currency: currencies[0],
    documentTotal: sumOrNull(amounts),
    documentBasis,
    gross,
    outstanding,
    settled: settledCents === null ? null : settledCents / 100,
    balancesKnown: outstanding !== null,
  };
}

/**
 * FR-SET-007: the settlement figures in `currency`, or null when the result is in any other currency or
 * mixed. With nothing counted the figures are zero in whichever currency is asked.
 */
export function settlementIn(settlement: InvoiceSettlement, currency: string): CurrencySettlement | null {
  if (settlement.denomination === 'none') {
    return { currency, documentTotal: 0, documentBasis: null, gross: 0, outstanding: 0, settled: 0, balancesKnown: true };
  }
  if (settlement.denomination === 'mixed' || settlement.currency !== currency) return null;
  const { denomination: _denomination, ...figures } = settlement;
  return figures;
}
