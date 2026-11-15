import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import type { DirectoryRow } from '../kinds.ts';
import { resolveStockCostAccounts, StockCostAccountHold } from './stockCostAccount.ts';

const row = (id: string, general: string | null, product: string): DirectoryRow => ({
  external_id: id, code: null, name: 'WH/OUT/1', parent_external_id: null, active: true, source_write_date: '2026-11-14 08:00:00',
  attrs: { analytic_account_id: '600', general_account_id: general, product_id: product, company_id: '1', unit_amount: '1', debit: '10.00', credit: '0.00', date: '2026-11-14' },
});

function odoo() {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('product.product', [
    { id: 77, name: 'Cement', property_account_expense_id: [520, '5200 Materials'], categ_id: [5, 'All'] },
    { id: 78, name: 'Cable', property_account_expense_id: false, categ_id: [5, 'All'] },
    { id: 79, name: 'Sand', property_account_expense_id: false, categ_id: [6, 'Bare'] },
  ]);
  fake.seed('product.category', [
    { id: 5, name: 'All', property_account_expense_categ_id: [530, '5300 Site costs'] },
    { id: 6, name: 'Bare', property_account_expense_categ_id: false },
  ]);
  const models: string[] = [];
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1',
    fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => { models.push(String(input).split('/json/2/')[1] ?? String(input)); return fake.fetch(input, init); }) as typeof fetch });
  return { call, models };
}
const codes = new Map([['510', '5100'], ['520', '5200'], ['530', '5300']]);

describe('issued material account (#2282 D6, AC-IMC-001)', () => {
  it('uses the analytic line\'s own account when the directory has it, without reading products', async () => {
    const o = odoo();
    expect([...await resolveStockCostAccounts(o.call, [row('1', '510', '77')], codes)]).toEqual([['1', '5100']]);
    expect(o.models).toEqual([]);
  });

  it('falls back to the product\'s expense account, then its category\'s', async () => {
    const o = odoo();
    const out = await resolveStockCostAccounts(o.call, [row('1', null, '77'), row('2', null, '78'), row('3', null, '77')], codes);
    expect(Object.fromEntries(out)).toEqual({ 1: '5200', 2: '5300', 3: '5200' });
  });

  it('reads products once per page, not once per line', async () => {
    const o = odoo();
    await resolveStockCostAccounts(o.call, [row('1', null, '77'), row('2', null, '77'), row('3', null, '78')], codes);
    expect(o.models.filter((m) => m.startsWith('product.product'))).toHaveLength(1);
  });

  it('holds the page when the account is not mirrored, or when nothing resolves', async () => {
    const o = odoo();
    await expect(resolveStockCostAccounts(o.call, [row('1', '999', '77')], codes)).rejects.toMatchObject({ held: 1 });
    await expect(resolveStockCostAccounts(o.call, [row('1', null, '79'), row('2', null, '77')], codes)).rejects.toBeInstanceOf(StockCostAccountHold);
    await expect(resolveStockCostAccounts(o.call, [row('1', null, '77')], new Map())).rejects.toMatchObject({ held: 1 });
  });

  it('AC-IMC-001 the hold names the products that have no category and no expense account, once each', async () => {
    const o = odoo();
    const err = await resolveStockCostAccounts(o.call, [row('1', null, '79'), row('2', null, '77'), row('3', null, '79')], codes).catch((e) => e);
    expect(err).toBeInstanceOf(StockCostAccountHold);
    expect([err.held, err.products]).toEqual([2, ['Sand']]);
  });
});
