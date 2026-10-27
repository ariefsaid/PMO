import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { knownUnappliedCash } from '@/src/lib/revenue/receiptAllocation';

export type CurrencyTotals = Record<string, number>;

export interface AgeingBuckets {
  notDue: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  over90: number;
}

export interface PayablesAgeingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  over90: number;
}

export interface FinancePositionInput {
  invoices: readonly SalesInvoiceRow[];
  payments: readonly IncomingPaymentRow[];
  procurements: readonly ProcurementWithRefs[];
  today: string | null | undefined;
  currentUserId?: string | null;
  canApproveDraft: (invoice: SalesInvoiceRow) => boolean;
}

export interface FinancePosition {
  overdue: Array<{ invoice: SalesInvoiceRow; daysOverdue: number; outstanding: number | null }>;
  overdueTotals: CurrencyTotals;
  overdueUnknownCount: number;
  drafts: {
    canApprove: SalesInvoiceRow[];
    awaitingOther: SalesInvoiceRow[];
    all: SalesInvoiceRow[];
  };
  toSend: SalesInvoiceRow[];
  unappliedPayments: Array<{ payment: IncomingPaymentRow; amount: number }>;
  unappliedTotals: CurrencyTotals;
  payables: Array<{ procurement: ProcurementWithRefs; ageDays: number; amount: number }>;
  payablesTotals: CurrencyTotals;
  receivablesAgeing: Record<string, AgeingBuckets>;
  payablesAgeing: Record<string, PayablesAgeingBuckets>;
}

const OPEN_INVOICE_STATUSES = new Set<SalesInvoiceRow['status']>(['Unpaid', 'Submitted']);

/** The one shared predicate for the dashboard's Ready to pay list and Finance payables. */
export function isProcurementReadyToPay(procurement: Pick<ProcurementWithRefs, 'status'>): boolean {
  return procurement.status === 'Vendor Invoiced';
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

function add(total: CurrencyTotals, currency: string, amountCents: number): void {
  total[currency] = (total[currency] ?? 0) + amountCents;
}

function calendarAgeDays(date: string | null | undefined, today: string | null | undefined): number | null {
  if (!date || !today) return null;
  const datePart = date.slice(0, 10);
  const value = Date.parse(`${datePart}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(value) || !Number.isFinite(current)) return null;
  return Math.max(0, Math.floor((current - value) / 86_400_000));
}

function receivableBucket(days: number): keyof AgeingBuckets {
  if (days <= 0) return 'notDue';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'over90';
}

function payableBucket(days: number): keyof PayablesAgeingBuckets {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'over90';
}

/** Pure display calculation shared by the finance area and its attention/ageing blocks. */
export function buildFinancePosition(input: FinancePositionInput): FinancePosition {
  const { invoices, payments, procurements, today, canApproveDraft } = input;
  const overdue: FinancePosition['overdue'] = [];
  const overdueTotals: CurrencyTotals = {};
  const receivablesAgeing: Record<string, AgeingBuckets> = {};
  let overdueUnknownCount = 0;

  for (const invoice of invoices) {
    if (!OPEN_INVOICE_STATUSES.has(invoice.status)) continue;
    const outstanding = invoice.erp_outstanding_amount;
    const dueDate = deriveArDueDate(
      invoice.invoice_date,
      invoice.erp_payment_terms_days,
      invoice.erp_due_date,
      invoice.received_date,
    );
    const age = overdueAgeDays(dueDate, today);

    if (outstanding != null && Number.isFinite(outstanding)) {
      const buckets = receivablesAgeing[invoice.currency] ??= { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
      const bucket = receivableBucket(age ?? 0);
      buckets[bucket] += cents(outstanding);
    }

    if (age == null || age <= 0) continue;
    if (outstanding == null || !Number.isFinite(outstanding)) {
      overdueUnknownCount += 1;
    } else {
      add(overdueTotals, invoice.currency, cents(outstanding));
    }
    overdue.push({
      invoice,
      daysOverdue: age,
      outstanding: outstanding == null || !Number.isFinite(outstanding) ? null : cents(outstanding),
    });
  }
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const draftRows = invoices.filter((invoice) => invoice.status === 'Draft');
  const drafts = {
    canApprove: draftRows.filter(canApproveDraft),
    awaitingOther: input.currentUserId
      ? draftRows.filter((invoice) => invoice.author_user_id === input.currentUserId || invoice.author_user_ids.includes(input.currentUserId as string))
      : [],
    all: draftRows,
  };
  const toSend = invoices.filter((invoice) =>
    invoice.status !== 'Draft' && invoice.status !== 'Cancelled' && invoice.status !== 'Paid' && !invoice.received_date,
  );

  const unappliedPayments: FinancePosition['unappliedPayments'] = [];
  const unappliedTotals: CurrencyTotals = {};
  for (const payment of payments) {
    if (payment.cancelled_at || payment.erp_cancelled_at) continue;
    const amount = knownUnappliedCash(payment);
    if (amount == null || amount <= 0) continue;
    unappliedPayments.push({ payment, amount: cents(amount) });
    add(unappliedTotals, payment.currency, cents(amount));
  }

  const payables: FinancePosition['payables'] = [];
  const payablesTotals: CurrencyTotals = {};
  const payablesAgeing: Record<string, PayablesAgeingBuckets> = {};
  for (const procurement of procurements) {
    if (!isProcurementReadyToPay(procurement)) continue;
    const ageDays = calendarAgeDays(procurement.vendor_invoiced_at ?? procurement.updated_at, today);
    if (ageDays == null) continue;
    const amount = Number(procurement.total_value);
    if (!Number.isFinite(amount)) continue;
    const amountCents = cents(amount);
    payables.push({ procurement, ageDays, amount: amountCents });
    add(payablesTotals, procurement.currency, amountCents);
    const buckets = payablesAgeing[procurement.currency] ??= { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    buckets[payableBucket(ageDays)] += amountCents;
  }
  payables.sort((a, b) => b.ageDays - a.ageDays);

  return {
    overdue,
    overdueTotals,
    overdueUnknownCount,
    drafts,
    toSend,
    unappliedPayments,
    unappliedTotals,
    payables,
    payablesTotals,
    receivablesAgeing,
    payablesAgeing,
  };
}
