/**
 * Test support for the stock adapter and its recovery (AC-OSP-002, AC-OSP-004): a fake Odoo whose validated moves carry the value Odoo
 * would book, and whose validation books one `picking_entry` analytic line per move for an issue.
 */
import { bindCall, type OdooCall } from '../client.ts';
import { createFakeOdoo, type FakeOdoo } from '../fakeOdoo.ts';
import type { StockIntent } from './stockAdapter.ts';

export const DOC = '123e4567-e89b-12d3-a456-426614174000';

export const TRANSFER_INTENT: StockIntent = {
  documentId: DOC,
  kind: 'transfer',
  companyId: 1,
  pickingTypeId: 5,
  lines: [{ productId: 101, quantity: 8 }, { productId: 102, quantity: 3 }],
  sourceLocationId: 10,
  destinationLocationId: 20,
};

export const ISSUE_INTENT: StockIntent = { ...TRANSFER_INTENT, kind: 'issue', pickingTypeId: 2, projectId: 55, analyticAccountId: 42 };

export interface StockBed {
  fake: FakeOdoo;
  call: OdooCall;
  /** Every call that reached the traced layer, as `model/method`. */
  seen: string[];
}

export function stockBed(wrap?: (inner: OdooCall) => OdooCall): StockBed {
  const fake = createFakeOdoo({ key: 'k' });
  fake.seed('res.company', [{ id: 1, name: 'Main Co', currency_id: [5, 'IDR'] }]);
  const raw = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', companyId: 1, fetchImpl: fake.fetch });
  const seen: string[] = [];
  // Odoo books the project cost on validation, whether or not the answer reaches the caller.
  const bookCostLines = (body: Record<string, unknown>) => {
    const picking = fake.rows('stock.picking').find((p) => p.id === (body.ids as number[])[0]);
    if (picking?.state !== 'done' || !picking.project_id) return;
    for (const move of fake.rows('stock.move').filter((m) => m.picking_id === picking.id)) {
      fake.seed('account.analytic.line', [{
        name: String(picking.name), category: 'picking_entry', account_id: [42, 'Project'],
        product_id: move.product_id, amount: -10 * Number(move.quantity), unit_amount: Number(move.quantity),
      }]);
    }
  };
  const valued: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}) => {
    seen.push(`${model}/${method}`);
    let out: T;
    try {
      out = await raw<T>(model, method, body);
    } catch (err) {
      if (model === 'stock.picking' && method === 'button_validate') bookCostLines(body);
      throw err;
    }
    if (model === 'stock.move' && method === 'read') {
      // Bed 7.0: an issue's moves are valued (value -cost x quantity, is_valued true); an internal transfer's are not (value 0, false).
      const pickings = fake.rows('stock.picking');
      return (out as unknown as Array<Record<string, unknown>>).map((m) => {
        const valued = Boolean(pickings.find((p) => p.id === m.picking_id)?.project_id);
        return { ...m, value: valued ? -10 * Number(m.quantity ?? 0) : 0, is_valued: valued };
      }) as unknown as T;
    }
    if (model === 'stock.picking' && method === 'button_validate') bookCostLines(body);
    return out;
  };
  return { fake, call: wrap ? wrap(valued) : valued, seen };
}
