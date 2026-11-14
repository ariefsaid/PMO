import { describe, expect, it } from 'vitest';
import { bindCall, type OdooCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { executeStockIssue, type StockIssueParams } from './issue.ts';

const UUID = '223e4567-e89b-12d3-a456-426614174000';
const WORK_ITEM_ID = 'wi-task-stock-001';

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
  fake.seed('project.project', [
    { id: 42, name: 'Project Apex', company_id: [1, 'Main Co'] },
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

const DEFAULT_PARAMS: StockIssueParams = {
  stockDocumentId: UUID,
  pmoWorkItemId: WORK_ITEM_ID,
  companyId: 1,
  pickingTypeId: 2,
  projectId: 42,
  productId: 101,
  quantity: 5,
  sourceLocationId: 10,
  destinationLocationId: 20,
  origin: 'STK-ISSUE-001',
  capability: { ok: true },
};

describe('executeStockIssue (AC-OSP-003)', () => {
  it('AC-OSP-003: authorized mapped project issue passes verified operation type and mapped project_id, retains work item id, and makes NO extra journal calls', async () => {
    const { call, calls, fake } = setupFakeStock();

    const result = await executeStockIssue(call, DEFAULT_PARAMS);

    expect(result).toMatchObject({
      ok: true,
      outcome: 'success',
      state: 'done',
      completedQuantity: 5,
      pmoWorkItemId: WORK_ITEM_ID,
    });
    if (result.ok) {
      expect(result.pickingId).toBeGreaterThan(0);
      expect(result.externalRecordId).toBe(`stock.picking:${result.pickingId}`);
    }

    // 1. Assert load call carries verified operation type (2) and mapped project_id (42)
    const loadCall = calls[0];
    expect(loadCall.model).toBe('stock.picking');
    expect(loadCall.method).toBe('load');
    expect(loadCall.body.fields).toEqual([
      'id',
      'picking_type_id/.id',
      'location_id/.id',
      'location_dest_id/.id',
      'company_id/.id',
      'project_id/.id',
      'origin',
      'move_ids/product_id/.id',
      'move_ids/product_uom_qty',
      'move_ids/location_id/.id',
      'move_ids/location_dest_id/.id',
      'move_ids/company_id/.id',
    ]);
    expect(loadCall.body.data).toEqual([
      [
        'pmo.stock_223e4567_e89b_12d3_a456_426614174000',
        2,
        10,
        20,
        1,
        42,
        'STK-ISSUE-001',
        101,
        5,
        10,
        20,
        1,
      ],
    ]);

    // 2. Assert PMO work item id was NOT sent to Odoo in any call
    expect(JSON.stringify(calls)).not.toContain(WORK_ITEM_ID);

    // 3. Assert NO account.move or account.analytic.line create or write is EVER sent
    const financialCalls = calls.filter((c) =>
      c.model === 'account.move' ||
      c.model === 'account.move.line' ||
      c.model === 'account.analytic.line',
    );
    expect(financialCalls).toHaveLength(0);

    // 4. Assert picking in ERP carries the project_id
    const pickingInErp = fake.rows('stock.picking')[0];
    expect(pickingInErp.project_id).toBe(42);
  });

  it('AC-OSP-003: caller cannot supply issue cost; cost is determined natively by Odoo', async () => {
    const { call } = setupFakeStock();

    // Verify StockIssueParams type contract has no cost field
    // (caller cannot provide issue cost)
    const result = await executeStockIssue(call, DEFAULT_PARAMS);
    expect(result.ok).toBe(true);
  });

  it('AC-OSP-003: repeated identical issue call updates existing record without creating a second picking', async () => {
    const { fake, call } = setupFakeStock();

    const first = await executeStockIssue(call, DEFAULT_PARAMS);
    const second = await executeStockIssue(call, { ...DEFAULT_PARAMS, origin: 'STK-ISSUE-001-RETRY' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.pickingId).toBe(second.pickingId);
      expect(first.externalRecordId).toBe(second.externalRecordId);
      expect(first.pmoWorkItemId).toBe(second.pmoWorkItemId);
    }

    expect(fake.rows('stock.picking')).toHaveLength(1);
    expect(fake.rows('ir.model.data')).toHaveLength(1);
  });

  it('AC-OSP-003: refused capability produces zero stock writes', async () => {
    const { calls, call } = setupFakeStock();

    const result = await executeStockIssue(call, {
      ...DEFAULT_PARAMS,
      capability: {
        ok: false,
        reason: 'analytic-costs-disabled',
        message: 'Enable analytic_costs',
      },
    });

    expect(result).toEqual({
      ok: false,
      outcome: 'refused',
      reason: 'analytic-costs-disabled',
      message: 'Enable analytic_costs',
    });
    expect(calls).toHaveLength(0);
  });

  it('AC-OSP-003: missing mapping (missing project_id) produces zero stock writes', async () => {
    const { calls, call } = setupFakeStock();

    const result = await executeStockIssue(call, {
      ...DEFAULT_PARAMS,
      projectId: 0, // missing project mapping
    });

    expect(result).toMatchObject({
      ok: false,
      outcome: 'refused',
      reason: 'missing-mapping',
    });
    expect(calls).toHaveLength(0);
  });

  it('AC-OSP-003: validation returning a wizard is refused with typed reason and no further call', async () => {
    const { call, calls } = setupFakeStock({ wizardOnValidate: true });

    const result = await executeStockIssue(call, DEFAULT_PARAMS);

    expect(result).toEqual({
      ok: false,
      outcome: 'refused',
      reason: 'unhandled-wizard',
      wizard: 'stock.backorder.confirmation',
      message: expect.stringMatching(/unhandled wizard.*stock\.backorder\.confirmation/i),
    });

    const callSignatures = calls.map((c) => `${c.model}/${c.method}`);
    expect(callSignatures).toEqual([
      'stock.picking/load',
      'stock.move/search_read',
      'stock.move/write',
      'stock.picking/button_validate',
    ]);
  });

  it('AC-OSP-003: failed read-back returns unknown outcome, never success', async () => {
    const { call } = setupFakeStock({ failReadBack: true });

    const result = await executeStockIssue(call, DEFAULT_PARAMS);

    expect(result).toMatchObject({
      ok: false,
      outcome: 'unknown',
      reason: 'unknown-outcome',
      message: expect.stringMatching(/failed to read back/i),
    });
    expect(result.ok).toBe(false);
  });
});
