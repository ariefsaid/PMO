import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isEnabled: vi.fn(), listItems: vi.fn(), workOrderDays: vi.fn(), getDay: vi.fn(), rosterWorkers: vi.fn(),
  getSummary: vi.fn(), getSummaryDetail: vi.fn(), setEnabled: vi.fn(), addItem: vi.fn(), submitDay: vi.fn(), correctDay: vi.fn(),
  saveTalk: vi.fn(), saveFitness: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { safetyDay: {
  isEnabled: h.isEnabled, listItems: h.listItems, workOrderDays: h.workOrderDays, getDay: h.getDay, rosterWorkers: h.rosterWorkers,
  getSummary: h.getSummary, getSummaryDetail: h.getSummaryDetail, setEnabled: h.setEnabled, addItem: h.addItem,
  submitDay: h.submitDay, correctDay: h.correctDay, saveTalk: h.saveTalk, saveFitness: h.saveFitness,
} } }));
import { safetyKeys, useSafetyDay, useSafetyList, useSafetyMutations, useSafetyRoster, useSafetySummaryDetail, useSafetyWorkOrderDays } from './useSafetyDays';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue(null); });

it('the days read waits for the work order and the flag; the roster waits for a date too', async () => {
  const idleDays = renderHook(() => useSafetyWorkOrderDays(undefined, '2026-03-01', '2026-03-07', true), { wrapper: wrapper() });
  expect(idleDays.result.current.fetchStatus).toBe('idle');
  const flagged = renderHook(() => useSafetyWorkOrderDays('wo1', '2026-03-01', '2026-03-07', false), { wrapper: wrapper() });
  expect(flagged.result.current.fetchStatus).toBe('idle');
  const live = renderHook(() => useSafetyWorkOrderDays('wo1', '2026-03-01', '2026-03-07', true), { wrapper: wrapper() });
  await waitFor(() => expect(live.result.current.isSuccess).toBe(true));
  expect(h.workOrderDays).toHaveBeenCalledWith('wo1', '2026-03-01', '2026-03-07');

  const idleRoster = renderHook(() => useSafetyRoster('wo1', undefined), { wrapper: wrapper() });
  expect(idleRoster.result.current.fetchStatus).toBe('idle');
  h.rosterWorkers.mockResolvedValue([{ worker_id: 'w1', display_name: 'Ani' }]);
  const roster = renderHook(() => useSafetyRoster('wo1', '2026-03-02'), { wrapper: wrapper() });
  await waitFor(() => expect(roster.result.current.data).toEqual([{ worker_id: 'w1', display_name: 'Ani' }]));
  expect(h.rosterWorkers).toHaveBeenCalledWith('wo1', '2026-03-02');
});

it('a day detail and a kind-scoped summary detail wait for their ids', async () => {
  const idleDay = renderHook(() => useSafetyDay(undefined), { wrapper: wrapper() });
  expect(idleDay.result.current.fetchStatus).toBe('idle');
  h.getDay.mockResolvedValue({ day: { id: 'd1' } });
  const day = renderHook(() => useSafetyDay('d1'), { wrapper: wrapper() });
  await waitFor(() => expect(day.result.current.data).toEqual({ day: { id: 'd1' } }));
  expect(h.getDay).toHaveBeenCalledWith('d1');

  const idleDetail = renderHook(() => useSafetySummaryDetail(null, 'p1', '2026-03-01'), { wrapper: wrapper() });
  expect(idleDetail.result.current.fetchStatus).toBe('idle');
  h.getSummaryDetail.mockResolvedValue([{ date: 'd', work_order_id: null, ref_id: null, label: 'l' }]);
  const detail = renderHook(() => useSafetySummaryDetail('toolbox_talks', 'p1', '2026-03-01'), { wrapper: wrapper() });
  await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
  expect(h.getSummaryDetail).toHaveBeenCalledWith('toolbox_talks', 'p1', '2026-03-01');
});

it('the admin list is asked per kind with or without archived entries', async () => {
  h.listItems.mockResolvedValue([]);
  const a = renderHook(() => useSafetyList('check_type', true), { wrapper: wrapper() });
  await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
  expect(h.listItems).toHaveBeenCalledWith('check_type', true);
  const b = renderHook(() => useSafetyList('permit_type'), { wrapper: wrapper() });
  await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
  expect(h.listItems).toHaveBeenCalledWith('permit_type', false);
});

it('every mutation forwards its payload and a success invalidates the whole safety family', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  h.addItem.mockResolvedValue(undefined);
  h.submitDay.mockResolvedValue(undefined);
  h.correctDay.mockResolvedValue('d2');
  h.saveTalk.mockResolvedValue('t1');
  h.saveFitness.mockResolvedValue(undefined);
  const { result } = renderHook(() => useSafetyMutations(), { wrapper: w });
  await act(async () => { await result.current.addItem.mutateAsync({ kind: 'check_type', label: 'PPE' }); });
  expect(h.addItem).toHaveBeenCalledWith('check_type', 'PPE');
  expect(spy).toHaveBeenCalledWith({ queryKey: safetyKeys.root('org-1') });
  await act(async () => { await result.current.submitDay.mutateAsync('d1'); });
  expect(h.submitDay).toHaveBeenCalledWith('d1');
  await act(async () => { await result.current.correctDay.mutateAsync({ id: 'd1', reason: 'roster' }); });
  expect(h.correctDay).toHaveBeenCalledWith('d1', 'roster');
  await act(async () => { await result.current.saveTalk.mutateAsync({ dayId: 'd1', topic: 'Ladders', presenter: 'Dewi', heldAt: 't', attendees: [{ workerId: 'w1' }] }); });
  expect(h.saveTalk).toHaveBeenCalledWith('d1', { dayId: 'd1', topic: 'Ladders', presenter: 'Dewi', heldAt: 't', attendees: [{ workerId: 'w1' }] });
  await act(async () => { await result.current.saveFitness.mutateAsync({ dayId: 'd1', result: 'fit' }); });
  expect(h.saveFitness).toHaveBeenCalledWith('d1', { result: 'fit' });
});
