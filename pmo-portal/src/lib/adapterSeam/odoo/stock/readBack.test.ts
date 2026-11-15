import { describe, expect, it } from 'vitest';
import { bindCall, type OdooCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { evaluateStockEvidence } from './evidence.ts';
import { readStockEvidence } from './readBack.ts';

function setup(wrap?: (inner: OdooCall) => OdooCall) {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [5, 'IDR'] }]);
  fake.seed('stock.picking', [{
    id: 10, name: 'WH/OUT/00010', state: 'done', company_id: [1, 'Main Co'], location_id: [6, 'WH/Stock'], location_dest_id: [2, 'Customers'],
    move_ids: [100, 101], write_date: '2026-11-14 10:00:00', date_done: '2026-11-14 10:00:00',
  }]);
  fake.seed('stock.move', [
    { id: 100, picking_id: 10, product_id: [101, 'A'], quantity: 8, product_uom_qty: 8, state: 'done', value: -800 },
    { id: 101, picking_id: 10, product_id: [102, 'B'], quantity: 3, product_uom_qty: 3, state: 'done', value: -300 },
  ]);
  fake.seed('account.analytic.line', [
    { id: 1, name: 'WH/OUT/00010', category: 'picking_entry', account_id: [42, 'Project'], product_id: [101, 'A'], amount: -800, unit_amount: 8 },
    { id: 2, name: 'WH/OUT/00010', category: 'picking_entry', account_id: [42, 'Project'], product_id: [102, 'B'], amount: -300, unit_amount: 3 },
    { id: 3, name: 'WH/OUT/00010', category: 'picking_entry', account_id: [43, 'Other project'], product_id: [101, 'A'], amount: -5, unit_amount: 1 },
    { id: 4, name: 'OTHER', category: 'picking_entry', account_id: [42, 'Project'], product_id: [101, 'A'], amount: -9, unit_amount: 1 },
    { id: 5, name: 'WH/OUT/00010', category: 'manual', account_id: [42, 'Project'], product_id: [101, 'A'], amount: -7, unit_amount: 1 },
  ]);
  const raw = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', companyId: 1, fetchImpl: fake.fetch });
  const seen: string[] = [];
  const traced: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
    seen.push(`${model}/${method}`);
    return raw<T>(model, method, body);
  };
  return { fake, call: wrap ? wrap(traced) : traced, seen };
}

describe('AC-OSP-007 readStockEvidence reads what Odoo holds for a picking', () => {
  it('AC-OSP-007 reads picking, every move, picking_entry analytic lines and company currency in one bounded pass', async () => {
    const { call, seen } = setup();

    const res = await readStockEvidence(call, 10, { analyticAccountId: 42 });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.read.picking).toMatchObject({ id: 10, state: 'done' });
    expect(res.read.moves.map((m) => m.id)).toEqual([100, 101]);
    expect(res.read.analyticLines?.map((l) => l.id)).toEqual([1, 2]);
    expect(res.read.currency).toBe('IDR');
    expect(seen).toEqual(['stock.picking/read', 'stock.move/read', 'account.analytic.line/search_read', 'res.company/read']);
  });

  it('AC-OSP-007 a transfer reads no analytic lines', async () => {
    const { call, seen } = setup();
    const res = await readStockEvidence(call, 10);
    if (!res.ok) throw new Error('unreachable');
    expect(res.read.analyticLines).toBeUndefined();
    expect(seen).not.toContain('account.analytic.line/search_read');
  });

  it('AC-OSP-007 what it reads evaluates to a confirmed issue with one line per move', async () => {
    const { call } = setup();
    const res = await readStockEvidence(call, 10, { analyticAccountId: 42 });
    if (!res.ok) throw new Error('unreachable');

    const verdict = evaluateStockEvidence({
      documentId: 'd', kind: 'issue', companyId: 1, sourceLocationId: 6, destinationLocationId: 2, projectId: 42,
      lines: [{ productId: 101, quantity: 8 }, { productId: 102, quantity: 3 }],
    }, res.read);

    expect(verdict).toMatchObject({ state: 'confirmed', completedQuantity: 11, completedValue: -1100, currency: 'IDR' });
  });

  it('AC-OSP-007 an absent picking reads as no picking, not an error', async () => {
    const { call } = setup();
    const res = await readStockEvidence(call, 999);
    expect(res).toMatchObject({ ok: true, read: { picking: null, moves: [] } });
  });

  it('AC-OSP-007 a read error is unknown, not held and not confirmed', async () => {
    for (const failing of ['stock.picking', 'stock.move', 'account.analytic.line', 'res.company']) {
      const { call } = setup((inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
        if (model === failing) throw new Error('connection dropped');
        return inner<T>(model, method, body);
      }) as OdooCall);
      const res = await readStockEvidence(call, 10, { analyticAccountId: 42 });
      expect(res).toMatchObject({ ok: false, outcome: 'unknown' });
    }
  });
});
