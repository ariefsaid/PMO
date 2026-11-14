import { describe, expect, it } from 'vitest';
import { bindCall, type OdooCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { executeStockTransfer, type StockTransferParams } from './transfer.ts';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

function setupFakeStock(options: {
  wizardOnValidate?: boolean;
  failReadBack?: boolean;
} = {}) {
  const fake = createFakeOdoo({ key: 'test-key' });
  fake.seed('ir.module.module', [
    { id: 1, name: 'stock', state: 'installed' },
    { id: 2, name: 'stock_account', state: 'installed' },
    { id: 3, name: 'project_stock_account', state: 'installed' },
  ]);
  fake.seed('stock.picking.type', [
    { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: true },
  ]);

  const rawCall = bindCall({
    baseUrl: 'https://odoo.example.test',
    apiKey: 'test-key',
    database: 'db1',
    companyId: 1,
    fetchImpl: fake.fetch,
  });

  const calls: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  const call: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ model, method, body });
    if (options.wizardOnValidate && model === 'stock.picking' && method === 'button_validate') {
      return {
        type: 'ir.actions.act_window',
        res_model: 'stock.backorder.confirmation',
        context: { button_validate_picking_ids: body.ids },
      } as T;
    }
    if (options.failReadBack && method === 'read' && (model === 'stock.picking' || model === 'stock.move')) {
      throw new Error('read-back connection dropped');
    }
    return rawCall<T>(model, method, body);
  };

  return { fake, call, calls };
}

const DEFAULT_PARAMS: StockTransferParams = {
  stockDocumentId: UUID,
  companyId: 1,
  pickingTypeId: 2,
  productId: 101,
  quantity: 8,
  sourceLocationId: 10,
  destinationLocationId: 20,
  origin: 'STK-DOC-001',
  capability: { ok: true },
};

