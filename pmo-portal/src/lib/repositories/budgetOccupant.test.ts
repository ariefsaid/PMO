import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  rpc: vi.fn(),
  retry: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('./budgetProjection', () => ({ retryActiveBudgetPush: h.retry }));
vi.mock('@/src/lib/adapterSeam/dispatchClient', () => ({ dispatchDomainCommand: h.dispatch }));

import { createDraftFromErpBudget, inspectBudgetOccupant, replaceErpBudget } from './budgetOccupant';

beforeEach(() => {
  h.calls.length = 0;
  h.rpc.mockReset().mockImplementation(async () => { h.calls.push('consent'); return { data: 'c1', error: null }; });
  h.retry.mockReset().mockImplementation(async () => { h.calls.push('push'); return { pushState: 'pushed' }; });
  h.dispatch.mockReset();
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
});
