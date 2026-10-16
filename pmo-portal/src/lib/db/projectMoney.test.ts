import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), result: { data: null as unknown, error: null as unknown } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getProjectsMoneyCollection } from './projectMoney';

beforeEach(() => {
  h.rpc.mockReset().mockImplementation(() => Promise.resolve(h.result));
  h.result = { data: null, error: null };
});

describe('getProjectsMoneyCollection (AC-S02-001..006)', () => {
  it('AC-S02-001: fetches the collection in one RPC and maps the canonical Actual and source coverage', async () => {
    h.result = { data: [{
      project_id: 'p1',
      ledger_basis: 'erp',
      actuals: { currency: 'USD', total: '125.00', as_of: '2026-10-01T00:00:00Z', excludes_restricted_rows: true,
        categories: [{ category: 'Labor', mapped: true, amount: '125.00' }, { category: 'Materials', mapped: false, amount: null }] },
      active_budget_amount: '500.00', active_budget_currency: 'USD', has_active_budget: true,
    }], error: null };
    const result = await getProjectsMoneyCollection(['p1', 'p2']);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('get_projects_money_collection', { p_project_ids: ['p1', 'p2'] });
    expect(result.p1).toEqual({
      ledgerBasis: 'erp',
      actuals: { currency: 'USD', total: '125.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: true,
        complete: false, categories: [{ category: 'Labor', mapped: true, amount: '125.00' }, { category: 'Materials', mapped: false, amount: null }] },
      activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
    });
  });

  it('AC-S02-002: preserves known zero separately from unavailable and missing active budget', async () => {
    h.result = { data: [
      { project_id: 'zero', ledger_basis: 'pmo', actuals: { currency: 'USD', total: '0', as_of: '2026-10-01', excludes_restricted_rows: false, categories: [] }, active_budget_amount: null, active_budget_currency: null, has_active_budget: false },
      { project_id: 'unknown', ledger_basis: 'erp', actuals: { currency: 'USD', total: null, as_of: null, excludes_restricted_rows: false, categories: [] }, active_budget_amount: null, active_budget_currency: null, has_active_budget: false },
    ], error: null };
    const result = await getProjectsMoneyCollection(['zero', 'unknown']);
    expect(result.zero.actuals.total).toBe('0');
    expect(result.zero.activeBudgetAmount).toBeNull();
    expect(result.unknown.actuals.total).toBeNull();
  });

  it('AC-S02-003: returns an empty map without a network request for no project IDs', async () => {
    await expect(getProjectsMoneyCollection([])).resolves.toEqual({});
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('AC-S02-004: throws a code-preserving AppError on read failure', async () => {
    h.result = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(getProjectsMoneyCollection(['p1'])).rejects.toMatchObject({ code: '42501' });
  });
});
