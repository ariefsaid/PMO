import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const state = vi.hoisted(() => ({
  orgPending: false,
  milestones: [] as unknown[],
  milestonesPending: false,
  milestonesError: false,
  versionsError: false,
  versionsPending: false,
  invoices: [] as unknown[],
  invoicesPending: false,
  procurementsPending: false,
}));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'viewer-1', org_id: 'org-1' }, role: 'Project Manager' }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));
vi.mock('@/src/hooks/useBudget', () => ({
  useBudgetVersions: () => ({ data: state.versionsError ? undefined : [], isPending: state.versionsPending, isError: state.versionsError, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: state.invoices, isPending: state.invoicesPending, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: state.orgPending ? null : '2026-10-27', isPending: state.orgPending, isError: false, retry: vi.fn() }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: state.milestonesPending || state.milestonesError ? undefined : state.milestones, isPending: state.milestonesPending, isError: state.milestonesError, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectProcurements: () => ({ data: state.procurementsPending ? undefined : [], isPending: state.procurementsPending, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));

import { useProjectAttention } from '@/src/hooks/useProjectPosition';

const project = { id: 'p1', status: 'Ongoing Project', currency: 'USD', contract_value: 1_000 } as ProjectWithRefs;
const latePhase = { id: 'm1', name: 'Design', target_date: '2026-10-01', effective_pct: 40, task_count: 2 };
const overdueInvoice = { id: 'inv-1', status: 'Submitted', invoice_date: '2026-09-01', erp_due_date: '2026-10-01', erp_payment_terms_days: 30, erp_outstanding_amount: '50', grand_total: '9999' };

const run = () => renderHook(() => useProjectAttention(project, 'pm'));

beforeEach(() => {
  Object.assign(state, {
    orgPending: false, milestones: [latePhase], milestonesPending: false, milestonesError: false,
    versionsError: false, versionsPending: false, invoices: [], invoicesPending: false, procurementsPending: false,
  });
});

describe('AC-NBR-005 project attention settles per source', () => {
  it('(P) receivables pending: the phase item shows and the pending source is named', () => {
    state.invoicesPending = true;
    const { result } = run();
    expect(result.current.items.map((i) => i.key)).toEqual(['phases']);
    expect(result.current.pendingSources).toEqual(['receivables']);
    expect(result.current.isPending).toBe(true);
  });

  it('(P) a receivables item appears as soon as its source lands while others are pending', () => {
    state.procurementsPending = true;
    state.invoices = [overdueInvoice];
    const { result } = run();
    expect(result.current.items.map((i) => i.key).sort()).toEqual(['ar', 'phases']);
    expect(result.current.pendingSources).toEqual(['procurements']);
  });

  it('(P) organization day pending: no phase item is derived from an unknown day', () => {
    state.orgPending = true;
    const { result } = run();
    expect(result.current.items.some((i) => i.key === 'phases')).toBe(false);
    expect(result.current.pendingSources).toContain('today');
  });

  it('(F) budget failed: other items still return and the failure names budget', () => {
    state.versionsError = true;
    state.invoices = [overdueInvoice];
    const { result } = run();
    expect(result.current.items.map((i) => i.key).sort()).toEqual(['ar', 'phases']);
    expect(result.current.failedSources).toEqual(['budget']);
    expect(result.current.error?.what).toBe('budget');
  });

  it('AC-NBR-091 nothing is pending or failed once every source settled', () => {
    const { result } = run();
    expect(result.current.pendingSources).toEqual([]);
    expect(result.current.failedSources).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });
});
