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
 * Wherever Invoiced, Paid and Unpaid stand together they all read gross, so Paid + Unpaid = Invoiced.
 * Project-scope figures come from the server projection (`settlementFromFinanceBuckets`); the row rule
 * (`summarizeInvoiceSettlement`) is for per-order and per-invoice figures and mirrors it.
 *
 * Settlement is not cash received (that is the receipt projection's `cash_received`), and gross invoiced is
 * not contract-normalised billing (`contract_invoiced`, on the contract's own tax basis). Each stays its own figure.
 */

import { parseExactCents } from './exactDecimal';
import type { InvoiceFinanceBucket } from './projectFinances';

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

/** Figures for one currency, all on the gross basis so settled + outstanding = gross. `null` = unknown, never zero. */
export interface CurrencySettlement {
  currency: string;
  /** Σ gross amounts: what was invoiced, including tax. */
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

const sumCents = (values: Array<number | null>): number | null =>
  values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;

/** One denomination from a list of currencies; a missing currency is unknown, never the caller's (FR-SET-002). */
function denominationOf(currencies: Array<string | null | undefined>): { currency: string } | { currencies: string[] } {
  const distinct = [...new Set(currencies.map((currency) => currency || ''))];
  return distinct.length === 1 && distinct[0] !== '' ? { currency: distinct[0] } : { currencies: distinct.filter(Boolean).sort() };
}

function fromCents(currency: string, gross: number | null, outstanding: number | null): InvoiceSettlement {
  return {
    denomination: 'single',
    currency,
    gross: gross === null ? null : gross / 100,
    outstanding: outstanding === null ? null : outstanding / 100,
    settled: gross === null || outstanding === null ? null : (gross - outstanding) / 100,
    balancesKnown: outstanding !== null,
  };
}

/** Row-level rule, for per-order and per-invoice figures. It mirrors the server projection's rule. */
export function summarizeInvoiceSettlement(invoices: readonly SettlementInvoice[]): InvoiceSettlement {
  const counted = invoices.filter(countsTowardSettlement);
  if (counted.length === 0) return { denomination: 'none' };
  const denomination = denominationOf(counted.map((invoice) => invoice.currency));
  if ('currencies' in denomination) return { denomination: 'mixed', currencies: denomination.currencies };
  return fromCents(
    denomination.currency,
    sumCents(counted.map(grossCents)),
    sumCents(counted.map((invoice) => cents(invoice.erp_outstanding_amount))),
  );
}

const exactCents = (value: string | null | undefined): number | null => {
  if (typeof value !== 'string') return null;
  const units = parseExactCents(value);
  return units === null || units > BigInt(Number.MAX_SAFE_INTEGER) || units < -BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(units);
};

/**
 * Project-level figures read from the server projection (`get_project_finances`, 0791): one bucket per invoice
 * currency, `settled` and `outstanding` already gross. Gross invoiced is settled + outstanding, or the stated total
 * when every invoice in the bucket is tax-inclusive. A missing reading (undefined) is unknown.
 */
export function settlementFromFinanceBuckets(buckets: readonly InvoiceFinanceBucket[] | null | undefined): InvoiceSettlement | null {
  if (!Array.isArray(buckets)) return null;
  if (buckets.length === 0) return { denomination: 'none' };
  const denomination = denominationOf(buckets.map((bucket) => bucket.currency));
  if (buckets.length > 1 || 'currencies' in denomination) {
    return { denomination: 'mixed', currencies: 'currencies' in denomination ? denomination.currencies : [denomination.currency] };
  }
  const [bucket] = buckets;
  const settled = exactCents(bucket.settled);
  const outstanding = exactCents(bucket.outstanding);
  const gross = settled !== null && outstanding !== null
    ? settled + outstanding
    : bucket.tax_basis === 'inclusive' ? exactCents(bucket.invoiced) : null;
  return fromCents(denomination.currency, gross, outstanding);
}

/**
 * FR-SET-007: the figures to show in `currency` — only when the result is denominated in exactly that currency;
 * a mixed or foreign-currency result gives null. With nothing counted the figures are zero in any currency.
 */
export function settlementIn(settlement: InvoiceSettlement, currency: string): CurrencySettlement | null {
  if (settlement.denomination === 'none') return { currency, gross: 0, outstanding: 0, settled: 0, balancesKnown: true };
  if (settlement.denomination === 'mixed' || settlement.currency !== currency) return null;
  const { denomination: _denomination, ...figures } = settlement;
  return figures;
}

export type OutstandingSum =
  | { denomination: 'none' }
  | { denomination: 'mixed'; currencies: string[] }
  | { denomination: 'single'; currency: string; amount: number };

/**
 * Σ positive known balances within one currency (the overdue callout). Invoices without a balance add nothing;
 * balances in two currencies are never added (FR-SET-010).
 */
export function sumOutstanding(invoices: ReadonlyArray<Pick<SettlementInvoice, 'currency' | 'erp_outstanding_amount'>>): OutstandingSum {
  const known = invoices.flatMap((invoice) => {
    const balance = cents(invoice.erp_outstanding_amount);
    return balance === null ? [] : [{ currency: invoice.currency, balance: Math.max(0, balance) }];
  });
  if (known.length === 0) return { denomination: 'none' };
  const denomination = denominationOf(known.map((row) => row.currency));
  if ('currencies' in denomination) return { denomination: 'mixed', currencies: denomination.currencies };
  return { denomination: 'single', currency: denomination.currency, amount: known.reduce((sum, row) => sum + row.balance, 0) / 100 };
}

/** The outstanding sum in `currency`, or null when it is mixed or in another currency. */
export function outstandingIn(sum: OutstandingSum, currency: string): number | null {
  if (sum.denomination === 'none') return 0;
  return sum.denomination === 'single' && sum.currency === currency ? sum.amount : null;
}
