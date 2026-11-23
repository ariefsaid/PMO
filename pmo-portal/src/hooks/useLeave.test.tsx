import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: vi.fn(), types: vi.fn(), visible: vi.fn(), onDate: vi.fn(),
  submit: vi.fn(), decide: vi.fn(), cancel: vi.fn(), setSettings: vi.fn(), createType: vi.fn(), archiveType: vi.fn(),
  peopleModuleOn: true,
}));
vi.mock('@/src/lib/repositories/leave', () => ({ leaveRepository: h }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useModuleOn: () => h.peopleModuleOn }));
import { AuthContext } from '@/src/auth/AuthContext';
const authWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { currentUser: { org_id: 'org-1' } } as never;
  return ({ children }: { children: React.ReactNode }) => (
    <AuthContext.Provider value={auth}><QueryClientProvider client={client}>{children}</QueryClientProvider></AuthContext.Provider>
  );
};
import { useLeaveMutations, useLeaveOnDate, useLeaveRequests, useLeaveSettings, useLeaveSettingsMutations, useLeaveTypes } from './useLeave';

beforeEach(() => {
  h.peopleModuleOn = true;
  for (const m of Object.values(h)) if (typeof m === 'function') m.mockReset().mockResolvedValue(null);
});

it('settings, types, requests and the day read resolve through the repository; the reads below settings wait for enabled', async () => {
  h.settings.mockResolvedValue({ enabled: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { currentUser: { org_id: 'org-1' } } as never;
  const shared = ({ children }: { children: React.ReactNode }) => (
    <AuthContext.Provider value={auth}><QueryClientProvider client={client}>{children}</QueryClientProvider></AuthContext.Provider>
  );
  const settings = renderHook(() => useLeaveSettings(), { wrapper: shared });
  await waitFor(() => expect(settings.result.current.data).toMatchObject({ enabled: true }));
  h.visible.mockResolvedValue([{ id: 'r1' }]);
  const requests = renderHook(() => useLeaveRequests(), { wrapper: shared });
  await waitFor(() => expect(requests.result.current.data).toEqual([{ id: 'r1' }]));
  expect(h.visible).toHaveBeenCalledOnce();

  h.types.mockResolvedValue([{ id: 't1' }]);
  const types = renderHook(() => useLeaveTypes(), { wrapper: authWrapper() });
  await waitFor(() => expect(types.result.current.data).toEqual([{ id: 't1' }]));
  const idle = renderHook(() => useLeaveOnDate(null), { wrapper: authWrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.onDate.mockResolvedValue([]);
  const onDate = renderHook(() => useLeaveOnDate('2026-03-10'), { wrapper: authWrapper() });
  await waitFor(() => expect(onDate.result.current.isSuccess).toBe(true));
  expect(h.onDate).toHaveBeenCalledWith('2026-03-10');
});

it('leave request applicability stays pending until settings resolve, then follows the enabled read', async () => {
  let resolveSettings!: (value: { enabled: boolean }) => void;
  let resolveRequests!: (value: { id: string }[]) => void;
  h.settings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
  h.visible.mockReturnValue(new Promise((resolve) => { resolveRequests = resolve; }));

  const { result } = renderHook(() => useLeaveRequests(), { wrapper: authWrapper() });
  expect(result.current.enabled).toBe(false);
  expect(result.current.prerequisitePending).toBe(true);
  expect(result.current.prerequisiteError).toBe(false);

  await act(async () => { resolveSettings({ enabled: true }); });
  await waitFor(() => expect(result.current.enabled).toBe(true));
  expect(result.current.prerequisitePending).toBe(false);
  expect(result.current.isPending).toBe(true);

  await act(async () => { resolveRequests([{ id: 'r1' }]); });
  await waitFor(() => expect(result.current.data).toEqual([{ id: 'r1' }]));
  expect(result.current.enabled).toBe(true);
});

it('a disabled leave setting is known off even while its disabled request query is pending', async () => {
  h.settings.mockResolvedValue({ enabled: false });
  const { result } = renderHook(() => useLeaveRequests(), { wrapper: authWrapper() });

  await waitFor(() => expect(result.current.prerequisitePending).toBe(false));
  expect(result.current.enabled).toBe(false);
  expect(result.current.prerequisiteError).toBe(false);
  expect(result.current.isPending).toBe(true);
  expect(h.visible).not.toHaveBeenCalled();
});

it('a disabled people module makes leave requests inapplicable after settings resolve', async () => {
  h.settings.mockResolvedValue({ enabled: true });
  h.peopleModuleOn = false;
  const { result } = renderHook(() => useLeaveRequests(), { wrapper: authWrapper() });

  await waitFor(() => expect(result.current.prerequisitePending).toBe(false));
  expect(result.current.enabled).toBe(false);
  expect(result.current.prerequisiteError).toBe(false);
  expect(h.visible).not.toHaveBeenCalled();
});

it('a known-off people module does not wait for leave settings to settle', () => {
  h.settings.mockReturnValue(new Promise(() => undefined));
  h.peopleModuleOn = false;
  const { result } = renderHook(() => useLeaveRequests(), { wrapper: authWrapper() });

  expect(result.current.enabled).toBe(false);
  expect(result.current.prerequisitePending).toBe(false);
  expect(result.current.prerequisiteError).toBe(false);
  expect(h.visible).not.toHaveBeenCalled();
});

it('a failed leave setting read is reported as an unknown failed prerequisite', async () => {
  h.settings.mockRejectedValue(new Error('settings unavailable'));
  const { result } = renderHook(() => useLeaveRequests(), { wrapper: authWrapper() });

  await waitFor(() => expect(result.current.prerequisiteError).toBe(true));
  expect(result.current.enabled).toBe(false);
  expect(h.visible).not.toHaveBeenCalled();
});

it('retrying a failed leave prerequisite re-reads settings and then loads applicable requests', async () => {
  h.settings.mockRejectedValueOnce(new Error('settings unavailable')).mockResolvedValue({ enabled: true });
  h.visible.mockResolvedValue([{ id: 'r1' }]);
  const { result } = renderHook(() => useLeaveRequests(), { wrapper: authWrapper() });

  await waitFor(() => expect(result.current.prerequisiteError).toBe(true));
  await act(async () => { await result.current.refetch(); });
  await waitFor(() => expect(result.current.data).toEqual([{ id: 'r1' }]));
  expect(h.settings).toHaveBeenCalledTimes(2);
  expect(h.visible).toHaveBeenCalledOnce();
});

it('a decision forwards id, outcome and note; submit and cancel forward their payloads', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useLeaveMutations(), { wrapper: w });
  h.submit.mockResolvedValue('r1');
  const input = { type: 'Annual', from: '2026-03-10', to: '2026-03-12', note: null } as never;
  await act(async () => { await result.current.submit.mutateAsync(input); });
  expect(h.submit).toHaveBeenCalledWith(input);
  h.decide.mockResolvedValue(undefined);
  await act(async () => { await result.current.decide.mutateAsync({ id: 'r1', decision: 'Approved', note: 'ok' }); });
  expect(h.decide).toHaveBeenCalledWith('r1', 'Approved', 'ok');
  h.cancel.mockResolvedValue(undefined);
  await act(async () => { await result.current.cancel.mutateAsync('r1'); });
  expect(h.cancel).toHaveBeenCalledWith('r1');
  const keys = spy.mock.calls.map(([a]) => (a as { queryKey: readonly unknown[] }).queryKey[0]);
  expect(keys.length).toBeGreaterThanOrEqual(2); // the decision refreshes both leave families
});

it('settings saves and the type writes refresh the type list they feed', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result: r2 } = renderHook(() => useLeaveSettingsMutations(), { wrapper: w });
  h.setSettings.mockResolvedValue(undefined);
  const settingsValue = { enabled: true, annualQuotaDays: 12 } as never;
  await act(async () => { await r2.current.save.mutateAsync(settingsValue); });
  expect(h.setSettings).toHaveBeenCalledWith(settingsValue);
  h.createType.mockResolvedValue('t1');
  await act(async () => { await r2.current.createType.mutateAsync('Sick'); });
  expect(h.createType).toHaveBeenCalledWith('Sick');
  const keys = spy.mock.calls.map(([a]) => (a as { queryKey: readonly unknown[] }).queryKey[0]);
  expect(keys).toContain('leave-types');
  h.archiveType.mockResolvedValue(undefined);
  await act(async () => { await r2.current.archiveType.mutateAsync('t1'); });
  expect(h.archiveType).toHaveBeenCalledWith('t1');
});
