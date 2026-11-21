import { describe, expect, it } from 'vitest';
import { suggestSupplyRisk, type SupplyRiskCase } from '../supplyRisk';

// Organisation today 2026-11-20. Ages: 111 / 56 / 70 / 71 days (the hand example in vendor-supply-risk.spec.md).
const TODAY = '2026-11-20';
const day = (age: number) => {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - age * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const pmoCase = (over: Partial<SupplyRiskCase> & Pick<SupplyRiskCase, 'invoices'>): SupplyRiskCase => ({
  status: 'Vendor Invoiced',
  currency: 'IDR',
  payments: [],
  erpDocuments: [],
  ...over,
});

const case1 = pmoCase({ invoices: [{ amount: 1_000_000, invoice_date: day(111) }] });
const case2 = pmoCase({ invoices: [{ amount: 2_000_000, invoice_date: day(56) }] });
const case3 = pmoCase({
  invoices: [{ amount: 1_000_000, invoice_date: day(70) }],
  payments: [{ amount: 400_000, status: 'Paid' }],
});
const case4 = pmoCase({
  invoices: [{ amount: 500_000, invoice_date: day(71) }],
  payments: [{ amount: 500_000, status: 'Paid' }],
});

describe('suggestSupplyRisk (PMO basis mirror of vendor_supply_risk_suggestion)', () => {
  it('AC-VSR-001 the hand example suggests at_risk with the figures the database function returns', () => {
    const r = suggestSupplyRisk([case1, case2, case3, case4], TODAY);
    expect(r.basis).toBe('pmo');
    expect(r.suggestedStatus).toBe('at_risk');
    expect(r.oldestAgeDays).toBe(111);
    expect(r.currencies).toEqual([
      { currency: 'IDR', unpaidAmount: 3_600_000, over60Amount: 1_600_000, invoiceCount: 2, oldestAgeDays: 111 },
    ]);
    expect(r.unknownCount).toBe(0);
  });

  it('AC-VSR-017 a partly paid case nets its Paid payment at case level; Scheduled does not reduce it; fully paid drops out', () => {
    expect(suggestSupplyRisk([case3], TODAY).currencies[0]).toMatchObject({ over60Amount: 600_000, oldestAgeDays: 70 });
    const scheduled = { ...case3, payments: [{ amount: 400_000, status: 'Scheduled' }] };
    expect(suggestSupplyRisk([scheduled], TODAY).currencies[0].over60Amount).toBe(1_000_000);
    const settled = { ...case3, payments: [{ amount: 1_000_000, status: 'Paid' }] };
    const r = suggestSupplyRisk([settled, case2], TODAY);
    expect(r.suggestedStatus).toBe('active');
    expect(r.currencies[0]).toMatchObject({ unpaidAmount: 2_000_000, over60Amount: 0 });
  });

  it('AC-VSR-002 a Paid or Cancelled case is not counted', () => {
    const paid = { ...case1, status: 'Paid' };
    const cancelled = { ...case1, status: 'Cancelled' };
    expect(suggestSupplyRisk([paid, cancelled], TODAY)).toMatchObject({ suggestedStatus: 'active', currencies: [] });
  });

  it('AC-VSR-003 an old invoice with no amount is unknown, never zero, and does not raise the suggestion', () => {
    const unknown = pmoCase({ invoices: [{ amount: null, invoice_date: day(120) }] });
    const r = suggestSupplyRisk([unknown], TODAY);
    expect(r.unknownCount).toBe(1);
    expect(r.suggestedStatus).toBe('active');
    expect(r.currencies).toEqual([]);
  });

  it('AC-VSR-005 currencies are reported separately and never summed', () => {
    const usd = pmoCase({ currency: 'USD', invoices: [{ amount: 100, invoice_date: day(80) }] });
    const r = suggestSupplyRisk([case1, usd], TODAY);
    expect(r.currencies.map((c) => [c.currency, c.over60Amount])).toEqual([['IDR', 1_000_000], ['USD', 100]]);
  });

  it('AC-VSR-018 a case with no PMO bill takes its linked ERP invoice outstanding; a linked ERP payment nets a PMO bill', () => {
    const erpOnly = pmoCase({
      invoices: [],
      erpDocuments: [{ doctype: 'Purchase Invoice', grand_total: 900, outstanding_amount: 500 }],
    });
    expect(suggestSupplyRisk([erpOnly], TODAY).currencies[0].unpaidAmount).toBe(500);
    const withErpPayment = pmoCase({
      currency: 'USD',
      invoices: [{ amount: 1000, invoice_date: day(10) }],
      erpDocuments: [{ doctype: 'Payment Entry', grand_total: 400, outstanding_amount: 0 }],
    });
    expect(suggestSupplyRisk([withErpPayment], TODAY).currencies[0].unpaidAmount).toBe(600);
  });

  it('uses exact decimals', () => {
    const c = pmoCase({ invoices: [{ amount: '0.10', invoice_date: day(90) }, { amount: '0.20', invoice_date: day(80) }] });
    expect(suggestSupplyRisk([c], TODAY).currencies[0].over60Amount).toBe(0.3);
  });
});
