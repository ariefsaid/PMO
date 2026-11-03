import { describe, expect, it } from 'vitest';
import { parsePage } from '../kinds.ts';
import { REVENUE_FEED_SPECS, revenueFeedReaders } from './feed.ts';

const move = (over: Record<string, unknown> = {}) => ({
  id: 51, name: 'INV/2026/00051', move_type: 'out_invoice', state: 'posted', partner_id: [41, 'Client A'],
  invoice_date: '2026-11-01', invoice_date_due: '2026-12-01', ref: 'PO-51', currency_id: [1, 'IDR'],
  amount_total: 1110, amount_untaxed: 1000, amount_tax: 110, amount_residual: 710, write_date: '2026-11-02 10:00:00', ...over,
});

describe('Odoo revenue feed parsing', () => {
  it('AC-OCI-074 maps a customer invoice with Odoo residual and status into a complete mirror row', () => {
    const row = REVENUE_FEED_SPECS['sales-invoice'].parse(move());
    expect(row?.attrs).toMatchObject({
      state: 'posted', docstatus: 1, status: 'Unpaid', partner: '41', partner_name: 'Client A',
      date: '2026-11-01', due_date: '2026-12-01', reference_number: 'PO-51', currency: 'IDR',
      amount_total: '1110.00', amount_untaxed: '1000.00', amount_tax: '110.00', residual: '710.00',
    });
  });

  it('AC-OCI-075 keeps a credit note negative at the database boundary and carries its reversed invoice reference', () => {
    const row = REVENUE_FEED_SPECS['credit-note'].parse(move({
      move_type: 'out_refund', name: 'CN/2026/00051', state: 'posted', reversed_entry_id: [51, 'INV/2026/00051'],
    }));
    expect(row?.attrs).toMatchObject({ docstatus: 1, status: 'Posted', reversed_entry_ref: 'account.move:51', amount_total: '1110.00' });
  });

  it('AC-OCI-071 classifies inbound customer payments and skips an unrecognised direction', () => {
    const spec = REVENUE_FEED_SPECS['incoming-payment'];
    const base = { id: 71, name: 'PAY/2026/00071', state: 'paid', partner_id: [41,'Client A'], payment_type: 'inbound', partner_type: 'customer', amount: 100, date: '2026-11-02', currency_id: [1,'IDR'], write_date: '2026-11-02 10:00:00' };
    expect(spec.parse(base)?.attrs).toMatchObject({ status: 'Paid', payment_type: 'inbound', partner_type: 'customer', amount: '100.00' });
    expect(spec.parse({ ...base, payment_type: 'outbound' })).toBeNull();
    expect(spec.parse({ ...base, partner_type: '' })).toBeNull();
  });

  it.each([
    ['draft', 0, 'Scheduled'],
    ['in_process', 1, 'Paid'],
    ['paid', 1, 'Paid'],
    ['reconciled', 1, 'Paid'],
    ['posted', 1, 'Paid'],
    ['canceled', 2, 'Cancelled'],
    ['cancelled', 2, 'Cancelled'],
    ['cancel', 2, 'Cancelled'],
    ['rejected', 2, 'Cancelled'],
  ] as const)('AC-OCI-071 Odoo payment state %s maps to receipt docstatus %s and status %s', (state, docstatus, status) => {
    const base = { id: 71, name: 'PAY/2026/00071', state, partner_id: [41, 'Client A'], payment_type: 'inbound', partner_type: 'customer', amount: 100, date: '2026-11-02', currency_id: [1, 'IDR'], write_date: '2026-11-02 10:00:00' };
    expect(REVENUE_FEED_SPECS['incoming-payment'].parse(base)?.attrs).toMatchObject({ status, docstatus });
  });

  it('AC-OCI-072 reads only the selected kind and activated company, then resolves a PMO anchor', async () => {
    const calls: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
    const fake = async <T>(model: string, method: string, body: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ model, method, body });
      if (model === 'ir.model.data') return [{ res_id: 51, name: 'si_123e4567_e89b_12d3_a456_426614174001' }] as T;
      return [move()] as T;
    };
    const readers = revenueFeedReaders(fake, REVENUE_FEED_SPECS['sales-invoice'], 8);
    const page = await readers.read([], 'write_date asc, id asc', 200);
    const { rows, skipped } = parsePage(REVENUE_FEED_SPECS['sales-invoice'], page);
    expect(skipped).toBe(0);
    expect(rows[0].attrs.anchor_key).toBe('si:123e4567-e89b-12d3-a456-426614174001');
    expect(calls[0]).toMatchObject({
      model: 'account.move', method: 'search_read',
      body: { domain: [['move_type','=','out_invoice'],['company_id','in',[8,false]]], fields: expect.arrayContaining(['reversed_entry_id','amount_residual']) },
    });
    expect(calls[1]).toMatchObject({ model: 'ir.model.data', method: 'search_read' });
  });

  it('AC-OCI-071 omits unknown move states and leaves a missing residual unclassified', () => {
    const rows = parsePage(REVENUE_FEED_SPECS['sales-invoice'], [move({ state: 'waiting' }), move({ amount_residual: undefined })]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.skipped).toBe(1);
    expect(rows.rows[0].attrs).toMatchObject({ status: null, residual: null });
  });
});
