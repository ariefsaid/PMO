/**
 * AC-BUD-050/053 — src/lib/repositories/budgetProjection.ts: the read seam for PMO's forward view
 * (`get_budget_projection`) + the CRUD seam for the category↔account map + the ETC upsert.
 *
 * Mirrors src/lib/db/budgets.test.ts's vi.hoisted builder pattern (mockRpc for the projection RPC,
 * mockFrom chain for the map CRUD + the ETC upsert).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom, mockSelect, mockEq, mockOrder, mockUpdate, mockDelete, mockInsert, mockUpsert, mockSingle } =
  vi.hoisted(() => {
    const mockRpc = vi.fn();
    const mockFrom = vi.fn();
    const mockSelect = vi.fn();
    const mockEq = vi.fn();
    const mockOrder = vi.fn();
    const mockUpdate = vi.fn();
    const mockDelete = vi.fn();
    const mockInsert = vi.fn();
    const mockUpsert = vi.fn();
    const mockSingle = vi.fn();
    return { mockRpc, mockFrom, mockSelect, mockEq, mockOrder, mockUpdate, mockDelete, mockInsert, mockUpsert, mockSingle };
  });

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

// HIGH-D: the retry seam delegates to the ONE budget push in the DAL — mocked here so this file proves
// the SEAM's own job (resolve the project's Active version from DB truth, refuse when there is none).
const { retryBudgetPushMock } = vi.hoisted(() => ({ retryBudgetPushMock: vi.fn() }));
vi.mock('@/src/lib/db/budgets', () => ({ retryBudgetPush: retryBudgetPushMock }));

import {
  fetchBudgetProjection,
  listBudgetFiscalYears,
  retryActiveBudgetPush,
  listBudgetCategoryAccountMap,
  createBudgetCategoryAccountMapRow,
  updateBudgetCategoryAccountMapRow,
  deleteBudgetCategoryAccountMapRow,
  upsertBudgetProjectionEtc,
} from './budgetProjection';
import { AppError } from '@/src/lib/appError';

function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockRpc.mockReturnValue(builder);
  return builder;
}

function makeFromBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = mockSelect.mockReturnValue(builder);
  builder.eq = mockEq.mockReturnValue(builder);
  builder.order = mockOrder.mockReturnValue(builder);
  builder.update = mockUpdate.mockReturnValue(builder);
  builder.delete = mockDelete.mockReturnValue(builder);
  builder.insert = mockInsert.mockReturnValue(builder);
  builder.upsert = mockUpsert.mockReturnValue(builder);
  builder.single = mockSingle.mockReturnValue(builder);
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockOrder.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockInsert.mockReset();
  mockUpsert.mockReset();
  mockSingle.mockReset();
});

describe('fetchBudgetProjection (AC-BUD-050/053)', () => {
  it('calls the RPC with the project + fiscal year and maps snake_case → camelCase, numeric strings → numbers', async () => {
    makeRpcBuilder({
      data: [
        {
          category: 'Labor',
          pmo_budget_amount: 100000,
          actuals_to_date: 40000,
          pmo_etc: 35000,
          projected_final_cost: 75000,
          projected_variance: 25000,
          projected_utilization: 0.75,
          push_state: 'pushed',
          push_error: null,
        },
      ],
      error: null,
    });

    const rows = await fetchBudgetProjection('proj-1', '2026');

    expect(mockRpc).toHaveBeenCalledWith('get_budget_projection', {
      p_project_id: 'proj-1',
      p_fiscal_year: '2026',
    });
    expect(rows).toEqual([
      {
        category: 'Labor',
        pmoBudgetAmount: 100000,
        actualsToDate: 40000,
        pmoEtc: 35000,
        projectedFinalCost: 75000,
        projectedVariance: 25000,
        projectedUtilization: 0.75,
        pushState: 'pushed',
        pushError: null,
      },
    ]);
  });

  it('a null pmo_budget_amount (no budget line for the category) stays null — never coerced to 0', async () => {
    makeRpcBuilder({
      data: [
        {
          category: 'Materials',
          pmo_budget_amount: null,
          actuals_to_date: 500,
          pmo_etc: 0,
          projected_final_cost: 500,
          projected_variance: -500,
          projected_utilization: null,
          push_state: null,
          push_error: null,
        },
      ],
      error: null,
    });

    const rows = await fetchBudgetProjection('proj-1', '2026');
    expect(rows[0].pmoBudgetAmount).toBeNull();
    expect(rows[0].projectedUtilization).toBeNull();
  });

  it('an empty result (no versions/actuals/ETC yet) resolves to an empty array, not a throw', async () => {
    makeRpcBuilder({ data: [], error: null });
    expect(await fetchBudgetProjection('proj-1', '2026')).toEqual([]);
  });

  it('throws an AppError (code preserved) on an RPC error — e.g. cross-org / RLS 42501', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(fetchBudgetProjection('proj-1', '2026')).rejects.toMatchObject({ code: '42501' });
  });
});

// ── H-4 (audit r3) — the fiscal year is the CLIENT'S, read from data that exists ──────────────────
describe('listBudgetFiscalYears (H-4)', () => {
  it('H-4 returns the fiscal years actually on record for the project, marking the Active push year', async () => {
    makeRpcBuilder({
      data: [
        { fiscal_year: '2025-2026', is_active_push: true },
        { fiscal_year: '2024-2025', is_active_push: false },
      ],
      error: null,
    });

    const years = await listBudgetFiscalYears('proj-1');

    expect(mockRpc).toHaveBeenCalledWith('list_budget_fiscal_years', { p_project_id: 'proj-1' });
    expect(years).toEqual([
      { fiscalYear: '2025-2026', isActivePush: true },
      { fiscalYear: '2024-2025', isActivePush: false },
    ]);
  });

  it('H-4 a project with no fiscal year on record resolves to an empty list, never a synthesized year', async () => {
    makeRpcBuilder({ data: [], error: null });
    expect(await listBudgetFiscalYears('proj-1')).toEqual([]);
  });

  it('H-4 throws an AppError (code preserved) on an RPC error — never falls back to a guess', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(listBudgetFiscalYears('proj-1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('fetchBudgetProjection with no fiscal year selected (H-4)', () => {
  it('H-4 sends the empty fiscal year, which matches no ERP calendar — the FY-scoped figures stay empty', async () => {
    makeRpcBuilder({ data: [], error: null });
    await fetchBudgetProjection('proj-1', null);
    expect(mockRpc).toHaveBeenCalledWith('get_budget_projection', {
      p_project_id: 'proj-1',
      p_fiscal_year: '',
    });
  });
});

describe('listBudgetCategoryAccountMap (AC-BUD-011/012 admin surface)', () => {
  it('lists the org map rows, ordered by category, snake_case → camelCase', async () => {
    makeFromBuilder({
      data: [{ category: 'Labor', erp_account: '5100 - Direct Costs' }],
      error: null,
    });
    const rows = await listBudgetCategoryAccountMap();
    expect(mockFrom).toHaveBeenCalledWith('budget_category_account_map');
    expect(rows).toEqual([{ category: 'Labor', erpAccount: '5100 - Direct Costs' }]);
  });
});

describe('createBudgetCategoryAccountMapRow / updateBudgetCategoryAccountMapRow / deleteBudgetCategoryAccountMapRow', () => {
  it('creates a new category→account mapping', async () => {
    makeFromBuilder({ data: { category: 'Labor', erp_account: '5100 - Direct Costs' }, error: null });
    const row = await createBudgetCategoryAccountMapRow('Labor', '5100 - Direct Costs');
    expect(mockInsert).toHaveBeenCalledWith({ category: 'Labor', erp_account: '5100 - Direct Costs' });
    expect(row).toEqual({ category: 'Labor', erpAccount: '5100 - Direct Costs' });
  });

  it('the bijection violation (23505) surfaces as an AppError with the code preserved, not swallowed', async () => {
    makeFromBuilder({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "budget_category_account_map_org_id_erp_account_key"', code: '23505' },
    });
    await expect(createBudgetCategoryAccountMapRow('Overheads', '5100 - Direct Costs')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(createBudgetCategoryAccountMapRow('Overheads', '5100 - Direct Costs')).rejects.toBeInstanceOf(AppError);
  });

  it('updates an existing mapping by category', async () => {
    makeFromBuilder({ data: { category: 'Labor', erp_account: '5100 - New Account' }, error: null });
    const row = await updateBudgetCategoryAccountMapRow('Labor', '5100 - New Account');
    expect(mockUpdate).toHaveBeenCalledWith({ erp_account: '5100 - New Account' });
    expect(mockEq).toHaveBeenCalledWith('category', 'Labor');
    expect(row).toEqual({ category: 'Labor', erpAccount: '5100 - New Account' });
  });

  it('deletes (unmaps) a category', async () => {
    makeFromBuilder({ data: null, error: null });
    await deleteBudgetCategoryAccountMapRow('Contingency');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('category', 'Contingency');
  });
});

describe('upsertBudgetProjectionEtc (Finance-authored ETC, OD-BUDGET-3)', () => {
  it('upserts pmo_etc for (project, fiscal_year, category)', async () => {
    makeFromBuilder({ data: null, error: null });
    await upsertBudgetProjectionEtc('proj-1', '2026', 'Labor', 35000);
    expect(mockFrom).toHaveBeenCalledWith('budget_projections');
    expect(mockUpsert).toHaveBeenCalledWith(
      { project_id: 'proj-1', fiscal_year: '2026', category: 'Labor', pmo_etc: 35000 },
      { onConflict: 'org_id,project_id,fiscal_year,category' },
    );
  });

  it('throws an AppError on a write failure (e.g. Engineer denied, 42501)', async () => {
    makeFromBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(upsertBudgetProjectionEtc('proj-1', '2026', 'Materials', 100)).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('retryActiveBudgetPush (HIGH-D — the operator-invokable recovery)', () => {
  it('resolves the project\'s ACTIVE version from DB truth and re-drives its push', async () => {
    const builder = makeFromBuilder({ data: { id: 'ver-active' }, error: null });
    (builder as Record<string, unknown>).maybeSingle = () => Promise.resolve({ data: { id: 'ver-active' }, error: null });
    retryBudgetPushMock.mockResolvedValue({ pushState: 'pushed' });

    await expect(retryActiveBudgetPush('proj-1')).resolves.toEqual({ pushState: 'pushed' });
    expect(mockFrom).toHaveBeenCalledWith('budget_versions');
    expect(mockEq).toHaveBeenCalledWith('status', 'Active');
    expect(retryBudgetPushMock).toHaveBeenCalledWith('ver-active');
  });

  it('refuses (never invents a push) when the project has no Active version at all', async () => {
    const builder = makeFromBuilder({ data: null, error: null });
    (builder as Record<string, unknown>).maybeSingle = () => Promise.resolve({ data: null, error: null });
    await expect(retryActiveBudgetPush('proj-1')).rejects.toThrow(/no Active budget version/i);
    expect(retryBudgetPushMock).not.toHaveBeenCalled();
  });
});
