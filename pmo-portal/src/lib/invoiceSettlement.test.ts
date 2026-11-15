import { describe, expect, it } from 'vitest';
import { settlementIn, summarizeInvoiceSettlement, type SettlementInvoice } from './invoiceSettlement';

const inv = (over: Partial<SettlementInvoice> = {}): SettlementInvoice => ({
  status: 'Unpaid', currency: 'IDR', tax_treatment: 'inclusive', amount: 1_000, tax_amount: 0, erp_outstanding_amount: 0, ...over,
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

  it('AC-SET-001 an invoice with no currency makes the result mixed, never the caller currency', () => {
    const result = summarizeInvoiceSettlement([inv({ currency: 'IDR' }), inv({ currency: null })]);
    expect(result.denomination).toBe('mixed');
    expect(settlementIn(result, 'IDR')).toBeNull();
  });

  it('AC-SET-001 a single foreign-currency result is never relabelled as the caller currency', () => {
    const result = summarizeInvoiceSettlement([inv({ currency: 'USD', amount: 50, erp_outstanding_amount: 10 })]);
    expect(settlementIn(result, 'IDR')).toBeNull();
    expect(settlementIn(result, 'USD')).toMatchObject({ currency: 'USD', settled: 40, outstanding: 10 });
  });

  it('AC-SET-002 tax-exclusive and tax-inclusive invoices settle on one gross basis', () => {
    const result = summarizeInvoiceSettlement([
      inv({ tax_treatment: 'exclusive', amount: 1_000, tax_amount: 110, erp_outstanding_amount: 1_110 }),
      inv({ tax_treatment: 'inclusive', amount: 1_110, tax_amount: 110, erp_outstanding_amount: 0, status: 'Paid' }),
    ]);
    expect(settlementIn(result, 'IDR')).toEqual({
      currency: 'IDR', documentTotal: 2_110, documentBasis: 'mixed',
      gross: 2_220, outstanding: 1_110, settled: 1_110, balancesKnown: true,
    });
  });

  it('AC-SET-002 an unpaid tax-exclusive invoice reads as nothing settled, not a negative', () => {
    const result = summarizeInvoiceSettlement([
      inv({ tax_treatment: 'exclusive', amount: 1_000, tax_amount: 110, erp_outstanding_amount: 1_110 }),
    ]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ settled: 0, outstanding: 1_110, documentBasis: 'exclusive' });
  });

  it('AC-SET-002 a tax-exclusive invoice without a stated tax leaves gross and settled unknown', () => {
    const result = summarizeInvoiceSettlement([inv({ tax_treatment: 'exclusive', tax_amount: null, erp_outstanding_amount: 0 })]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ gross: null, settled: null, outstanding: 0 });
  });

  it('AC-SET-003 drafts, cancelled and accounting-cancelled invoices are excluded entirely', () => {
    const result = summarizeInvoiceSettlement([
      inv({ amount: 1_000, erp_outstanding_amount: 250 }),
      inv({ status: 'Draft', currency: 'USD', amount: 9, erp_outstanding_amount: null }),
      inv({ status: 'Cancelled', currency: 'USD', amount: 9, erp_outstanding_amount: 0 }),
      inv({ status: 'Unpaid', currency: 'USD', amount: 9, erp_docstatus: 2 }),
      inv({ status: 'Paid', currency: 'USD', amount: 9, erp_cancelled_at: '2026-11-01T00:00:00Z' }),
    ]);
    expect(result).toEqual({
      denomination: 'single', currency: 'IDR', documentTotal: 1_000, documentBasis: 'inclusive',
      gross: 1_000, outstanding: 250, settled: 750, balancesKnown: true,
    });
  });

  it('AC-1402 AC-SET-004 an unknown balance leaves settled and outstanding unknown, never partial or zero', () => {
    const result = summarizeInvoiceSettlement([
      inv({ amount: 10_000.01, erp_outstanding_amount: 4_000.01 }),
      inv({ status: 'Paid', amount: 2_000, erp_outstanding_amount: 0 }),
      inv({ amount: 5_000, erp_outstanding_amount: null }),
      inv({ status: 'Draft', amount: 500, erp_outstanding_amount: null }),
      inv({ status: 'Cancelled', amount: 900, erp_outstanding_amount: 0 }),
    ]);
    expect(settlementIn(result, 'IDR')).toEqual({
      currency: 'IDR', documentTotal: 17_000.01, documentBasis: 'inclusive',
      gross: 17_000.01, outstanding: null, settled: null, balancesKnown: false,
    });
  });

  it('AC-1402 adds partial payments to the cent only when every invoice balance is known', () => {
    const result = summarizeInvoiceSettlement([
      inv({ amount: 10_000.01, erp_outstanding_amount: 4_000.01 }),
      inv({ status: 'Paid', amount: 2_000, erp_outstanding_amount: 0 }),
    ]);
    expect(settlementIn(result, 'IDR')).toMatchObject({ documentTotal: 12_000.01, settled: 8_000, outstanding: 4_000.01, balancesKnown: true });
  });

  it('no counted invoice reads as zero settlement in whichever currency is asked', () => {
    const result = summarizeInvoiceSettlement([inv({ status: 'Draft', currency: 'USD' })]);
    expect(result).toEqual({ denomination: 'none' });
    expect(settlementIn(result, 'IDR')).toEqual({
      currency: 'IDR', documentTotal: 0, documentBasis: null, gross: 0, outstanding: 0, settled: 0, balancesKnown: true,
    });
  });
});
