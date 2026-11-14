import { describe, expect, it } from 'vitest';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { checkStockCapability } from './capability.ts';

const READ_METHODS = ['search_read', 'read', 'search', 'fields_get', 'formatted_read_group', 'search_count'];
const WRITE_METHODS = ['create', 'write', 'unlink', 'action_confirm', 'button_validate', 'action_post'];

function setupFakeStockOdoo(options: {
  modules?: Array<{ id: number; name: string; state: string }>;
  pickingTypes?: Array<{ id: number; name: string; code?: string; company_id: unknown; analytic_costs?: boolean }>;
  fault?: 'transport';
}) {
  const fake = createFakeOdoo({ key: 'test-key' });
  if (options.modules) fake.seed('ir.module.module', options.modules);
  if (options.pickingTypes) fake.seed('stock.picking.type', options.pickingTypes);
  if (options.fault) fake.failNext(options.fault);
  const call = bindCall({
    baseUrl: 'https://odoo.example.test',
    apiKey: 'test-key',
    database: 'db1',
    companyId: 1,
    fetchImpl: fake.fetch,
  });
  return { fake, call };
}

function assertZeroWriteCalls(calls: Array<{ model?: string; method?: string }>) {
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => READ_METHODS.includes(c.method ?? ''))).toBe(true);
  expect(calls.some((c) => WRITE_METHODS.includes(c.method ?? ''))).toBe(false);
}

const ALL_MODULES_INSTALLED = [
  { id: 1, name: 'stock', state: 'installed' },
  { id: 2, name: 'stock_account', state: 'installed' },
  { id: 3, name: 'project_stock_account', state: 'installed' },
];

describe('checkStockCapability (AC-OSP-001)', () => {
  it('AC-OSP-001: everything present and the project-cost flag on -> success', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: ALL_MODULES_INSTALLED,
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: true },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({ ok: true });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: stock missing', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: [
        { id: 2, name: 'stock_account', state: 'installed' },
        { id: 3, name: 'project_stock_account', state: 'installed' },
      ],
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: true },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'missing-module-stock',
      message: expect.stringMatching(/install.*"stock"/i),
    });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: stock_account missing', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: [
        { id: 1, name: 'stock', state: 'installed' },
        { id: 3, name: 'project_stock_account', state: 'installed' },
      ],
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: true },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'missing-module-stock_account',
      message: expect.stringMatching(/install.*"stock_account"/i),
    });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: project_stock_account missing', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: [
        { id: 1, name: 'stock', state: 'installed' },
        { id: 2, name: 'stock_account', state: 'installed' },
      ],
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: true },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'missing-module-project_stock_account',
      message: expect.stringMatching(/install.*"project_stock_account"/i),
    });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: flag off on the chosen operation type', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: ALL_MODULES_INSTALLED,
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: false },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'analytic-costs-disabled',
      message: expect.stringMatching(/switch on project costs.*"Delivery Orders".*2/i),
    });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: operation type not found', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: ALL_MODULES_INSTALLED,
      pickingTypes: [
        { id: 99, name: 'Internal Transfers', code: 'internal', company_id: [1, 'Main Co'], analytic_costs: true },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'operation-type-not-found',
      message: expect.stringMatching(/operation type with ID 2 was not found/i),
    });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: operation type belongs to another company', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: ALL_MODULES_INSTALLED,
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [42, 'Other Co'], analytic_costs: true },
      ],
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'operation-type-wrong-company',
      message: expect.stringMatching(/belongs to company 42, not configured company 1/i),
    });
    assertZeroWriteCalls(fake.calls);
  });

  it('AC-OSP-001: a read fails', async () => {
    const { fake, call } = setupFakeStockOdoo({
      modules: ALL_MODULES_INSTALLED,
      pickingTypes: [
        { id: 2, name: 'Delivery Orders', code: 'outgoing', company_id: [1, 'Main Co'], analytic_costs: true },
      ],
      fault: 'transport',
    });

    const result = await checkStockCapability(call, 1, 2);

    expect(result).toEqual({
      ok: false,
      reason: 'read-failed',
      message: expect.stringMatching(/failed to read stock capability from odoo/i),
    });
    assertZeroWriteCalls(fake.calls);
  });
});
