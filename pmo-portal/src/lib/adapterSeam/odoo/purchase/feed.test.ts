import { expect, it } from 'vitest';
import type { OdooCall } from '../client.ts';
import { parsePage } from '../kinds.ts';
import { PURCHASE_DOMAINS, PURCHASE_SPECS, purchaseReaders } from './feed.ts';

const KEY = 'bill:123e4567-e89b-12d3-a456-426614174001';
const call = (rows: Record<string, unknown[]>, log: Array<{ model: string; method: string; body: Record<string, unknown> }> = []): OdooCall =>
  (async (model: string, method: string, body: Record<string, unknown>) => {
    log.push({ model, method, body });
    return (rows[model] ?? []) as never;
  }) as OdooCall;

const bill = { id: 7, name: 'BILL/2026/0007', state: 'posted', partner_id: [41, 'Vendor V'], invoice_date: '2026-10-30', invoice_date_due: '2026-11-30', ref: 'INV-7', amount_total: 98, amount_untaxed: 100, amount_residual: 98, write_date: '2026-11-01 10:00:00' };

it('AC-OPP-043 a bill row carries the whole money header from its tax lines, VAT up and withholding down', async () => {
  const rows = { 'account.move': [bill], 'account.move.line': [
    { move_id: [7, 'b'], balance: 100, tax_line_id: false, analytic_distribution: { '88': 100 } },
    { move_id: [7, 'b'], balance: 11, tax_line_id: [3, 'PPN 11%'], analytic_distribution: false },
    { move_id: [7, 'b'], balance: -2, tax_line_id: [4, 'PPh 23'], analytic_distribution: false },
  ], 'ir.model.data': [{ res_id: 7, name: 'bill_123e4567_e89b_12d3_a456_426614174001' }] };
  const page = await purchaseReaders(call(rows), PURCHASE_SPECS.bill, 1).read([], 'id asc', 200);
  const [row] = parsePage(PURCHASE_SPECS.bill, page).rows;
  expect(row.external_id).toBe('7');
  expect(row.attrs).toMatchObject({
    state: 'posted', status: 'Received', docstatus: 1, cancelled: false, partner: '41', partner_name: 'Vendor V', bill_no: 'INV-7', date: '2026-10-30', due_date: '2026-11-30',
    amount_total: '98.00', residual: '98.00', analytic_ids: ['88'], anchor_key: KEY,
    money: { gross: '100.00', vat: '11.00', withheld: '2.00', outstanding: '98.00' },
  });
});

it('AC-OPP-072 an order and a bill carry the document currency and the orders a bill bills (what link-existing compares and guards on)', async () => {
  const order = { id: 9, name: 'P00009', state: 'purchase', partner_id: [41, 'V'], date_order: '2026-10-30 08:00:00', currency_id: [13, 'USD'], amount_total: 111, amount_untaxed: 100, write_date: '2026-11-02 10:00:00' };
  const rows = { 'account.move': [{ ...bill, currency_id: [12, 'IDR'], invoice_origin: 'P00009, P00010' }], 'account.move.line': [], 'purchase.order': [order], 'purchase.order.line': [] };
  const [b] = parsePage(PURCHASE_SPECS.bill, await purchaseReaders(call(rows), PURCHASE_SPECS.bill, 1).read([], 'id asc', 200)).rows;
  expect(b.attrs).toMatchObject({ currency: 'IDR', source_orders: ['P00009', 'P00010'] });
  const [o] = parsePage(PURCHASE_SPECS['purchase-order'], await purchaseReaders(call(rows), PURCHASE_SPECS['purchase-order'], 1).read([], 'id asc', 200)).rows;
  expect(o.attrs).toMatchObject({ currency: 'USD' });
  // a bill nobody billed an order for, and a row Odoo gives no currency for, state none (absent, never a guess)
  const [plain] = parsePage(PURCHASE_SPECS.bill, await purchaseReaders(call({ 'account.move': [{ ...bill, currency_id: false, invoice_origin: false }], 'account.move.line': [] }), PURCHASE_SPECS.bill, 1).read([], 'id asc', 200)).rows;
  expect(plain.attrs).toMatchObject({ currency: null, source_orders: [] });
});

it('AC-OPP-072 the bill and order reads ask Odoo for the currency, and the bill for its source documents', () => {
  expect(PURCHASE_SPECS.bill.fields).toEqual(expect.arrayContaining(['currency_id', 'invoice_origin']));
  expect(PURCHASE_SPECS['purchase-order'].fields).toContain('currency_id');
});

it('AC-OPP-043 a tax line without a readable balance leaves the header absent, never a partial one', async () => {
  const rows = { 'account.move': [bill], 'account.move.line': [{ move_id: [7, 'b'], balance: 'oops', tax_line_id: [3, 'PPN'], analytic_distribution: false }] };
  const [row] = parsePage(PURCHASE_SPECS.bill, await purchaseReaders(call(rows), PURCHASE_SPECS.bill, 1).read([], 'id asc', 200)).rows;
  expect(row.attrs.money).toBeNull();
});

