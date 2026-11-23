import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'Admin' as string,
  leaveSettings: vi.fn(),
  leaveVisible: vi.fn(),
  peopleModuleRead: vi.fn(),
}));

vi.mock('@/src/lib/repositories/leave', () => ({
  leaveRepository: { settings: h.leaveSettings, visible: h.leaveVisible },
}));
vi.mock('@/src/lib/repositories/orgSwitches', () => ({
  orgSwitchKey: (orgId: string | undefined, key: string) => ['org-setting', orgId, key],
  orgSwitchRepository: { read: h.peopleModuleRead },
  orgSwitch: () => ({ refreshes: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'approver-1', org_id: 'org-1' }, role: h.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => idleRead }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => idleRead,
  useHasTimesheetApprovalWork: () => idleRead,
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => idleRead }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, enabled: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useWaitingForMe: () => idleRead }));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestAwaiting: () => ({ data: { plans: [], replenishments: [] }, isPending: false, isError: false, enabled: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderAcceptances', () => ({
  useAcceptancesAwaitingConfirmation: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMedicalRelease', () => ({ useMedicalReleases: () => idleRead }));
vi.mock('@/src/hooks/useWaitingDecisions', () => ({
  useDatabaseWaiting: () => idleRead,
  useDecisionStanding: () => ({ data: false, isPending: false, isError: false }),
}));

import { AuthContext } from '@/src/auth/AuthContext';
import { useWaitingForYou } from './useWaitingForYou';

const idleRead = { data: [], isPending: false, isError: false, refetch: vi.fn() };
const settingsKey = ['leave-settings', 'org-1'] as const;
const peopleModuleKey = ['org-setting', 'org-1', 'modulePeopleCrews'] as const;
const row = (id: string, start_date: string) => ({ id, start_date, can_decide: true });

beforeEach(() => {
  h.role = 'Admin';
  h.leaveSettings.mockReset().mockResolvedValue({ enabled: true });
  h.leaveVisible.mockReset().mockResolvedValue([row('leave-1', '2026-11-01')]);
  h.peopleModuleRead.mockReset().mockResolvedValue(true);
});

describe('useWaitingForYou with the shipped leave hook', () => {
  it('removes cached leave decisions while the setting or people module is off, then counts fresh reads after re-enable', async () => {
    h.leaveSettings
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce({ enabled: true });
    h.peopleModuleRead
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    h.leaveVisible
      .mockResolvedValueOnce([row('leave-1', '2026-11-01')])
      .mockResolvedValueOnce([row('leave-2', '2026-11-02')])
      .mockResolvedValueOnce([row('leave-3', '2026-11-03')]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthContext.Provider value={{ currentUser: { id: 'approver-1', org_id: 'org-1' } } as never}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    );
    const { result } = renderHook(() => useWaitingForYou(), { wrapper });

    await waitFor(() => expect(client.getQueryData(peopleModuleKey)).toBe(true));
    await waitFor(() => expect(client.getQueryData(settingsKey)).toEqual({ enabled: true }));
    await waitFor(() => expect(result.current.entries.map((entry) => entry.key)).toContain('leave:leave-1'));
    expect(h.peopleModuleRead).toHaveBeenCalledWith('modulePeopleCrews');
    expect(h.leaveSettings).toHaveBeenCalledOnce();
    expect(result.current.count).toBe(result.current.entries.length);

    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKey });
    });
    await waitFor(() => expect(client.getQueryData(settingsKey)).toEqual({ enabled: false }));
    await waitFor(() => expect(result.current.entries.some((entry) => entry.kind === 'leave')).toBe(false));
    expect(result.current.count).toBe(result.current.entries.length);
    expect(result.current.pendingKinds).not.toContain('leave');
    expect(result.current.failedKinds).not.toContain('leave');

    await act(async () => {
      await client.invalidateQueries({ queryKey: settingsKey });
    });
    await waitFor(() => expect(client.getQueryData(settingsKey)).toEqual({ enabled: true }));
    await waitFor(() => expect(result.current.entries.map((entry) => entry.key)).toContain('leave:leave-2'));
    expect(result.current.entries.some((entry) => entry.key === 'leave:leave-1')).toBe(false);
    expect(result.current.count).toBe(result.current.entries.length);

    await act(async () => {
      await client.invalidateQueries({ queryKey: peopleModuleKey });
    });
    await waitFor(() => expect(client.getQueryData(peopleModuleKey)).toBe(false));
    await waitFor(() => expect(result.current.entries.some((entry) => entry.kind === 'leave')).toBe(false));
    expect(result.current.count).toBe(result.current.entries.length);
    expect(result.current.pendingKinds).not.toContain('leave');
    expect(result.current.failedKinds).not.toContain('leave');

    await act(async () => {
      await client.invalidateQueries({ queryKey: peopleModuleKey });
    });
    await waitFor(() => expect(client.getQueryData(peopleModuleKey)).toBe(true));
    await waitFor(() => expect(result.current.entries.map((entry) => entry.key)).toContain('leave:leave-3'));
    expect(result.current.entries.some((entry) => entry.key === 'leave:leave-2')).toBe(false);
    expect(result.current.count).toBe(result.current.entries.length);
    expect(h.leaveVisible).toHaveBeenCalledTimes(3);
  });
});
