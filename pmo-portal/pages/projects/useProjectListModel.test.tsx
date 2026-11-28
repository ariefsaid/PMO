import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import { useProjectListModel } from './useProjectListModel';

const { state } = vi.hoisted(() => ({ state: {
  projects: [] as unknown[], money: {} as Record<string, unknown>, pending: false, error: false, filter: 'All', tasks: [] as unknown[], tasksPending: false, lastOptions: undefined as unknown, tasksEnabled: undefined as unknown,
} }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: state.projects, isPending: false, isError: false }),
  useClientCompanies: () => ({ data: [] }), useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanyOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: (enabled?: boolean) => (state.tasksEnabled = enabled, { data: state.tasks, isPending: state.tasksPending, isError: false }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDeliverySummary: () => ({ data: {}, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({ useProjectsMoneyCollection: () => ({ data: state.money, isPending: state.pending, isError: state.error }) }));
vi.mock('@/src/hooks/useListWorkingSet', () => ({
  useListWorkingSet: (_l: string, o: unknown) => (state.lastOptions = o, { workingSet: { filter: state.filter, client: 'All', endClient: 'All', pm: 'All', view: 'table', q: '' }, setWorkingSet: vi.fn() }),
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

beforeEach(() => { state.projects = [safe, risky]; state.money = { risk: money }; state.pending = false; state.error = false; state.filter = 'All'; state.tasks = []; state.tasksPending = false; state.lastOptions = undefined; state.tasksEnabled = undefined; });

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
});

describe('worst first (#design-1115)', () => {
  const over = { id: 'over', name: 'Over', status: 'Ongoing Project', currency: 'USD' } as ProjectWithRefs;
  const late = { id: 'late', name: 'Late', status: 'Ongoing Project', currency: 'USD', end_date: '2000-01-31' } as ProjectWithRefs;
  const closedLate = { id: 'closed', name: 'Closed', status: 'Close Out', currency: 'USD', end_date: '2000-01-31' } as ProjectWithRefs;
  const overMoney = { ...money, budgetPosition: { ...position('pmo'), projectId: 'over', spent: '1100', consumption: '1100', usedRatio: '1.1', usedPercent: '110', atRisk: false } };

  beforeEach(() => {
    state.projects = [safe, closedLate, late, over, risky];
    state.money = { risk: money, over: overMoney };
  });

  it('orders at risk, then over budget, then late, then the rest in their own order', () => {
    const { result } = renderHook(() => useProjectListModel('Project Manager', null, t));
    expect(result.current.filtered.map((p) => p.id)).toEqual(['risk', 'over', 'late', 'safe', 'closed']);
  });

  it('counts the finding line across the whole list, and each clause filters to its rows', () => {
    const { result, rerender } = renderHook(() => useProjectListModel('Project Manager', null, t));
    expect(result.current.health).toEqual({ total: 5, atRisk: 1, overBudget: 1, late: 1 });
    state.filter = 'over-budget';
    rerender();
    expect(result.current.filtered.map((p) => p.id)).toEqual(['over']);
    state.filter = 'late';
    rerender();
    // A closed-out project is never late, the same rule the record header uses.
    expect(result.current.filtered.map((p) => p.id)).toEqual(['late']);
  });
});

describe('the Engineer default tab', () => {
  const defaultFilter = () => (state.lastOptions as { projectsDefaultFilter: string }).projectsDefaultFilter;

  it('opens on My Projects while the person has projects of their own', () => {
    state.tasks = [{ project_id: 'safe' }];
    renderHook(() => useProjectListModel('Engineer', null, t));
    expect(defaultFilter()).toBe('My Projects');
  });

  it('opens on All when the person has none, instead of an empty table', () => {
    state.tasks = [];
    renderHook(() => useProjectListModel('Engineer', null, t));
    expect(defaultFilter()).toBe('All');
  });

  it('keeps My Projects until the person\'s tasks have loaded, so a slow read never flips the tab', () => {
    state.tasksPending = true;
    renderHook(() => useProjectListModel('Engineer', null, t));
    expect(defaultFilter()).toBe('My Projects');
  });

  it('leaves other roles on All', () => {
    renderHook(() => useProjectListModel('Project Manager', null, t));
    expect(defaultFilter()).toBe('All');
  });
});

describe('own-tasks read', () => {
  it.each([['Engineer', true], ['Project Manager', false], ['Admin', false]] as const)(
    'runs the cross-project tasks read only for an Engineer (%s -> %s)',
    (role, expected) => {
      renderHook(() => useProjectListModel(role, null, t));
      expect(state.tasksEnabled).toBe(expected);
    },
  );
});
