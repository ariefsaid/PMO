// Dashboard reads (perf round 2): one narrow request each, and the figures they feed are exactly what the full lists gave.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ table: string; select?: string; ops: string[] }> = [];
let tableRows: Record<string, unknown[]> = {};
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call: { table: string; select?: string; ops: string[] } = { table, ops: [] };
      calls.push(call);
      const q: Record<string, unknown> = {};
      for (const op of ['in', 'is', 'eq', 'order', 'gte', 'lt', 'gt']) q[op] = (...a: unknown[]) => { call.ops.push(`${op}:${a.join(',')}`); return q; };
      q.select = (s: string) => { call.select = s; return q; };
      q.range = () => Promise.resolve({ data: tableRows[table] ?? [], error: null });
      q.limit = (n: unknown) => Promise.resolve({ data: (tableRows[table] ?? []).slice(0, Number(n)), error: null });
      return q;
    },
  },
}));

import { listOverdueInvoiceFacts, listPaidPaymentFacts, listMonthlyInvoiceFacts, hasAnySalesInvoice, hasAnyIncomingPayment } from './revenue';
import { selectOverdueInvoices } from '@/src/components/dashboard/restructure/useNeedsYou';
import { selectCollectedTotals } from '@/src/components/dashboard/restructure/useCompanyFigures';

const invoice = (id: string, status: string, due: string | null, terms: number | null, outstanding: number | null, currency = 'USD') => ({
  id, status, currency, invoice_date: '2026-01-10', erp_due_date: due, received_date: null, erp_outstanding_amount: outstanding,
  companies: { erp_payment_terms_days: terms },
});

beforeEach(() => { calls.length = 0; tableRows = {}; });

describe('listOverdueInvoiceFacts', () => {
  it('is one sales_invoices read without the authors join or select-star, open invoices only', async () => {
    tableRows.sales_invoices = [invoice('a', 'Unpaid', '2026-02-01', null, 100)];
    await listOverdueInvoiceFacts();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('sales_invoices');
    expect(calls[0].select).not.toMatch(/\*|sales_invoice_authors/);
    // Open = the shared rule (#1457); compare as a set, the order carries no meaning.
    const statusOp = calls[0].ops.find((o) => o.startsWith('in:status,'));
    expect(statusOp?.slice('in:status,'.length).split(',').sort()).toEqual(['Submitted', 'Unpaid']);
    expect(calls[0].ops).toContain('is:paired_erp_invoice_id,');
  });

  it('feeds the overdue tile the same figures as the full open list (count, totals, unknown balances, oldest)', async () => {
    const open = [
      invoice('a', 'Unpaid', '2026-02-01', null, 100),
      invoice('b', 'Submitted', null, 30, 250.5),
      invoice('c', 'Unpaid', '2026-12-31', null, 40),
      invoice('d', 'Submitted', '2026-03-01', null, null, 'IDR'),
    ];
    tableRows.sales_invoices = open;
    const facts = await listOverdueInvoiceFacts();
    const full = open.map(({ companies, ...row }) => ({ ...row, erp_payment_terms_days: companies.erp_payment_terms_days }));
    // The full list also carried Draft/Paid/Cancelled rows; the selector drops them, so the narrow read need not fetch them.
    const withClosed = [...full, { ...full[0], id: 'e', status: 'Paid' }, { ...full[0], id: 'f', status: 'Draft' }];
    const old = selectOverdueInvoices(withClosed as never, '2026-06-01');
    expect(selectOverdueInvoices(facts, '2026-06-01')).toEqual(old);
    expect(old).toMatchObject({ count: 3, unknownBalances: 1 });
  });
});

describe('listPaidPaymentFacts', () => {
  it('is one incoming_payments read: Paid only, four columns, no customer join and no receipt-command read', async () => {
    tableRows.incoming_payments = [];
    await listPaidPaymentFacts();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('incoming_payments');
    expect(calls[0].select).toBe('status,date,amount,currency');
    expect(calls[0].ops).toContain('eq:status,Paid');
  });

  it('feeds the collected figure the same totals as the full list', async () => {
    const paid = [
      { status: 'Paid', date: '2026-03-05', amount: 100.1, currency: 'USD' },
      { status: 'Paid', date: '2026-03-20', amount: 200.2, currency: 'USD' },
      { status: 'Paid', date: '2026-04-01', amount: null, currency: 'IDR' },
      { status: 'Paid', date: '2025-12-31', amount: 5, currency: 'USD' },
    ];
    tableRows.incoming_payments = paid;
    const facts = await listPaidPaymentFacts();
    const full = [...paid, { status: 'Scheduled', date: '2026-03-10', amount: 999, currency: 'USD' }] as never;
    expect(selectCollectedTotals(facts, '2026-03', '2026-04')).toEqual(selectCollectedTotals(full, '2026-03', '2026-04'));
    expect(selectCollectedTotals(facts, '2026-03', '2026-04')).toEqual({ totals: [{ currency: 'USD', amount: '300.30' }], unknownCurrencies: ['IDR'] });
  });
});

describe('empty-state existence probes (issue 1973)', () => {
  it('are one narrow read each: id only, one row, NO status filter — any-status evidence', async () => {
    tableRows.sales_invoices = [{ id: 'a' }];
    tableRows.incoming_payments = [];
    await expect(hasAnySalesInvoice()).resolves.toBe(true);
    await expect(hasAnyIncomingPayment()).resolves.toBe(false);
    expect(calls.map((call) => call.table)).toEqual(['sales_invoices', 'incoming_payments']);
    for (const call of calls) {
      expect(call.select).toBe('id');
      expect(call.ops.join(' ')).not.toMatch(/status|paired_erp/);
    }
  });
});

describe('monthly billed work facts', () => {
  it('reads the billed-work view with a six-month date bound and invoice status filters', async () => {
    tableRows.sales_invoice_work_billed = [{ id: 'a', invoice_date: '2026-05-01', currency: 'USD', net: 90, recovery: 10 }];
    expect(await listMonthlyInvoiceFacts('2026-05-01', '2026-11-01')).toEqual(tableRows.sales_invoice_work_billed);
    expect(calls[0]).toMatchObject({ table: 'sales_invoice_work_billed', select: 'id,invoice_date,currency,net,recovery' });
    expect(calls[0].ops).toEqual(expect.arrayContaining(['gte:invoice_date,2026-05-01', 'lt:invoice_date,2026-11-01', 'eq:is_down_payment,false', 'in:status,Submitted,Unpaid,Paid']));
  });
});