it('AC-OPP-071 a paid bill and a cancelled order derive their status and docstatus from Odoo', async () => {
  const paid = { ...bill, amount_residual: 0 };
  const rows = { 'account.move': [paid], 'account.move.line': [], 'purchase.order': [
    { id: 9, name: 'P00009', state: 'cancel', partner_id: [41, 'V'], date_order: '2026-10-30 08:00:00', amount_total: 111, amount_untaxed: 100, write_date: '2026-11-02 10:00:00' }] ,
    'purchase.order.line': [{ order_id: [9, 'P'], analytic_distribution: { '88,91': 100 } }, { order_id: [9, 'P'], analytic_distribution: false }] };
  const b = parsePage(PURCHASE_SPECS.bill, await purchaseReaders(call(rows), PURCHASE_SPECS.bill, 1).read([], 'id asc', 200)).rows[0];
  expect(b.attrs).toMatchObject({ status: 'Paid', docstatus: 1 });
  const o = parsePage(PURCHASE_SPECS['purchase-order'], await purchaseReaders(call(rows), PURCHASE_SPECS['purchase-order'], 1).read([], 'id asc', 200)).rows[0];
  expect(o.attrs).toMatchObject({ status: 'Closed', docstatus: 2, cancelled: true, date: '2026-10-30', amount_total: '111.00', analytic_ids: ['88', '91'], anchor_key: null });
});

it('AC-OPP-071 receipts and payments map to PMO\'s own status words', async () => {
  const r = parsePage(PURCHASE_SPECS.receipt, [{ id: 1, name: 'WH/IN/1', state: 'done', partner_id: false, write_date: '2026-11-01 10:00:00' }, { id: 2, name: 'WH/IN/2', state: 'assigned', partner_id: false, write_date: '2026-11-01 10:00:00' }]).rows;
  expect(r.map((x) => [x.attrs.status, x.attrs.docstatus])).toEqual([['Complete', 1], ['Partial', 0]]);
  const p = parsePage(PURCHASE_SPECS.payment, [
    { id: 1, name: 'PBNK/1', state: 'paid', partner_id: [41, 'V'], amount: 98, date: '2026-11-01', write_date: '2026-11-01 10:00:00' },
    { id: 2, name: 'PBNK/2', state: 'draft', partner_id: [41, 'V'], amount: 5, date: '2026-11-01', write_date: '2026-11-01 10:00:00' },
    { id: 3, name: 'PBNK/3', state: 'canceled', partner_id: [41, 'V'], amount: 5, date: '2026-11-01', write_date: '2026-11-01 10:00:00' }]).rows;
  expect(p.map((x) => [x.attrs.status, x.attrs.docstatus, x.attrs.amount])).toEqual([['Paid', 1, '98.00'], ['Scheduled', 0, '5.00'], ['Scheduled', 2, '5.00']]);
});

it('AC-OPP-074 an unparseable row is skipped whole', () => {
  const ok = { id: 1, name: 'WH/IN/1', state: 'done', partner_id: false, write_date: '2026-11-01 10:00:00' };
  const { rows, skipped } = parsePage(PURCHASE_SPECS.receipt, [ok, { ...ok, id: 'x' }, { ...ok, name: '' }, { ...ok, write_date: '2026-11-01' }, { ...ok, partner_id: 'nope' }, { ...ok, state: false }]);
  expect(rows).toHaveLength(1);
  expect(skipped).toBe(5);
});

it('FR-OPP-080 each domain reads only what PMO mirrors: vendor bills, outbound supplier payments, incoming transfers, in the activated company', async () => {
  const log: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  for (const d of PURCHASE_DOMAINS) await purchaseReaders(call({}, log), PURCHASE_SPECS[d], 5).read([['id', '>', 3]], 'id asc', 200);
  const domainOf = (model: string) => JSON.stringify(log.find((l) => l.model === model && l.method === 'search_read')!.body.domain);
  expect(domainOf('account.move')).toContain('["move_type","=","in_invoice"]');
  expect(domainOf('account.payment')).toContain('["payment_type","=","outbound"]');
  expect(domainOf('account.payment')).toContain('["partner_type","=","supplier"]');
  expect(domainOf('stock.picking')).toContain('["picking_type_code","=","incoming"]');
  for (const m of ['account.move', 'account.payment', 'stock.picking', 'purchase.order']) expect(domainOf(m), m).toContain('["company_id","in",[5,false]]');
  expect(log.every((l) => (l.body.context as { active_test?: boolean } | undefined)?.active_test !== true)).toBe(true);
});

it('FR-OPP-080 the census id list uses the same filter and company scope', async () => {
  const log: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  await purchaseReaders(call({ 'account.move': [] }, log), PURCHASE_SPECS.bill, 5).readIds(0, 2000);
  expect(JSON.stringify(log[0].body.domain)).toContain('in_invoice');
  expect(log[0].method).toBe('search');
});
