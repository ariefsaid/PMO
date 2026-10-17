import { describe, expect, it } from 'vitest';
import { peReceiveToBody, peReceiveFromDoc } from './incomingPayment';
import type { ErpCtx } from '../doctypeRegistry';

const ctx: ErpCtx = { refs: { customer: 'Demo Customer' }, config: {
  default_receivable_account: 'Debtors - DEMO', default_cash_account: 'Cash - DEMO',
  tax_prepaid_account: 'Tax Prepaid - DEMO', cost_center: 'Main - DEMO',
  paid_from_account_currency: 'IDR', paid_to_account_currency: 'IDR',
} };
const receipt = { id: 'receipt', paid_amount: '1000.00', received_amount: '980.00',
  withheld_amount: '20.00', withholding_slip_number: 'WHT-001',
  references: [{ reference_doctype: 'Sales Invoice', reference_name: 'SI-001', allocated_amount: '1000.00' }],
};

describe('inbound receipt allocations (S-06, RF-030)', () => {
  it('RF-030 preserves multiple invoice allocations and their settled amounts from the ERP receipt', () => {
    const mapped = peReceiveFromDoc({ name: 'PE-ALLOC-1', paid_amount: '75.00', received_amount: '75.00', references: [
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-A', allocated_amount: '25.00' },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-B', allocated_amount: '50.00' },
    ] });
    expect(mapped.allocations).toEqual([
      { reference_name: 'SI-A', allocated_amount: '25.00' },
      { reference_name: 'SI-B', allocated_amount: '50.00' },
    ]);
  });

  it('RF-030 an allocation the ERP did not price stays unknown — it never reads as zero', () => {
    const mapped = peReceiveFromDoc({ name: 'PE-ALLOC-2', paid_amount: '75.00', references: [
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-A', allocated_amount: '25.00' },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-B', allocated_amount: null },
    ] });
    expect(mapped.allocations).toEqual([
      { reference_name: 'SI-A', allocated_amount: '25.00' },
      { reference_name: 'SI-B', allocated_amount: null },
    ]);
  });

  it('RF-030 a Sales Order advance is not an invoice allocation — only Sales Invoice rows are kept', () => {
    const mapped = peReceiveFromDoc({ name: 'PE-ALLOC-3', paid_amount: '75.00', references: [
      { reference_doctype: 'Sales Order', reference_name: 'SO-1', allocated_amount: '25.00' },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-A', allocated_amount: '50.00' },
    ] });
    expect(mapped.allocations).toEqual([{ reference_name: 'SI-A', allocated_amount: '50.00' }]);
  });

  it('RF-030 no references key means coverage unknown (undefined); an empty array is known on-account', () => {
    expect(peReceiveFromDoc({ name: 'PE-ALLOC-4', paid_amount: '75.00' }).allocations).toBeUndefined();
    expect(peReceiveFromDoc({ name: 'PE-ALLOC-5', paid_amount: '75.00', references: [] }).allocations).toEqual([]);
  });

  it('RF-030 allocation amounts map through the same money shape as the header (exact 2dp or unknown)', () => {
    const mapped = peReceiveFromDoc({ name: 'PE-ALLOC-6', paid_amount: '75.00', references: [
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-A', allocated_amount: 25000.5 },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-B', allocated_amount: 'oops' },
    ] });
    expect(mapped.allocations).toEqual([
      { reference_name: 'SI-A', allocated_amount: '25000.50' },
      { reference_name: 'SI-B', allocated_amount: null },
    ]);
  });

  it('RF-030 rows without a usable reference name are skipped, not stored as blank invoices', () => {
    const mapped = peReceiveFromDoc({ name: 'PE-ALLOC-7', paid_amount: '75.00', references: [
      { reference_doctype: 'Sales Invoice', reference_name: null, allocated_amount: '25.00' },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-A', allocated_amount: '50.00' },
    ] });
    expect(mapped.allocations).toEqual([{ reference_name: 'SI-A', allocated_amount: '50.00' }]);
  });
});

