import { describe, expect, it } from 'vitest';
import { expectedInvoiceTotal, readBackInvoice, type InvoiceRead } from './invoiceReadBack.ts';

const MOVE = { name: 'INV/2026/00001', state: 'posted', amount_untaxed: 1000, amount_tax: 110, amount_total: 1110, amount_residual: 1110, ref: 'PO-77', invoice_date: '2026-11-03', currency_id: [12, 'IDR'], write_date: '2026-11-03 10:00:00' };
const LINES = [{ id: 1, display_type: 'product', analytic_distribution: { '101': 100 } }, { id: 2, display_type: 'product', analytic_distribution: { '101': 100 } }];
const read = (over: Partial<InvoiceRead['move']> = {}, lines: InvoiceRead['productLines'] = LINES): InvoiceRead => ({ move: { ...MOVE, ...over }, productLines: lines, readAt: '2026-11-03T10:00:01Z' });
const EXPECT = { total: '1110.00', costAccountId: 101 };

describe('AC-OCI-016 the whole money header is written, or none of it', () => {
  it('writes Odoo\'s untaxed-derived figures verbatim: total, tax, outstanding; the number, reference and currency come from Odoo', () => {
    expect(readBackInvoice('inv-1', read(), EXPECT)).toEqual({
      id: 'inv-1', si_number: 'INV/2026/00001', invoice_date: '2026-11-03', reference_number: 'PO-77', currency: 'IDR',
      amount: '1110.00', tax_amount: '110.00', erp_outstanding_amount: '1110.00', erp_docstatus: 1, erp_modified: '2026-11-03 10:00:00', erp_amended_from: null,
      odoo_state: 'posted', odoo_attention: null, odoo_sent_total: null, odoo_read_at: '2026-11-03T10:00:01Z',
    });
  });

  it('a header missing the residual writes no money key at all and flags money-unreadable', () => {
    const r = readBackInvoice('inv-1', read({ amount_residual: undefined }), EXPECT);
    expect(r).not.toHaveProperty('amount');
    expect(r).not.toHaveProperty('tax_amount');
    expect(r).not.toHaveProperty('erp_outstanding_amount');
    expect(r.odoo_attention).toBe('money-unreadable');
  });

  it('Odoo\'s `false` for an empty field is not zero: a header with a `false` part is unreadable', () => {
    expect(readBackInvoice('inv-1', read({ amount_tax: false as unknown as number }), EXPECT).odoo_attention).toBe('money-unreadable');
  });

  it('a header the mirror\'s constraints would refuse (negative tax, tax above total, negative total) is unreadable, not written', () => {
    for (const bad of [{ amount_tax: -1 }, { amount_tax: 2000 }, { amount_total: -5, amount_residual: -5 }]) {
      const r = readBackInvoice('inv-1', read(bad), EXPECT);
      expect(r).not.toHaveProperty('amount');
      expect(r.odoo_attention).toBe('money-unreadable');
    }
  });
});

describe('AC-OCI-013 a different total is flagged, both figures kept, nothing replaced', () => {
  it('within the currency\'s smallest unit it is accepted', () => {
    expect(readBackInvoice('inv-1', read({ amount_total: 1110.01 }), EXPECT).odoo_attention).toBeNull();
    expect(readBackInvoice('inv-1', read({ amount_total: 1109.99 }), EXPECT).odoo_sent_total).toBeNull();
  });

  it('beyond it: needs attention "total-mismatch", Odoo\'s amount is the amount, the sent figure sits beside it', () => {
    const r = readBackInvoice('inv-1', read({ amount_tax: 120, amount_total: 1120, amount_residual: 1120 }), EXPECT);
    expect(r).toMatchObject({ amount: '1120.00', tax_amount: '120.00', odoo_attention: 'total-mismatch', odoo_sent_total: '1110.00' });
  });
});

