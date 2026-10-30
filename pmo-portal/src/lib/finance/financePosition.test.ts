import { describe, expect, it } from 'vitest';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { totalsByCurrency } from '@/pages/procurement/list/model';
import { buildFinancePosition, isProcurementReadyToPay } from './financePosition';

const today = '2026-10-27';

function invoice(id: string, dueDate: string, overrides: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow {
  return {
    id,
    org_id: 'org-1',
    project_id: null,
    erp_project: null,
    customer_id: null,
    customer_name: 'Client',
    si_number: `SI-${id}`,
    reference_number: null,
    invoice_date: dueDate,
    amount: 100,
    currency: 'IDR',
    tax_treatment: 'exclusive',
    tax_amount: 0,
    erp_outstanding_amount: 100,
    status: 'Unpaid',
    erp_docstatus: 1,
    erp_modified: null,
    erp_amended_from: null,
    erp_cancelled_at: null,
    created_at: `${dueDate}T00:00:00Z`,
    author_user_id: 'author-1',
    author_user_ids: ['author-1'],
    erp_payment_terms_days: 0,
    erp_due_date: dueDate,
    received_date: null,
    efaktur_number: null,
    efaktur_date: null,
    ...overrides,
  };
}

function payment(id: string, amount: number, overrides: Partial<IncomingPaymentRow> = {}): IncomingPaymentRow {
  return {
    id,
    org_id: 'org-1',
    customer_id: null,
    customer_name: 'Client',
    sales_invoice_id: null,
    ip_number: `IP-${id}`,
    reference_number: null,
    date: today,
    amount,
    received_amount: amount,
    withheld_amount: 0,
    allocation_details: [],
    currency: 'IDR',
    status: 'Paid',
    erp_docstatus: 1,
    erp_modified: null,
    erp_amended_from: null,
    erp_cancelled_at: null,
    created_at: `${today}T00:00:00Z`,
    ...overrides,
  };
}

function procurement(id: string, ageDays: number, overrides: Record<string, unknown> = {}): ProcurementWithRefs {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ageDays);
  const isoDate = date.toISOString();
  return {
    id,
    status: 'Vendor Invoiced',
    vendor_invoiced_at: isoDate,
    updated_at: isoDate,
    total_value: 100,
    currency: 'IDR',
    title: `Procurement ${id}`,
    code: id,
    project_id: null,
    vendor_id: null,
    project: null,
    vendor: { name: 'Supplier' },
    requested_by: null,
    procurement_invoices: [{ amount: 100 }],
    payments: [],
    ...overrides,
  } as unknown as ProcurementWithRefs;
}

const calculate = (invoices: SalesInvoiceRow[], procurements: ProcurementWithRefs[] = []) =>
  buildFinancePosition({
    invoices,
    payments: [],
    procurements,
    today,
    canApproveDraft: (row) => row.author_user_id !== 'viewer',
  });

