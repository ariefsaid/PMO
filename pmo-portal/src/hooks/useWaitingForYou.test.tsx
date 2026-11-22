/**
 * fix-waiting item 1: ONE list. The home, the badge and the inbox read `useWaitingForYou`; its headline count is its list length,
 * every kind a login can decide is in it, and a kind that is unread or failed never lets a partial total pass as the whole.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const idle = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  procurements: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
  timesheets: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
  expenses: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
  invoices: { rows: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
  material: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
  leave: { data: [] as unknown[], isPending: false, isError: false, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined } as Record<string, unknown>,
  imprest: { data: { plans: [], replenishments: [] } as unknown, isPending: false, isError: false, enabled: true, refetch: () => undefined } as Record<string, unknown>,
  bast: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
  database: { data: [] as unknown[], isPending: false, isError: false, refetch: () => undefined } as Record<string, unknown>,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => h.procurements }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({ useTimesheetsAwaitingApproval: () => h.timesheets, useHasTimesheetApprovalWork: () => idle }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => h.expenses }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => h.invoices }));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useWaitingForMe: () => h.material }));
vi.mock('@/src/hooks/useLeave', () => ({ useLeaveRequests: () => h.leave }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestAwaiting: () => h.imprest }));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({ useAcceptancesAwaitingConfirmation: () => h.bast }));
vi.mock('@/src/hooks/useWaitingDecisions', () => ({ useDatabaseWaiting: () => h.database, useDecisionStanding: () => ({ data: false, isPending: false, isError: false }) }));

import { useWaitingForYou } from './useWaitingForYou';

const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const dbRow = (kind: string, id: string, createdAt: string) => ({ kind, recordId: id, projectId: null, title: id, createdAt });

beforeEach(() => {
  h.role = 'Admin';
  h.procurements = { data: [{ id: 'p1', status: 'Requested', requested_by_id: 'other', created_at: '2026-11-01T00:00:00Z', approvalRoute: null }], isPending: false, isError: false, refetch: () => undefined };
  h.timesheets = { data: [{ id: 't1', week_start_date: '2026-11-02' }], isPending: false, isError: false, refetch: () => undefined };
  h.expenses = { data: [], isPending: false, isError: false, refetch: () => undefined };
  h.invoices = { rows: [], isPending: false, isError: false, refetch: () => undefined };
  h.material = { data: [{ requestId: 'm1', stepPosition: 1, role: 'Engineer', label: 'Site lead', actingFor: null, submittedAt: '2026-11-03T00:00:00Z' }], isPending: false, isError: false, refetch: () => undefined };
  h.leave = { data: [{ id: 'l1', can_decide: true, start_date: '2026-11-04' }, { id: 'l2', can_decide: false, start_date: '2026-11-05' }], isPending: false, isError: false, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined };
  h.imprest = { data: { plans: [], replenishments: [] }, isPending: false, isError: false, enabled: true, refetch: () => undefined };
  h.bast = { data: [], isPending: false, isError: false, refetch: () => undefined };
  h.database = { data: [dbRow('daily_report', 'd1', '2026-11-06T00:00:00Z'), dbRow('work_order_issue', 'w1', '2026-11-07T00:00:00Z'), dbRow('delivery_record', 'x1', '2026-11-08T00:00:00Z')], isPending: false, isError: false, refetch: () => undefined };
});

describe('useWaitingForYou', () => {
  it('AC-WAIT-050 one list, oldest first, covering every kind the login can decide; the headline count is the list length', () => {
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.entries.map((e) => e.key)).toEqual([
      'procurement:p1', 'timesheets:t1', 'material:m1', 'leave:l1', 'daily_report:d1', 'work_order_issue:w1', 'delivery_record:x1',
    ]);
    expect(result.current.count).toBe(result.current.entries.length);
    expect(result.current.countFor('material')).toBe(1);
    expect(result.current.countFor('leave')).toBe(1);
  });

  it('AC-WAIT-051 a material-request step counts whatever the organisation\'s notification setting says (the hook never reads it)', () => {
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.entries.some((e) => e.kind === 'material')).toBe(true);
  });

  it('AC-WAIT-052 a kind that is still loading withholds the count instead of showing a partial total', () => {
    h.database = { data: undefined, isPending: true, isError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(result.current.pendingKinds).toContain('daily_report');
  });

  it('AC-WAIT-053 a failed kind reports the error and no count, never 0', () => {
    h.material = { data: undefined, isPending: false, isError: true, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.isError).toBe(true);
    expect(result.current.failedKinds).toEqual(['material']);
    expect(result.current.count).toBeUndefined();
  });

  it('AC-WAIT-050 withholds the total while enabled leave requests are still loading', () => {
    h.leave = { data: undefined, isPending: true, isError: false, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.pendingKinds).toContain('leave');
  });

  it('AC-WAIT-050 withholds the total when the enabled leave request read fails', () => {
    h.leave = { data: undefined, isPending: false, isError: true, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.failedKinds).toContain('leave');
  });

  it('AC-WAIT-050 withholds the total while applicable site-cash decisions are loading', () => {
    h.imprest = { data: undefined, isPending: true, isError: false, enabled: true, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.pendingKinds).toContain('imprest');
  });

  it('AC-WAIT-050 withholds the total when the applicable site-cash read fails', () => {
    h.imprest = { data: undefined, isPending: false, isError: true, enabled: true, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.failedKinds).toContain('imprest');
  });

  it('AC-WAIT-050 does not wait on site-cash reads for a role that cannot decide site-cash work', () => {
    h.role = 'Engineer';
    h.imprest = { data: undefined, isPending: true, isError: false, enabled: true, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBe(result.current.entries.length);
    expect(result.current.pendingKinds).not.toContain('imprest');
  });

  it('AC-WAIT-050 does not let a disabled leave query block the total while React Query reports it pending', () => {
    h.leave = { data: undefined, isPending: true, isError: false, enabled: false, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBe(result.current.entries.length);
    expect(result.current.pendingKinds).not.toContain('leave');
  });

  it('AC-WAIT-050 moves leave from a pending prerequisite through its enabled read to the complete total', () => {
    h.leave = { data: undefined, isPending: true, isError: false, enabled: false, prerequisitePending: true, prerequisiteError: false, refetch: () => undefined };
    const { result, rerender } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.pendingKinds).toContain('leave');

    h.leave = { data: undefined, isPending: true, isError: false, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined };
    rerender();
    expect(result.current.count).toBeUndefined();
    expect(result.current.pendingKinds).toContain('leave');

    h.leave = { data: [], isPending: false, isError: false, enabled: true, prerequisitePending: false, prerequisiteError: false, refetch: () => undefined };
    rerender();
    expect(result.current.count).toBe(result.current.entries.length);
    expect(result.current.pendingKinds).not.toContain('leave');
  });

  it('AC-WAIT-050 treats an unknown leave prerequisite error as a failed read', () => {
    h.leave = { data: undefined, isPending: false, isError: false, enabled: false, prerequisitePending: false, prerequisiteError: true, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.failedKinds).toContain('leave');
  });

  it('AC-WAIT-054 an Engineer who is a material approver or a delivery requester is counted (no role list decides who has a list)', () => {
    h.role = 'Engineer';
    h.procurements = { data: [], isPending: false, isError: false, refetch: () => undefined };
    h.timesheets = { data: [], isPending: false, isError: false, refetch: () => undefined };
    h.database = { data: [dbRow('delivery_record', 'x1', '2026-11-08T00:00:00Z')], isPending: false, isError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.entries.map((e) => e.kind)).toEqual(['material', 'leave', 'delivery_record']);
    expect(result.current.count).toBe(3);
  });

  it('AC-WAIT-055 the same record is never counted twice', () => {
    h.database = { data: [dbRow('daily_report', 'd1', '2026-11-06T00:00:00Z'), dbRow('daily_report', 'd1', '2026-11-06T00:00:00Z')], isPending: false, isError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.entries.filter((e) => e.key === 'daily_report:d1')).toHaveLength(1);
  });

  // Client acceptance (BAST) is its own kind from its own caller-filtered read — not `delivery_record`, and not the
  // database-listed kinds. It joins the SAME population and the SAME headline count all three surfaces read.
  const bastRow = (id: string, workOrderId: string, preparedAt: string) => ({
    id, project_id: 'p1', work_order_id: workOrderId, acceptance_date: '2026-11-20', is_final: false, prepared_by: 'pm-1', prepared_at: preparedAt,
  });

  it('AC-WAIT-056 a client acceptance waiting on the viewer joins the ONE list and its count', () => {
    h.bast = { data: [bastRow('acc-1', 'wo-9', '2026-11-09T00:00:00Z')], isPending: false, isError: false, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.entries.some((entry) => entry.key === 'work_order_acceptance:acc-1')).toBe(true);
    expect(result.current.countFor('work_order_acceptance')).toBe(1);
    expect(result.current.entries.find((entry) => entry.key === 'work_order_acceptance:acc-1')?.kind).toBe('work_order_acceptance');
    // The purchase-receipt kind keeps its own entry: a BAST is never counted as a delivery record.
    expect(result.current.countFor('delivery_record')).toBe(1);
    expect(result.current.count).toBe(result.current.entries.length);
  });

  it('AC-WAIT-056 withholds the total while the applicable BAST read is unresolved, and never for a role it does not apply to', () => {
    h.bast = { data: undefined, isPending: true, isError: false, refetch: () => undefined };
    const { result, rerender } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.count).toBeUndefined();
    expect(result.current.pendingKinds).toContain('work_order_acceptance');
    h.role = 'Engineer';
    rerender();
    expect(result.current.pendingKinds).not.toContain('work_order_acceptance');
    expect(result.current.count).toBe(result.current.entries.length);
  });

  it('AC-WAIT-056 a failed applicable BAST read reports the error and no count, never a settled zero', () => {
    h.bast = { data: undefined, isPending: false, isError: true, refetch: () => undefined };
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.failedKinds).toContain('work_order_acceptance');
    expect(result.current.isError).toBe(true);
    expect(result.current.count).toBeUndefined();
  });

  it('AC-WAIT-056 the entry leaves the list when a confirm or withdraw refetch no longer returns it', () => {
    h.bast = { data: [bastRow('acc-1', 'wo-9', '2026-11-09T00:00:00Z')], isPending: false, isError: false, refetch: () => undefined };
    const { result, rerender } = renderHook(() => useWaitingForYou(), { wrapper });
    expect(result.current.countFor('work_order_acceptance')).toBe(1);
    h.bast = { data: [], isPending: false, isError: false, refetch: () => undefined };
    rerender();
    expect(result.current.countFor('work_order_acceptance')).toBe(0);
    expect(result.current.count).toBe(result.current.entries.length);
  });
});
