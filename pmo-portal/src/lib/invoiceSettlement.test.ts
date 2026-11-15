import { describe, expect, it } from 'vitest';
import type { InvoiceFinanceBucket } from './projectFinances';
import {
  outstandingIn, settlementFromFinanceBuckets, settlementIn, sumOutstanding, summarizeInvoiceSettlement, type SettlementInvoice,
} from './invoiceSettlement';

const inv = (over: Partial<SettlementInvoice> = {}): SettlementInvoice => ({
  status: 'Unpaid', currency: 'IDR', tax_treatment: 'inclusive', amount: 1_000, tax_amount: 0, erp_outstanding_amount: 0, ...over,
});

const bucket = (over: Partial<InvoiceFinanceBucket> = {}): InvoiceFinanceBucket => ({
  currency: 'IDR', invoice_count: 1, invoiced: '1000.00', settled: '1000.00', outstanding: '0.00',
  missing_amount: 0, missing_outstanding: 0, tax_basis: 'inclusive', work_revenue: '1000.00', missing_work: 0, ...over,
});

describe('invoice settlement rule (docs/specs/invoice-settlement.spec.md)', () => {
  it('AC-SET-001 never adds two submitted invoice currencies into one amount', () => {
    const result = summarizeInvoiceSettlement([
      inv({ currency: 'IDR', amount: 1_000, erp_outstanding_amount: 400 }),
      inv({ currency: 'USD', amount: 50, erp_outstanding_amount: 0 }),
    ]);
    expect(result).toEqual({ denomination: 'mixed', currencies: ['IDR', 'USD'] });
    expect(settlementIn(result, 'IDR')).toBeNull();
    expect(settlementIn(result, 'USD')).toBeNull();
  });

  it('#2204 an invoice with no currency makes the result mixed, never the caller currency', () => {
    const result = summarizeInvoiceSettlement([inv({ currency: 'IDR' }), inv({ currency: null })]);
    expect(result.denomination).toBe('mixed');
    expect(settlementIn(result, 'IDR')).toBeNull();
  });

  it('#2204 a single foreign-currency result is never relabelled as the caller currency', () => {
    const result = summarizeInvoiceSettlement([inv({ currency: 'USD', amount: 50, erp_outstanding_amount: 10 })]);
    expect(settlementIn(result, 'IDR')).toBeNull();
    expect(settlementIn(result, 'USD')).toMatchObject({ currency: 'USD', gross: 50, settled: 40, outstanding: 10, balancesKnown: true });
  });

  it('AC-SET-002 tax-exclusive and tax-inclusive invoices settle on one gross basis, paid + unpaid = invoiced', () => {
    const result = summarizeInvoiceSettlement([
      inv({ tax_treatment: 'exclusive', amount: 1_000, tax_amount: 110, erp_outstanding_amount: 1_110 }),
      inv({ tax_treatment: 'inclusive', amount: 1_110, tax_amount: 110, erp_outstanding_amount: 0, status: 'Paid' }),
    ]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ currency: 'IDR', gross: 2_220, outstanding: 1_110, settled: 1_110, balancesKnown: true });
  });

  it('AC-SET-005 a fully paid tax-exclusive invoice never reads paid above what it invoiced', () => {
    const figures = settlementIn(summarizeInvoiceSettlement([
      inv({ status: 'Paid', tax_treatment: 'exclusive', amount: 1_000_000, tax_amount: 110_000, erp_outstanding_amount: 0 }),
    ]), 'IDR')!;
    expect(figures).toMatchObject({ currency: 'IDR', gross: 1_110_000, settled: 1_110_000, outstanding: 0, balancesKnown: true });
    expect(figures.settled! + figures.outstanding!).toBe(figures.gross);
  });

  it('#2204 an unpaid tax-exclusive invoice reads as nothing settled, not a negative', () => {
    const result = summarizeInvoiceSettlement([
      inv({ tax_treatment: 'exclusive', amount: 1_000, tax_amount: 110, erp_outstanding_amount: 1_110 }),
    ]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ settled: 0, outstanding: 1_110, gross: 1_110 });
  });

  it('#2204 a tax-exclusive invoice without a stated tax, or an unknown tax treatment, leaves gross and settled unknown', () => {
    expect(settlementIn(summarizeInvoiceSettlement([inv({ tax_treatment: 'exclusive', tax_amount: null })]), 'IDR'))
      .toMatchObject({ gross: null, settled: null, outstanding: 0 });
    expect(settlementIn(summarizeInvoiceSettlement([inv({ tax_treatment: null })]), 'IDR'))
      .toMatchObject({ gross: null, settled: null, outstanding: 0 });
  });

  it('#2204 the document total stays its own figure beside gross: a tax-exclusive invoice states 1,000 as stated and 1,110 gross', () => {
    const result = summarizeInvoiceSettlement([inv({ amount: 1_000, tax_treatment: 'exclusive', tax_amount: 110, erp_outstanding_amount: 1_110 })]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ documentTotal: 1_000, gross: 1_110 });
  });

  it('AC-SET-003 drafts, cancelled and accounting-cancelled invoices are excluded entirely', () => {
    const result = summarizeInvoiceSettlement([
      inv({ amount: 1_000, erp_outstanding_amount: 250 }),
      inv({ status: 'Draft', currency: 'USD', amount: 9, erp_outstanding_amount: null }),
      inv({ status: 'Cancelled', currency: 'USD', amount: 9, erp_outstanding_amount: 0 }),
      inv({ status: 'Unpaid', currency: 'USD', amount: 9, erp_docstatus: 2 }),
      inv({ status: 'Paid', currency: 'USD', amount: 9, erp_cancelled_at: '2026-11-01T00:00:00Z' }),
    ]);
    expect(result).toMatchObject({ denomination: 'single', currency: 'IDR', gross: 1_000, outstanding: 250, settled: 750, balancesKnown: true });
  });

  it('AC-1402 AC-SET-004 an unknown balance leaves settled and outstanding unknown, never partial or zero', () => {
    const result = summarizeInvoiceSettlement([
      inv({ amount: 10_000.01, erp_outstanding_amount: 4_000.01 }),
      inv({ status: 'Paid', amount: 2_000, erp_outstanding_amount: 0 }),
      inv({ amount: 5_000, erp_outstanding_amount: null }),
      inv({ status: 'Draft', amount: 500, erp_outstanding_amount: null }),
      inv({ status: 'Cancelled', amount: 900, erp_outstanding_amount: 0 }),
    ]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ currency: 'IDR', gross: 17_000.01, outstanding: null, settled: null, balancesKnown: false });
  });

  it('AC-1402 adds partial payments to the cent only when every invoice balance is known', () => {
    const result = summarizeInvoiceSettlement([
      inv({ amount: 10_000.01, erp_outstanding_amount: 4_000.01 }),
      inv({ status: 'Paid', amount: 2_000, erp_outstanding_amount: 0 }),
    ]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ gross: 12_000.01, settled: 8_000, outstanding: 4_000.01, balancesKnown: true });
  });

  it('no counted invoice reads as zero settlement in whichever currency is asked', () => {
    const result = summarizeInvoiceSettlement([inv({ status: 'Draft', currency: 'USD' })]);
    expect(result).toEqual({ denomination: 'none' });
    expect(settlementIn(result, 'IDR')).toMatchObject({ currency: 'IDR', gross: 0, outstanding: 0, settled: 0, balancesKnown: true });
  });
});