describe('buildFinancePosition', () => {
  it('sorts overdue invoices oldest first and reports calendar days overdue', () => {
    const position = calculate([
      invoice('newer', '2026-10-17'),
      invoice('older', '2026-09-19'),
    ]);

    expect(position.overdue.map((row) => [row.invoice.id, row.daysOverdue])).toEqual([
      ['older', 38],
      ['newer', 10],
    ]);
  });

  it('counts unknown balances without including them in known currency totals', () => {
    const position = calculate([
      invoice('known', '2026-10-01', { erp_outstanding_amount: 125.5 }),
      invoice('unknown', '2026-10-02', { erp_outstanding_amount: null }),
    ]);

    expect(position.receivablesUnknownCount).toBe(1);
    expect(position.overdueUnknownCount).toBe(1);
    expect(position.overdueTotals).toEqual({ IDR: 12_550 });
    expect(position.overdue.find((row) => row.invoice.id === 'unknown')?.outstanding).toBeNull();
  });

  it('counts every open receivable, including invoices with an unknown balance, and excludes closed states', () => {
    const position = calculate([
      invoice('unpaid', '2026-10-01'),
      invoice('submitted', '2026-10-02', { status: 'Submitted' }),
      invoice('unknown', '2026-10-03', { erp_outstanding_amount: null }),
      invoice('draft', '2026-10-04', { status: 'Draft' }),
      invoice('paid', '2026-10-05', { status: 'Paid' }),
      invoice('cancelled', '2026-10-06', { status: 'Cancelled' }),
    ]);

    expect(position.receivablesCount).toBe(3);
  });

  it('uses the stated receivables ageing boundaries and keeps invoices due today out of overdue', () => {
    const position = calculate([
      invoice('due-today', today),
      invoice('d30', '2026-09-27'),
      invoice('d31', '2026-09-26'),
      invoice('d60', '2026-08-28'),
      invoice('d61', '2026-08-27'),
      invoice('d90', '2026-07-29'),
      invoice('d91', '2026-07-28'),
    ]);

    expect(position.overdue.some((row) => row.invoice.id === 'due-today')).toBe(false);
    expect(position.receivablesAgeing.IDR).toEqual({
      notDue: 10_000,
      d1_30: 10_000,
      d31_60: 20_000,
      d61_90: 20_000,
      over90: 10_000,
    });
  });

  it('shares the dashboard Vendor Invoiced predicate and bins payable ages at 30/31, 60/61 and 90/91 days', () => {
    const rows = [30, 31, 60, 61, 90, 91].map((age, index) => procurement(`p${index}`, age));
    const notReady = procurement('not-ready', 1, { status: 'Ordered' });
    const position = calculate([], [...rows, notReady]);

    expect(isProcurementReadyToPay(rows[0])).toBe(true);
    expect(isProcurementReadyToPay(notReady)).toBe(false);
    expect(position.payables.map((row) => row.procurement.id)).not.toContain('not-ready');
    expect(position.payablesAgeing.IDR).toEqual({ d0_30: 10_000, d31_60: 20_000, d61_90: 20_000, over90: 10_000 });
  });

  it('keeps receivables, unapplied cash and payables totals separate by currency', () => {
    const position = buildFinancePosition({
      invoices: [
        invoice('idr', '2026-10-01', { currency: 'IDR', erp_outstanding_amount: 100 }),
        invoice('usd', '2026-10-01', { currency: 'USD', erp_outstanding_amount: 25 }),
      ],
      payments: [
        payment('idr-cash', 50, { currency: 'IDR', received_amount: 50 }),
        payment('usd-cash', 10, { currency: 'USD', received_amount: 10 }),
      ],
      procurements: [
        procurement('idr-po', 5, { currency: 'IDR', procurement_invoices: [{ amount: 75 }] }),
        procurement('usd-po', 5, { currency: 'USD', procurement_invoices: [{ amount: 20 }] }),
      ],
      today,
      canApproveDraft: () => false,
    });

    expect(position.overdueTotals).toEqual({ IDR: 10_000, USD: 2_500 });
    expect(position.unappliedTotals).toEqual({ IDR: 5_000, USD: 1_000 });
    expect(position.payablesTotals).toEqual({ IDR: 7_500, USD: 2_000 });
  });

  it('SEC-RS-2: Payables total equals the Procurement list unpaid total for the same rows', () => {
    const rows = [
      // Supplier invoice above the PO value (tax-inclusive), partly paid; a scheduled payment is not paid.
      procurement('partial', 10, {
        total_value: 1000,
        procurement_invoices: [{ amount: 1110 }],
        payments: [{ amount: 400, status: 'Paid' }, { amount: 200, status: 'Scheduled' }],
      }),
      // Supplier invoiced below the PO value, unpaid.
      procurement('under', 40, { total_value: 900, procurement_invoices: [{ amount: 850 }] }),
      procurement('usd', 5, { currency: 'USD', total_value: 50, procurement_invoices: [{ amount: 60 }], payments: [{ amount: 60, status: 'Paid' }] }),
    ];
    const position = calculate([], rows);
    const list = totalsByCurrency(rows, 'Finance', 'pay');

    expect(list).toEqual([
      { currency: 'IDR', amount: 1560, unknown: false, knownAmount: 1560, unknownCount: 0 },
      { currency: 'USD', amount: 0, unknown: false, knownAmount: 0, unknownCount: 0 },
    ]);
    expect(position.payablesTotals).toEqual({ IDR: 156_000, USD: 0 });
    for (const total of list) expect(position.payablesTotals[total.currency]).toBe(Math.round((total.amount ?? NaN) * 100));
    expect(position.payables.find((row) => row.procurement.id === 'partial')?.amount).toBe(71_000);
    expect(position.payablesAgeing.IDR).toEqual({ d0_30: 71_000, d31_60: 85_000, d61_90: 0, over90: 0 });
    expect(position.payablesUnknownCount).toBe(0);
  });

  it('SEC-RS-2: an unknown supplier balance stays unknown, never zero, and is left out of known totals', () => {
    const rows = [
      procurement('known', 5, { procurement_invoices: [{ amount: 300 }] }),
      procurement('no-invoice', 5, { total_value: 999, procurement_invoices: [] }),
    ];
    const position = calculate([], rows);

    expect(position.payables.find((row) => row.procurement.id === 'no-invoice')?.amount).toBeNull();
    expect(position.payablesUnknownCount).toBe(1);
    expect(position.payablesTotals).toEqual({ IDR: 30_000 });
    expect(position.payablesAgeing.IDR).toEqual({ d0_30: 30_000, d31_60: 0, d61_90: 0, over90: 0 });
    expect(totalsByCurrency(rows, 'Finance', 'pay')).toEqual([
      { currency: 'IDR', amount: null, unknown: true, knownAmount: 300, unknownCount: 1 },
    ]);
  });
});
