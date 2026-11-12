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
        complete: false, committedTotal: null, committedComplete: false,
        categories: [{ category: 'Labor', mapped: true, amount: '125.00' }, { category: 'Materials', mapped: false, amount: null }] },
      activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
    });
  });

  it('AC-1739-02: carries the PMO open commitment beside the spent total', async () => {
    h.result = { data: [{
      project_id: 'half-paid', ledger_basis: 'pmo',
      actuals: { currency: 'USD', total: '500.00', as_of: null, excludes_restricted_rows: false, complete: true,
        committed_total: '500.00', committed_complete: true, categories: [] },
      active_budget_amount: '5000.00', active_budget_currency: 'USD', has_active_budget: true,
    }], error: null };
    const result = await getProjectsMoneyCollection(['half-paid']);
    expect(result['half-paid'].actuals).toMatchObject({
      total: '500.00', complete: true, committedTotal: '500.00', committedComplete: true,
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

describe('getProjectBudgetPositions', () => {
  it('preserves exact decimal strings and nulls from the canonical set-based reader', async () => {
    const { getProjectBudgetPositions } = await import('./projectMoney');
    expect(getProjectBudgetPositions).toBeTypeOf('function');
    h.result = { data: [
      {
        project_id: 'p1',
        ledger_basis: 'pmo',
        currency: 'USD',
        budget_currency: 'USD',
        active_budget_amount: '1000.00',
        spent: '500.25',
        open_commitment: '499.75',
        consumption: '1000.00',
        complete: true,
        used_ratio: '1.00000000000000000000',
        used_percent: '100',
        consumption_variance: '0.00',
        risk_eligible: true,
        at_risk: true,
      },
      {
        project_id: 'p2',
        ledger_basis: 'erp',
        currency: 'USD',
        budget_currency: null,
        active_budget_amount: null,
        spent: null,
        open_commitment: null,
        consumption: null,
        complete: false,
        used_ratio: null,
        used_percent: null,
        consumption_variance: null,
        risk_eligible: true,
        at_risk: null,
      },
    ], error: null };

    const result = await getProjectBudgetPositions(['p1', 'p2']);

    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('project_budget_positions', { p_project_ids: ['p1', 'p2'] });
    expect(result.p1).toEqual({
      projectId: 'p1', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD',
      activeBudgetAmount: '1000.00', spent: '500.25', openCommitment: '499.75', consumption: '1000.00',
      complete: true, usedRatio: '1.00000000000000000000', usedPercent: '100', consumptionVariance: '0.00',
      riskEligible: true, atRisk: true,
    });
    expect(result.p2).toEqual({
      projectId: 'p2', ledgerBasis: 'erp', currency: 'USD', budgetCurrency: null,
      activeBudgetAmount: null, spent: null, openCommitment: null, consumption: null,
      complete: false, usedRatio: null, usedPercent: null, consumptionVariance: null,
      riskEligible: true, atRisk: null,
    });
  });

  it('does not make an RPC for an empty collection and preserves backend errors', async () => {
    const { getProjectBudgetPositions } = await import('./projectMoney');
    expect(getProjectBudgetPositions).toBeTypeOf('function');
    await expect(getProjectBudgetPositions([])).resolves.toEqual({});
    expect(h.rpc).not.toHaveBeenCalled();

    h.result = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(getProjectBudgetPositions(['p1'])).rejects.toMatchObject({ code: '42501' });
  });
});