describe('AC-OCI-030 the project\'s cost account on every posted product line', () => {
  it('a line lacking it, or splitting it, is "cost-account-missing" and revenue is not reported as attributed', () => {
    for (const bad of [false, null, { '999': 100 }, { '101': 60, '102': 40 }, { '101': 99 }]) {
      const lines = [LINES[0], { id: 2, display_type: 'product', analytic_distribution: bad as never }];
      expect(readBackInvoice('inv-1', read({}, lines), EXPECT).odoo_attention).toBe('cost-account-missing');
    }
  });

  it('wins over a mismatch in the one reason column, while the sent figure still shows the mismatch', () => {
    const r = readBackInvoice('inv-1', read({ amount_tax: 120, amount_total: 1120, amount_residual: 1120 }, [{ id: 2, display_type: 'product', analytic_distribution: false }]), EXPECT);
    expect([r.odoo_attention, r.odoo_sent_total]).toEqual(['cost-account-missing', '1110.00']);
  });

  it('lines that could not be read are "lines-unreadable", not a pass', () => {
    expect(readBackInvoice('inv-1', read({}, null), EXPECT).odoo_attention).toBe('lines-unreadable');
    expect(readBackInvoice('inv-1', read({}, []), EXPECT).odoo_attention).toBe('lines-unreadable');
  });

  it('an invoice with no project has nothing to check', () => {
    expect(readBackInvoice('inv-1', read({}, [{ id: 1, display_type: 'product', analytic_distribution: false }]), { ...EXPECT, costAccountId: null }).odoo_attention).toBeNull();
  });
});

describe('AC-OCI-022 a down-payment product posts to the configured customer-advance account', () => {
  const advance = { total: '1110.00', costAccountId: 101, advanceAccount: { productId: 72, accountId: 210 } };

  it('flags a posted down-payment line whose Odoo account differs from the configured account', () => {
    const lines = [{ id: 1, display_type: 'product', product_id: [72, 'Down payment'], account_id: [149, 'Sales'], analytic_distribution: { '101': 100 } }];
    expect(readBackInvoice('inv-1', read({}, lines), advance).odoo_attention).toBe('advance-account-mismatch');
  });

  it('accepts the configured account on the posted down-payment line', () => {
    const lines = [{ id: 1, display_type: 'product', product_id: [72, 'Down payment'], account_id: [210, 'Customer Advances'], analytic_distribution: { '101': 100 } }];
    expect(readBackInvoice('inv-1', read({}, lines), advance).odoo_attention).toBeNull();
  });
});

describe('status is read, not set (FR-OCI-025, DD-OCI-7)', () => {
  it('carries Odoo\'s residual so Paid is derived only from a zero residual; a zero-total invoice reads zero outstanding', () => {
    expect(readBackInvoice('inv-1', read({ amount_untaxed: 0, amount_tax: 0, amount_total: 0, amount_residual: 0 }, LINES), { ...EXPECT, total: '0.00' })).toMatchObject({ amount: '0.00', erp_outstanding_amount: '0.00', odoo_attention: null });
  });

  it('an unknown Odoo state is not stored as a state', () => {
    expect(readBackInvoice('inv-1', read({ state: 'weird' }), EXPECT)).toMatchObject({ odoo_state: null, erp_docstatus: 0 });
  });
});

describe('the expectation PMO judges Odoo\'s total by', () => {
  it('sums each line to the cent and adds each explicit tax, rounded per line', () => {
    expect(expectedInvoiceTotal([{ quantity: 4, unitPrice: 250 }, { quantity: 2, unitPrice: 500 }], [11])).toBe('2220.00');
    expect(expectedInvoiceTotal([{ quantity: 3, unitPrice: 333.33 }], [11])).toBe('1109.99');
    expect(expectedInvoiceTotal([{ quantity: 1, unitPrice: 100 }], [])).toBe('100.00');
  });
  it('a negative recovery line reduces the total and the sign survives', () => {
    expect(expectedInvoiceTotal([{ quantity: 1, unitPrice: 1000 }, { quantity: 1, unitPrice: -400 }], [11])).toBe('666.00');
    expect(expectedInvoiceTotal([{ quantity: 1, unitPrice: -5 }], [])).toBe('-5.00');
  });
});
