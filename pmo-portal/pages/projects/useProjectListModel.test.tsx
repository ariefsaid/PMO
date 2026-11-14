import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
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
const position = (ledgerBasis: 'pmo' | 'erp'): CanonicalBudgetReading => ({
  projectId: 'risk', ledgerBasis, currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000', spent: '950',
  openCommitment: ledgerBasis === 'pmo' ? '0' : null, consumption: '950', complete: true, usedRatio: '0.95',
  usedPercent: '95', consumptionVariance: '-50', riskEligible: true, atRisk: true,
});
const money = { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '950', complete: true, categories: [], excludesRestrictedRows: false },
  activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true, budgetPosition: position('pmo') };
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
    state.money = { risk: { ...money, ledgerBasis: 'erp', budgetPosition: position('erp') } };
    rerender();
    expect(result.current.filtered.map((p) => p.id)).toEqual(['risk']);
  });

  it('sorts worst-first by risk, existing over-budget variance, then local end date', () => {
    const overBudget = { ...safe, id: 'over', name: 'Over budget', end_date: '2030-12-31' } as ProjectWithRefs;
    const late = { ...safe, id: 'late', name: 'Late', end_date: '2000-01-01' } as ProjectWithRefs;
    const completedLate = { ...safe, id: 'done', name: 'Completed late', status: 'Close Out', end_date: '2000-01-01' } as ProjectWithRefs;
    state.projects = [safe, completedLate, late, overBudget, risky];
    state.money = {
      risk: money,
      over: { ...money, budgetPosition: { ...position('erp'), projectId: 'over', atRisk: false, consumptionVariance: '50' } },
    };

    const { result } = renderHook(() => useProjectListModel('Project Manager', null, t));

    expect(result.current.filtered.map((project) => project.id)).toEqual(['risk', 'over', 'late', 'safe', 'done']);
    expect(result.current.isOverBudget(overBudget)).toBe(true);
    expect(result.current.isLate(late)).toBe(true);
    expect(result.current.isLate(completedLate)).toBe(false);
  });
});
