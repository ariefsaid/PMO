import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rollup: vi.fn(), progress: vi.fn(), readiness: vi.fn(), events: vi.fn(),
  create: vi.fn(), update: vi.fn(), setReadiness: vi.fn(), setArchived: vi.fn(), remove: vi.fn(), setPlan: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/workOrderSections', () => ({
  workOrderSectionRepository: {
    rollup: h.rollup, progress: h.progress, readiness: h.readiness, events: h.events,
    create: h.create, update: h.update, setReadiness: h.setReadiness, setArchived: h.setArchived, remove: h.remove, setPlan: h.setPlan,
  },
}));
import {
  useArchiveSection, useDeleteSection, useSaveSection, useSaveSectionPlan, useSectionReadinessEvents,
  useSetSectionReadiness, useWorkOrderSectionProgress, useWorkOrderSectionReadiness, useWorkOrderSectionRollup,
} from './useWorkOrderSections';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]);
});

it('reads the roll-up through the repository when the work order is known', async () => {
  h.rollup.mockResolvedValue([{ sectionId: 's1' }]);
  const { result } = renderHook(() => useWorkOrderSectionRollup('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(h.rollup).toHaveBeenCalledWith('wo1');
  expect(result.current.data).toEqual([{ sectionId: 's1' }]);
});

it('progress and readiness are gated on the work order being known', async () => {
  const a = renderHook(() => useWorkOrderSectionProgress(undefined), { wrapper: wrapper() });
  expect(a.result.current.fetchStatus).toBe('idle');
  expect(h.progress).not.toHaveBeenCalled();
  const b = renderHook(() => useWorkOrderSectionReadiness('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
  expect(h.readiness).toHaveBeenCalledWith('wo1');
});

it('readiness events wait for a section to be chosen', async () => {
  const idle = renderHook(() => useSectionReadinessEvents(null), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.events.mockResolvedValue([{ id: 'e1' }]);
  const live = renderHook(() => useSectionReadinessEvents('s1'), { wrapper: wrapper() });
  await waitFor(() => expect(live.result.current.isSuccess).toBe(true));
  expect(h.events).toHaveBeenCalledWith('s1');
});

it('a save without an id creates, with an id updates, and the caller gets the section id either way', async () => {
  h.create.mockResolvedValue('s-new');
  h.update.mockResolvedValue(undefined);
  const { result } = renderHook(() => useSaveSection('wo1'), { wrapper: wrapper() });
  const input = { code: 'A', name: 'Earth', locationNote: null, foremanId: null, sortOrder: 1 };
  await act(async () => { await expect(result.current.mutateAsync({ id: null, input })).resolves.toBe('s-new'); });
  expect(h.create).toHaveBeenCalledWith('wo1', input);
  expect(h.update).not.toHaveBeenCalled();
  await act(async () => { await expect(result.current.mutateAsync({ id: 's1', input })).resolves.toBe('s1'); });
  expect(h.update).toHaveBeenCalledWith('s1', input);
});

it('readiness, archive and delete forward their payloads verbatim', async () => {
  const a = renderHook(() => useSetSectionReadiness('wo1'), { wrapper: wrapper() });
  await act(async () => { await a.result.current.mutateAsync({ id: 's1', readiness: 'blocked', note: 'permit' }); });
  expect(h.setReadiness).toHaveBeenCalledWith('s1', 'blocked', 'permit');
  const b = renderHook(() => useArchiveSection('wo1'), { wrapper: wrapper() });
  await act(async () => { await b.result.current.mutateAsync({ id: 's1', archived: true }); });
  expect(h.setArchived).toHaveBeenCalledWith('s1', true);
  const c = renderHook(() => useDeleteSection('wo1'), { wrapper: wrapper() });
  await act(async () => { await c.result.current.mutateAsync('s1'); });
  expect(h.remove).toHaveBeenCalledWith('s1');
});

it('saving the plan goes through the project-scoped setPlan', async () => {
  h.setPlan.mockResolvedValue(undefined);
  const { result } = renderHook(() => useSaveSectionPlan('wo1', 'p1'), { wrapper: wrapper() });
  const changes = [{ sectionId: 's1', itemId: 'i1', quantity: '3' }] as never;
  await act(async () => { await result.current.mutateAsync(changes); });
  expect(h.setPlan).toHaveBeenCalledWith('p1', 'wo1', changes);
});