describe('executeStockTransfer (AC-OSP-002)', () => {
  it('AC-OSP-002: authorized mapped stock transfer executes load, move write, validation and reads back ERP values', async () => {
    const { call, calls } = setupFakeStock();

    const result = await executeStockTransfer(call, DEFAULT_PARAMS);

    expect(result).toMatchObject({
      ok: true,
      outcome: 'success',
      state: 'done',
      completedQuantity: 8,
    });
    if (result.ok) {
      expect(result.pickingId).toBeGreaterThan(0);
      expect(result.externalRecordId).toBe(`stock.picking:${result.pickingId}`);
    }

    // Verify exact outgoing call sequence in order:
    // 1. stock.picking load (single-call atomic creation with identifier and nested move lines)
    // 2. stock.move search_read (locate created move)
    // 3. stock.move write (set completed quantity and picked: true)
    // 4. stock.picking button_validate
    // 5. read back completed picking & move state from ERP
    const callSignatures = calls.map((c) => `${c.model}/${c.method}`);
    expect(callSignatures).toEqual([
      'stock.picking/load',
      'stock.move/search_read',
      'stock.move/write',
      'stock.picking/button_validate',
      'stock.picking/read',
      'stock.move/read',
    ]);

    // Assert load call payload structure
    const loadCall = calls[0];
    expect(loadCall.body.fields).toEqual([
      'id',
      'picking_type_id/.id',
      'location_id/.id',
      'location_dest_id/.id',
      'company_id/.id',
      'origin',
      'move_ids/product_id/.id',
      'move_ids/product_uom_qty',
      'move_ids/location_id/.id',
      'move_ids/location_dest_id/.id',
      'move_ids/company_id/.id',
    ]);
    expect(loadCall.body.data).toEqual([
      [
        'pmo.stock_123e4567_e89b_12d3_a456_426614174000',
        2,
        10,
        20,
        1,
        'STK-DOC-001',
        101,
        8,
        10,
        20,
        1,
      ],
    ]);

    // Assert move quantity write
    const moveWriteCall = calls[2];
    expect(moveWriteCall.body.vals).toEqual({ quantity: 8, picked: true });

    // Assert button_validate call
    const validateCall = calls[3];
    expect(validateCall.body.ids).toEqual([result.ok ? result.pickingId : 0]);
  });

  it('AC-OSP-002: returns ERP read-back completed quantity and state, never input-derived values', async () => {
    const { call } = setupFakeStock();
    // Simulate ERP whose read-back quantity is established by the ERP record (e.g. 8)
    // To prove it reads from ERP and never from input, we can intercept the move read to return 6
    const callWithCustomErpRead: OdooCall = async <T>(model: string, method: string, body: Record<string, unknown> = {}): Promise<T> => {
      if (model === 'stock.move' && method === 'read') {
        return [{ id: 1, state: 'done', quantity: 6 }] as T;
      }
      return call<T>(model, method, body);
    };

    const result = await executeStockTransfer(callWithCustomErpRead, { ...DEFAULT_PARAMS, quantity: 8 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Must reflect the read-back quantity 6 from ERP, NOT the input quantity 8
      expect(result.completedQuantity).toBe(6);
      expect(result.state).toBe('done');
    }
  });

  it('AC-OSP-002: repeated identical transfer call updates existing record without creating a second picking', async () => {
    const { fake, call } = setupFakeStock();

    const first = await executeStockTransfer(call, DEFAULT_PARAMS);
    const second = await executeStockTransfer(call, { ...DEFAULT_PARAMS, origin: 'STK-DOC-001-RETRY' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.pickingId).toBe(second.pickingId);
      expect(first.externalRecordId).toBe(second.externalRecordId);
    }

    // Only one picking and one anchor exist in ERP
    expect(fake.rows('stock.picking')).toHaveLength(1);
    expect(fake.rows('ir.model.data')).toHaveLength(1);
  });

  it('AC-OSP-002: refused capability sends zero stock-write calls', async () => {
    const { calls, call } = setupFakeStock();

    const result = await executeStockTransfer(call, {
      ...DEFAULT_PARAMS,
      capability: {
        ok: false,
        reason: 'missing-module-project_stock_account',
        message: 'Install project_stock_account',
      },
    });

    expect(result).toEqual({
      ok: false,
      outcome: 'refused',
      reason: 'missing-module-project_stock_account',
      message: 'Install project_stock_account',
    });
    expect(calls).toHaveLength(0);
  });

  it('AC-OSP-002: missing mapping sends zero stock-write calls', async () => {
    const { calls, call } = setupFakeStock();

    const result = await executeStockTransfer(call, {
      ...DEFAULT_PARAMS,
      productId: 0, // missing mapping
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: 'refused',
      reason: 'missing-mapping',
    });
    expect(calls).toHaveLength(0);
  });

  it('AC-OSP-002: validation returning a wizard (backorder) is refused with typed reason and no further call', async () => {
    const { call, calls } = setupFakeStock({ wizardOnValidate: true });

    const result = await executeStockTransfer(call, DEFAULT_PARAMS);

    expect(result).toEqual({
      ok: false,
      outcome: 'refused',
      reason: 'unhandled-wizard',
      wizard: 'stock.backorder.confirmation',
      message: expect.stringMatching(/unhandled wizard.*stock\.backorder\.confirmation/i),
    });

    // Proves button_validate was the last call; no read-back, no wizard auto-answering
    const callSignatures = calls.map((c) => `${c.model}/${c.method}`);
    expect(callSignatures).toEqual([
      'stock.picking/load',
      'stock.move/search_read',
      'stock.move/write',
      'stock.picking/button_validate',
    ]);
  });

  it('AC-OSP-002: a failed read-back returns unknown outcome, never success', async () => {
    const { call } = setupFakeStock({ failReadBack: true });

    const result = await executeStockTransfer(call, DEFAULT_PARAMS);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'unknown',
      reason: 'unknown-outcome',
      message: expect.stringMatching(/failed to read back/i),
    });
    expect(result.ok).toBe(false);
  });
});
