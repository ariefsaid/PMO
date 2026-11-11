import { describe, expect, it } from 'vitest';
import { readBackBill, type BillRead } from './billReadBack.ts';

const MOVE = { name: 'BILL/2026/00001', state: 'posted', amount_total: 109, amount_residual: 109, ref: 'INV-77', invoice_date: '2026-12-05', currency_id: [12, 'IDR'], write_date: '2026-01-01 00:00:10' };
const READ: BillRead = {
  move: MOVE,
  taxLines: [{ balance: 11 }, { balance: -2 }],
  productLines: [{ analytic_distribution: { '101': 100 } }, { analytic_distribution: { '101': 100 } }],
};
const EXPECT = { total: '109.00', costAccountId: '101' };
const PMO_ID = '55555555-5555-4555-8555-555555555555';
const money = (c: Record<string, unknown>) => [c.amount, c.tax_amount, c.withheld_amount, c.erp_outstanding_amount];

describe('AC-OPP-043 the money header written to PMO\'s existing columns (ADR-0082 shape)', () => {
  it('a whole header: gross, VAT, withheld, outstanding; the bill identity beside them', () => {
    const c = readBackBill(PMO_ID, READ, EXPECT);
    expect(money(c)).toEqual(['111.00', '11.00', '2.00', '109.00']);
    expect(c).toMatchObject({ id: PMO_ID, vi_number: 'BILL/2026/00001', reference_number: 'INV-77', invoice_date: '2026-12-05', currency: 'IDR', erp_docstatus: 1, erp_modified: MOVE.write_date, erp_amended_from: null, pmo_amount: '109.00' });
    expect(c).not.toHaveProperty('odoo_outcome');
  });

  it('a payload missing the residual writes none of the money and flags the bill', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, amount_residual: undefined } }, EXPECT);
    for (const key of ['amount', 'tax_amount', 'withheld_amount', 'erp_outstanding_amount']) expect(c).not.toHaveProperty(key);
    expect(c).toMatchObject({ odoo_outcome: 'needs-attention', odoo_attention: ['money-unreadable'] });
  });

  it('a bill with no withholding lines states withheld 0.00 (stated, not defaulted)', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, amount_total: 111, amount_residual: 111 }, taxLines: [{ balance: 11 }] }, { ...EXPECT, total: '111.00' });
    expect(money(c)).toEqual(['111.00', '11.00', '0.00', '111.00']);
  });

  it('a read-back the 0196 constraint would refuse (withheld above gross, negative gross) writes none of the money and flags the bill', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, amount_total: -5, amount_residual: -5 }, taxLines: [] }, { ...EXPECT, total: '-5.00' });
    expect(c).not.toHaveProperty('amount');
    expect(c).toMatchObject({ odoo_attention: ['money-unreadable'] });
  });

  it('only a posted bill is docstatus 1; a draft is 0 and a cancelled one 2', () => {
    expect(readBackBill(PMO_ID, { ...READ, move: { ...MOVE, state: 'draft' } }, EXPECT).erp_docstatus).toBe(0);
    expect(readBackBill(PMO_ID, { ...READ, move: { ...MOVE, state: 'cancel' } }, EXPECT).erp_docstatus).toBe(2);
  });
});

describe('AC-OPP-044 the read-back total against the figure PMO sent', () => {
  it('within a rounding unit it is accepted', () => {
    expect(readBackBill(PMO_ID, { ...READ, move: { ...MOVE, amount_total: 109.01 } }, EXPECT)).not.toHaveProperty('odoo_outcome');
  });
  it('more than a unit apart: needs attention, and Odoo\'s own money is still what is mirrored (never overwritten with PMO\'s)', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, amount_total: 110, amount_residual: 110 } }, EXPECT);
    expect(c).toMatchObject({ odoo_outcome: 'needs-attention', odoo_attention: ['total-mismatch'], pmo_amount: '109.00' });
    expect(money(c)).toEqual(['112.00', '11.00', '2.00', '110.00']);
  });
});

describe('AC-OPP-020 every posted line carries the project\'s cost account', () => {
  it('a line without it flags "cost account missing"', () => {
    const c = readBackBill(PMO_ID, { ...READ, productLines: [{ analytic_distribution: { '101': 100 } }, { analytic_distribution: false }] }, EXPECT);
    expect(c).toMatchObject({ odoo_outcome: 'needs-attention', odoo_attention: ['cost-account-missing'] });
  });
  it('another account, or a share below 100, is missing too', () => {
    expect(readBackBill(PMO_ID, { ...READ, productLines: [{ analytic_distribution: { '102': 100 } }] }, EXPECT)).toMatchObject({ odoo_attention: ['cost-account-missing'] });
    expect(readBackBill(PMO_ID, { ...READ, productLines: [{ analytic_distribution: { '101': 60, '102': 40 } }] }, EXPECT)).toMatchObject({ odoo_attention: ['cost-account-missing'] });
  });
  it('a case with no project has no cost account to check', () => {
    expect(readBackBill(PMO_ID, { ...READ, productLines: [{ analytic_distribution: false }] }, { ...EXPECT, costAccountId: null })).not.toHaveProperty('odoo_outcome');
  });
  it('both problems are reported, in order', () => {
    const c = readBackBill(PMO_ID, { ...READ, move: { ...MOVE, amount_total: 120 }, productLines: [{ analytic_distribution: false }] }, EXPECT);
    expect(c.odoo_attention).toEqual(['total-mismatch', 'cost-account-missing']);
  });
});
