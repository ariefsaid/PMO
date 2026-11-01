import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  rpc: vi.fn(),
  retry: vi.fn(),
  dispatch: vi.fn(),
  tables: {} as Record<string, unknown[]>,
  from: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('./budgetProjection', () => ({ retryActiveBudgetPush: h.retry }));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: h.dispatch }));

import { createDraftFromErpBudget, inspectBudgetOccupant, listRefusedOccupantAccounts, replaceErpBudget } from './budgetOccupant';

beforeEach(() => {
  h.calls.length = 0;
  h.rpc.mockReset().mockImplementation(async () => { h.calls.push('consent'); return { data: 'c1', error: null }; });
  h.retry.mockReset().mockImplementation(async () => { h.calls.push('push'); return { pushState: 'pushed' }; });
  h.dispatch.mockReset();
  h.tables = {};
  // A select chain that resolves to the rows seeded for the table, whatever filters are applied.
  h.from.mockReset().mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'like']) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: h.tables[table] ?? [], error: null });
    return chain;
  });
});

describe('AC-ECA-031 budget occupant repository', () => {
  it('replace records the consent naming the exact ERP budget BEFORE it re-runs the push for that year', async () => {
    const result = await replaceErpBudget('proj-1', { erpBudgetName: 'DESK-BUDGET', erpAccount: '5100', fiscalYear: '2026' });
    expect(h.calls).toEqual(['consent', 'push']);
    expect(h.rpc).toHaveBeenCalledWith('consent_budget_occupant_replace', {
      p_project_id: 'proj-1', p_fiscal_year: '2026', p_erp_account: '5100', p_erp_budget_name: 'DESK-BUDGET',
    });
    expect(h.retry).toHaveBeenCalledWith('proj-1', '2026');
    expect(result).toEqual({ pushState: 'pushed' });
  });

  it('a refused consent stops the replace: the push never runs', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(replaceErpBudget('proj-1', { erpBudgetName: 'DESK-BUDGET', erpAccount: '', fiscalYear: '2026' })).rejects.toBeTruthy();
    expect(h.retry).not.toHaveBeenCalled();
  });

  it('inspect and use-as-draft send the occupant request as a read, naming project, year and account', async () => {
    h.dispatch.mockResolvedValueOnce({ erpBudgetName: 'DESK-BUDGET' }).mockResolvedValueOnce({ draftVersionId: 'd1' });
    expect(await inspectBudgetOccupant('proj-1', '2026', '5100')).toEqual({ erpBudgetName: 'DESK-BUDGET', erpAccount: '5100', fiscalYear: '2026' });
    expect(await createDraftFromErpBudget('proj-1', '2026', '5100')).toBe('d1');
    expect(h.dispatch).toHaveBeenNthCalledWith(1, 'budget', 'read', {
      id: 'proj-1', erp_doc_kind: 'budget-occupant', action: 'inspect', projectId: 'proj-1', fiscalYear: '2026', erpAccount: '5100',
    });
    expect(h.dispatch).toHaveBeenNthCalledWith(2, 'budget', 'read', expect.objectContaining({ action: 'use-as-draft' }));
  });

  it('lists the refused accounts of a per-account (ERPNext 16) budget', async () => {
    h.tables.budget_version_account_erp_mirror = [{ erp_account: '5100' }, { erp_account: '5100' }, { erp_account: '5200' }];
    expect(await listRefusedOccupantAccounts('v1', '2026')).toEqual(['5100', '5200']);
  });

  it('a per-project-and-year (ERPNext 15) refusal offers the one empty-account action', async () => {
    h.tables.budget_version_erp_mirror = [{ fiscal_year: '2026' }];
    expect(await listRefusedOccupantAccounts('v1', '2026')).toEqual(['']);
  });

  it('offers no action when neither mirror records the refusal, so no request carries an empty account', async () => {
    expect(await listRefusedOccupantAccounts('v1', '2026')).toEqual([]);
  });
});
