import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { parsePage } from '../kinds.ts';
import { readPickings, STOCK_COST_FEED_SPEC, stockCostFeedReaders } from './stockCostFeed.ts';

// The shape report §4 records for a validated project issue: 2 units at 120.00, no journal item.
const raw = (over: Record<string, unknown> = {}) => ({
  id: 31, name: 'WH/OUT/00004', category: 'picking_entry', move_line_id: false, account_id: [600, 'Project A'], general_account_id: false,
  product_id: [77, 'Cement'], unit_amount: 2, amount: -240, date: '2026-11-14', company_id: [1, 'Main'], write_date: '2026-11-14 08:00:00', ...over,
});

describe('stock cost feed parsing (#2282 AC-IMC-001)', () => {
  it('maps a cost (negative amount) to a debit, keeping the quantity, project account and product', () => {
    expect(STOCK_COST_FEED_SPEC.parse(raw())).toMatchObject({
      external_id: '31', name: 'WH/OUT/00004', source_write_date: '2026-11-14 08:00:00',
      attrs: { analytic_account_id: '600', general_account_id: null, product_id: '77', company_id: '1', unit_amount: '2', debit: '240.00', credit: '0.00', date: '2026-11-14' },
    });
  });

  it('maps a return (positive amount) to a credit', () => {
    expect(STOCK_COST_FEED_SPEC.parse(raw({ amount: 120, unit_amount: -1 }))?.attrs).toMatchObject({ debit: '0.00', credit: '120.00', unit_amount: '-1' });
  });

  it('never stores a line that has a journal item: the GL kind already counts it', () => {
    expect(STOCK_COST_FEED_SPEC.parse(raw({ move_line_id: [88, 'STJ/0001'] }))).toBeNull();
  });

  it('rejects another category, a malformed amount or write date, and a line with no product or company', () => {
    const { rows, skipped } = parsePage(STOCK_COST_FEED_SPEC, [
      raw(), raw({ category: 'other' }), raw({ amount: 'NaN' }), raw({ write_date: 'yesterday' }), raw({ product_id: false }), raw({ company_id: false }),
    ]);
    expect(rows.map((r) => r.external_id)).toEqual(['31']);
    expect(skipped).toBe(5);
  });

  it('reads only the activated company\'s picking_entry lines with no journal item, from Odoo itself', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.seed('account.analytic.line', [
      raw({ id: 1 }),
      raw({ id: 2, move_line_id: 88 }),          // already counted through the journal item
      raw({ id: 3, category: 'other' }),
      raw({ id: 4, company_id: 2 }),             // another company
      raw({ id: 5, company_id: false }),         // shared: not this org's cost
    ]);
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch as typeof fetch });
    const readers = stockCostFeedReaders(call, 1);
    expect(((await readers.read([], 'id asc', 10)) as Array<{ id: number }>).map((r) => r.id)).toEqual([1]);
    expect(await readers.readIds(0, 10)).toEqual([1]);
  });

  it('reads each picking a page names once, with the picking a return returns', async () => {
    const fake = createFakeOdoo({ key: 'k' });
    fake.seed('stock.picking', [
      { id: 9001, name: 'WH/OUT/00004', company_id: 1, return_id: false },
      { id: 9101, name: 'WH/RET/00001', company_id: 1, return_id: [9001, 'WH/OUT/00004'] },
    ]);
    const calls: string[] = [];
    const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1',
      fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => { calls.push(String(input)); return fake.fetch(input, init); }) as typeof fetch });
    const out = await readPickings(call, 1, ['WH/OUT/00004', 'WH/RET/00001', 'WH/OUT/00004']);
    expect(out.get('WH/OUT/00004')).toEqual({ id: 9001, returnOf: null });
    expect(out.get('WH/RET/00001')).toEqual({ id: 9101, returnOf: 9001 });
    expect(calls).toHaveLength(1);
  });
});
