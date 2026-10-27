import { describe, expect, it } from 'vitest';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
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

    expect(position.overdueUnknownCount).toBe(1);
    expect(position.overdueTotals).toEqual({ IDR: 12_550 });
    expect(position.overdue.find((row) => row.invoice.id === 'unknown')?.outstanding).toBeNull();
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
        procurement('idr-po', 5, { currency: 'IDR', total_value: 75 }),
        procurement('usd-po', 5, { currency: 'USD', total_value: 20 }),
      ],
      today,
      canApproveDraft: () => false,
    });

    expect(position.overdueTotals).toEqual({ IDR: 10_000, USD: 2_500 });
    expect(position.unappliedTotals).toEqual({ IDR: 5_000, USD: 1_000 });
    expect(position.payablesTotals).toEqual({ IDR: 7_500, USD: 2_000 });
  });
});