describe('client withholding on a Receive Payment Entry', () => {
  it('AC-WHT-002: sends ERPNext cash in both header amounts, allocates the gross and deducts the tax (DD-RCPT-1)', () => {
    expect(peReceiveToBody(receipt, ctx)).toEqual({
      payment_type: 'Receive', party_type: 'Customer', party: 'Demo Customer',
      paid_amount: '980.00', received_amount: '980.00',
      paid_from: 'Debtors - DEMO', paid_to: 'Cash - DEMO', references: receipt.references,
      deductions: [{ account: 'Tax Prepaid - DEMO', cost_center: 'Main - DEMO',
        amount: '20.00', description: 'Withholding slip: WHT-001' }],
    });
  });

  it('AC-WHT-004: refuses positive withholding when the tax-prepaid account setting is missing', () => {
    expect(() => peReceiveToBody(receipt, { ...ctx, config: { ...ctx.config, tax_prepaid_account: null } }))
      .toThrow(/Tax-prepaid account.*Administration/i);
  });

  it('AC-WHT-004: refuses positive withholding when the ERP company has no default cost center', () => {
    expect(() => peReceiveToBody(receipt, { ...ctx, config: { ...ctx.config, cost_center: null } }))
      .toThrow(/Company.*cost center/i);
  });

  it('AC-WHT-004: refuses withholding when the receivable and cash accounts differ in currency, or their currency is unknown', () => {
    for (const currencies of [{ paid_to_account_currency: 'USD' }, { paid_from_account_currency: null },
      { paid_from_account_currency: null, paid_to_account_currency: null }]) {
      expect(() => peReceiveToBody(receipt, { ...ctx, config: { ...ctx.config, ...currencies } }))
        .toThrow(/same currency/i);
    }
  });

  it('AC-WHT-004: a cross-currency receipt without withholding needs no account currencies', () => {
    expect(() => peReceiveToBody({ ...receipt, received_amount: '15.50', withheld_amount: 0, withholding_slip_number: null },
      { ...ctx, config: { ...ctx.config, paid_from_account_currency: 'IDR', paid_to_account_currency: 'USD' } })).not.toThrow();
  });

  it('AC-WHT-004: a zero-withholding receipt keeps the existing cash-only body without needing a tax account', () => {
    expect(peReceiveToBody({ ...receipt, received_amount: '1000.00', withheld_amount: 0,
      withholding_slip_number: null }, { ...ctx, config: { ...ctx.config, tax_prepaid_account: null, cost_center: null } }))
      .not.toHaveProperty('deductions');
  });

  it('AC-WHT-004: without withholding the header keeps the PMO paid amount, even when received differs (cross-currency)', () => {
    expect(peReceiveToBody({ ...receipt, received_amount: '15.50', withheld_amount: 0, withholding_slip_number: null }, ctx))
      .toMatchObject({ paid_amount: '1000.00', received_amount: '15.50' });
  });

  it('AC-WHT-001: refuses a withholding receipt that does not balance cash plus tax to its allocation', () => {
    expect(() => peReceiveToBody({ ...receipt, received_amount: '979.99' }, ctx)).toThrow(/cash.*withheld.*allocated/i);
    expect(() => peReceiveToBody({ ...receipt, withholding_slip_number: '   ' }, ctx)).toThrow(/withholding-slip number/i);
  });

  it.each([-1, '20.001', 'NaN', Infinity])('AC-WHT-001: refuses malformed withheld amount %s', (amount) => {
    expect(() => peReceiveToBody({ ...receipt, withheld_amount: amount }, ctx)).toThrow();
  });

  it('AC-WHT-003: full ERP read-back (cash 980/980 + marked 20 deduction) restores the gross 1000 without replacing the anchor', () => {
    // ERPNext's real same-currency shape (DD-RCPT-1): received_amount is forced to paid_amount = cash.
    const canonical = peReceiveFromDoc({ name: 'PE-001', paid_amount: 980, received_amount: 980,
      reference_no: 'PMO-ANCHOR', deductions: [{ account: 'Tax Prepaid - DEMO', cost_center: 'Main - DEMO',
        amount: '20.00', description: 'Withholding slip: WHT-001' }], references: receipt.references });
    expect(canonical).toMatchObject({ amount: '1000.00', received_amount: '980.00',
      withheld_amount: '20.00', withholding_slip_number: 'WHT-001', reference_number: 'PMO-ANCHOR' });
  });

  it('AC-WHT-003: partial lifecycle payloads never clear previously recorded tax facts', () => {
    const canonical = peReceiveFromDoc({ name: 'PE-001', docstatus: 1 });
    expect(canonical).not.toHaveProperty('withheld_amount');
    expect(canonical).not.toHaveProperty('withholding_slip_number');
    expect(canonical).not.toHaveProperty('received_amount');
  });

  it('AC-WHT-003: unrelated ERP deductions are not inferred to be income tax withholding', () => {
    const canonical = peReceiveFromDoc({ name: 'PE-001', paid_amount: '980.00', received_amount: '980.00', deductions: [
      { account: 'Discounts - DEMO', amount: '20.00', description: 'Early payment discount' },
    ] });
    expect(canonical.withheld_amount).toBeNull();
    expect(canonical.withholding_slip_number).toBeNull();
    expect(canonical.amount).toBe('980.00');
  });

  it('AC-WHT-003: zero, amountless or absent withholding rows leave the header amount unchanged', () => {
    const marked = (amount: unknown) => peReceiveFromDoc({ name: 'PE-001', paid_amount: '980.00',
      received_amount: '980.00', deductions: [{ amount, description: 'Withholding slip: WHT-001' }] });
    expect(marked(0).amount).toBe('980.00');
    expect(marked(null).amount).toBe('980.00');
    expect(peReceiveFromDoc({ name: 'PE-001', paid_amount: '980.00', deductions: [] }).amount).toBe('980.00');
    expect(peReceiveFromDoc({ name: 'PE-001', paid_amount: '980.00' }).amount).toBe('980.00');
  });

  it('AC-WHT-003: a header without paid_amount stays unknown even with a marked deduction', () => {
    expect(peReceiveFromDoc({ name: 'PE-001', deductions: [{ amount: '20.00',
      description: 'Withholding slip: WHT-001' }] }).amount).toBeNull();
  });

  it('AC-WHT-003: the derived gross is exact to the cent', () => {
    expect(peReceiveFromDoc({ name: 'PE-001', paid_amount: 0.1, received_amount: 0.1,
      deductions: [{ amount: 0.2, description: 'Withholding slip: WHT-001' }] }).amount).toBe('0.30');
  });

  const marked = (amount: unknown, slip = 'WHT-001') => ({ amount, description: `Withholding slip: ${slip}` });

  it('AC-WHT-003: two marked withholding deductions map as unknown tax with the header kept, and ask for review instead of failing', () => {
    const doc = { name: 'PE-002', paid_amount: '980.00', received_amount: '980.00',
      deductions: [marked('10.00', 'WHT-A'), marked('10.00', 'WHT-B')] };
    expect(() => peReceiveFromDoc(doc)).not.toThrow();
    expect(peReceiveFromDoc(doc)).toMatchObject({ amount: '980.00', received_amount: '980.00',
      withheld_amount: null, withholding_slip_number: null, withholding_review: 'multiple-withholding-deductions' });
  });

  it('AC-WHT-003: a marked deduction counts only when the header states the same cash twice', () => {
    const differing = peReceiveFromDoc({ name: 'PE-003', paid_amount: '1000.00', received_amount: '15.50',
      deductions: [marked('20.00')] });
    expect(differing).toMatchObject({ amount: '1000.00', withheld_amount: null, withholding_slip_number: null,
      withholding_review: 'header-amounts-differ' });
    const unstated = peReceiveFromDoc({ name: 'PE-004', paid_amount: '980.00', deductions: [marked('20.00')] });
    expect(unstated).toMatchObject({ amount: '980.00', withheld_amount: null, withholding_slip_number: null });
    expect(unstated).not.toHaveProperty('withholding_review');
  });

  it('AC-WHT-003: a confirmed withholding row the receipt cannot hold maps as unknown and asks for review', () => {
    for (const row of [marked('-5.00'), marked('abc'), marked('20.00', '   '), marked('20.00', 'x'.repeat(141))]) {
      const canonical = peReceiveFromDoc({ name: 'PE-005', paid_amount: '980.00', received_amount: '980.00', deductions: [row] });
      expect(canonical).toMatchObject({ amount: '980.00', withheld_amount: null, withholding_slip_number: null,
        withholding_review: 'unreadable-withholding' });
    }
  });

  it('AC-WHT-003: a confirmed single withholding carries no review marker', () => {
    expect(peReceiveFromDoc({ name: 'PE-006', paid_amount: '980.00', received_amount: '980.00',
      deductions: [marked('20.00')] })).not.toHaveProperty('withholding_review');
  });
});
