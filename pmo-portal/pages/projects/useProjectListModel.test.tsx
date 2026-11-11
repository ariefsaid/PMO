import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProjectListModel } from './useProjectListModel';

const { state } = vi.hoisted(() => ({ state: {
  projects: [] as unknown[], money: {} as Record<string, unknown>, pending: false, error: false, filter: 'All',
} }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isPending: false, isError: false }),
  useClientCompanies: () => ({ data: [] }), useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDeliverySummary: () => ({ data: {}, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => ({ data: state.money, isPending: state.pending, isError: state.error }) }));
vi.mock('@/src/hooks/useListWorkingSet', () => ({
  useListWorkingSet: () => ({ workingSet: { filter: state.filter, client: 'All', endClient: 'All', pm: 'All', view: 'table', q: '' }, setWorkingSet: vi.fn() }),
  useUrlSearchInput: () => ['', vi.fn()],
}));
vi.mock('@/src/hooks/useProjectView', async (original) => ({ ...(await original<typeof import('@/src/hooks/useProjectView')>()), readProjectView: () => 'table', writeProjectView: vi.fn() }));

const safe = { id: 'safe', name: 'Safe', status: 'Ongoing Project', currency: 'USD' } as ProjectWithRefs;
const risky = { id: 'risk', name: 'Risk', status: 'Ongoing Project', currency: 'USD' } as ProjectWithRefs;
const money = { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '950', complete: true, categories: [], excludesRestrictedRows: false },
  activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true };
const t = ((key: string, fallback: string) => fallback || key) as TFunction;

beforeEach(() => { state.projects = [safe, risky]; state.money = { risk: money }; state.pending = false; state.error = false; state.filter = 'All'; });

describe('project risk classification', () => {
  it.each(['error', 'pending'] as const)('does not sort or filter retained data as risk when the read is %s', (flag) => {
    const { result, rerender } = renderHook(() => useProjectListModel('Project Manager', null, t));
    expect(result.current.filtered.map((p) => p.id)).toEqual(['risk', 'safe']);
    state[flag] = true;
    rerender();
    expect(result.current.filtered.map((p) => p.id)).toEqual(['safe', 'risk']);
    expect(result.current.isAtRiskActual(risky)).toBe(false);
    state.filter = 'at-risk';
    rerender();
    expect(result.current.filtered).toEqual([]);
  });

  it('does not classify the same ID after a currency change, while current PMO and ERP positions remain eligible', () => {
    const { result, rerender } = renderHook(() => useProjectListModel('Project Manager', null, t));
    expect(result.current.isAtRiskActual(risky)).toBe(true);
    const changed = { ...risky, currency: 'EUR' };
    state.projects = [safe, changed];
    rerender();
    expect(result.current.isAtRiskActual(changed)).toBe(false);
    expect(result.current.filtered.map((p) => p.id)).toEqual(['safe', 'risk']);
    state.filter = 'at-risk';
    rerender();
    expect(result.current.filtered).toEqual([]);
    state.projects = [safe, risky];
    state.money = { risk: { ...money, ledgerBasis: 'erp' } };
    rerender();
    expect(result.current.filtered.map((p) => p.id)).toEqual(['risk']);
  });
});
