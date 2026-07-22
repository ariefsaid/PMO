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
  fetchBudgetPushStatus,
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

  // ⚑ C-1/C-2 (rendered Discover pass, 2026-07-22) — NULL is LOAD-BEARING on every money column: it is
  // the difference between "zero" and "not knowable". The old mapper coerced with `?? 0`, which
  // re-invents the exact defect the RPC change removed, one layer up.
  it('C-1 preserves a NULL actuals figure — it means UNOBTAINABLE, never 0', async () => {
    makeRpcBuilder({
      data: [
        {
          category: 'Equipment',
          pmo_budget_amount: 20000,
          actuals_to_date: null,
          pmo_etc: 0,
          projected_final_cost: null,
          projected_variance: null,
          projected_utilization: null,
        },
      ],
      error: null,
    });

    const rows = await fetchBudgetProjection('proj-1', '2026');
    expect(rows[0].actualsToDate).toBeNull();
    expect(rows[0].projectedFinalCost).toBeNull();
    expect(rows[0].projectedVariance).toBeNull();
    expect(rows[0].projectedUtilization).toBeNull();
    // the PMO-owned halves are still stated — they never depended on the ERP map
    expect(rows[0].pmoBudgetAmount).toBe(20000);
  });

  it('C-1 a real, computed zero survives as 0 — the distinction is the whole point', async () => {
    makeRpcBuilder({
      data: [
        {
          category: 'Labor',
          pmo_budget_amount: 10000,
          actuals_to_date: 0,
          pmo_etc: 0,
          projected_final_cost: 0,
          projected_variance: 10000,
          projected_utilization: 0,
        },
      ],
      error: null,
    });

    const rows = await fetchBudgetProjection('proj-1', '2026');
    expect(rows[0].actualsToDate).toBe(0);
    expect(rows[0].projectedUtilization).toBe(0);
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// C-5 — the push status moved to its own PROJECT-grained read. It used to ride on every projection
// cell and be read off `rows[0]`, which made a project-wide money alarm hostage to the grid having
// rows at all (C-3 makes the empty grid reachable) and left no room for `erp_budget_name`.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('fetchBudgetPushStatus (C-5)', () => {
  it('C-5 reads the status at PROJECT grain — no fiscal year is passed, so no year can hide it', async () => {
    makeRpcBuilder({ data: [{ push_state: 'pushed', push_error: null, unmapped_categories: null,
                              erp_budget_name: 'BUDGET-0007', fiscal_year: '2025-2026', pushed_at: '2026-07-01T00:00:00Z' }],
                     error: null });
    const status = await fetchBudgetPushStatus('proj-1');
    expect(mockRpc).toHaveBeenCalledWith('get_budget_push_status', { p_project_id: 'proj-1' });
    expect(status.pushState).toBe('pushed');
    expect(status.erpBudgetName).toBe('BUDGET-0007');
    expect(status.fiscalYear).toBe('2025-2026');
  });

  // ⚑ NEW-6 (audit round 4) — `unmapped_categories` was WRITE-ONLY. The dispatch gate persists the NAMES
  // of the categories that blocked the push (FR-BUD-113 collected them precisely so the operator gets a
  // to-do list), but the read seam dropped them on the floor, so the screen could only ever show the bare
  // code `budget-category-unmapped`. The code stays in `pushError`; the names ride alongside.
  it('NEW-6 surfaces the recorded unmapped_categories alongside the push_error CODE', async () => {
    makeRpcBuilder({ data: [{ push_state: 'failed', push_error: 'budget-category-unmapped',
                              unmapped_categories: ['Materials', 'Subcontract'],
                              erp_budget_name: null, fiscal_year: '2026', pushed_at: null }], error: null });
    const status = await fetchBudgetPushStatus('proj-1');
    expect(status.unmappedCategories).toEqual(['Materials', 'Subcontract']);
    expect(status.pushError).toBe('budget-category-unmapped'); // the CODE is never replaced by the names
  });

  it('NEW-6 a failure unrelated to the map reports null categories, never a fabricated empty list', async () => {
    makeRpcBuilder({ data: [{ push_state: 'failed', push_error: 'external-unreachable', unmapped_categories: null,
                              erp_budget_name: null, fiscal_year: '2026', pushed_at: null }], error: null });
    expect((await fetchBudgetPushStatus('proj-1')).unmappedCategories).toBeNull();
  });

  it('C-5 an org with no ERP tier resolves to an all-null status, never a throw', async () => {
    makeRpcBuilder({ data: [], error: null });
    const status = await fetchBudgetPushStatus('proj-1');
    expect(status.pushState).toBeNull();
    expect(status.erpBudgetName).toBeNull();
  });

  it('throws an AppError (code preserved) on an RPC error', async () => {
    makeRpcBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(fetchBudgetPushStatus('proj-1')).rejects.toMatchObject({ code: '42501' });
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