describe('project settlement from the server finance projection (get_project_finances buckets)', () => {
  it('#2204 more than one currency bucket is mixed and carries no amount', () => {
    const result = settlementFromFinanceBuckets([bucket(), bucket({ currency: 'USD' })]);
    expect(result).toEqual({ denomination: 'mixed', currencies: ['IDR', 'USD'] });
  });

  it('#2204 a tax-exclusive bucket reads invoiced on the gross basis: settled + outstanding', () => {
    const result = settlementFromFinanceBuckets([bucket({ tax_basis: 'exclusive', invoiced: '1000000.00', settled: '1110000.00', outstanding: '0.00' })]);
    expect(settlementIn(result!, 'IDR')).toMatchObject({ currency: 'IDR', gross: 1_110_000, settled: 1_110_000, outstanding: 0, balancesKnown: true });
  });

  it('#2204 an unknown server balance leaves settled and outstanding unknown; an inclusive bucket still states gross', () => {
    expect(settlementIn(settlementFromFinanceBuckets([bucket({ settled: null, outstanding: null, missing_outstanding: 1 })])!, 'IDR'))
      .toMatchObject({ currency: 'IDR', gross: 1_000, settled: null, outstanding: null, balancesKnown: false });
    expect(settlementIn(settlementFromFinanceBuckets([bucket({ tax_basis: 'exclusive', settled: null, outstanding: null, missing_outstanding: 1 })])!, 'IDR'))
      .toMatchObject({ gross: null, balancesKnown: false });
  });

  it('no bucket is no counted invoice; a missing reading is unknown', () => {
    expect(settlementFromFinanceBuckets([])).toEqual({ denomination: 'none' });
    expect(settlementFromFinanceBuckets(undefined)).toBeNull();
  });
});

describe('outstanding balances by currency (overdue)', () => {
  it('AC-SET-006 never adds overdue balances in two currencies', () => {
    const result = sumOutstanding([inv({ currency: 'IDR', erp_outstanding_amount: 300 }), inv({ currency: 'USD', erp_outstanding_amount: 20 })]);
    expect(result).toEqual({ denomination: 'mixed', currencies: ['IDR', 'USD'] });
    expect(outstandingIn(result, 'IDR')).toBeNull();
  });

  it('#2204 sums positive known balances within one currency', () => {
    const result = sumOutstanding([
      inv({ erp_outstanding_amount: 300.1 }), inv({ erp_outstanding_amount: 0.2 }),
      inv({ erp_outstanding_amount: -50 }), inv({ erp_outstanding_amount: null }),
    ]);
    expect(outstandingIn(result, 'IDR')).toBe(300.3);
    expect(outstandingIn(result, 'USD')).toBeNull();
    expect(outstandingIn(sumOutstanding([]), 'USD')).toBe(0);
  });
});
