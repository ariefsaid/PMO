import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getTemplate: vi.fn(), setTemplate: vi.fn(), listItems: vi.fn(), getCloser: vi.fn(),
  attachDocument: vi.fn(), completeItem: vi.fn(), listOpenDue: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { closeoutChecklist: h } }));
import {
  useCloseoutItemMutations, useCloseoutTemplate, useOpenCloseoutDue, useSaveCloseoutTemplate, useWorkOrderCloseoutItems, useWorkOrderCloser,
} from './useCloseoutChecklist';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue(null); });

it('the template and the work order checklist read through the repository, gated on org and work order', async () => {
  h.getTemplate.mockResolvedValue([{ name: 'Handover', required: true }]);
  const { result } = renderHook(() => useCloseoutTemplate(true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ name: 'Handover', required: true }]));
  expect(h.getTemplate).toHaveBeenCalledOnce();
  const off = renderHook(() => useCloseoutTemplate(false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');

  const idle = renderHook(() => useWorkOrderCloseoutItems(undefined), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.listItems.mockResolvedValue([{ id: 'i1', done_on: null }]);
  const items = renderHook(() => useWorkOrderCloseoutItems('wo1'), { wrapper: wrapper() });
  await waitFor(() => expect(items.result.current.data).toEqual([{ id: 'i1', done_on: null }]));
  expect(h.listItems).toHaveBeenCalledWith('wo1');
});

it('the closer read waits for the flag; a save replaces the list whole and refreshes the template', async () => {
  const off = renderHook(() => useWorkOrderCloser('wo1', false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  h.getCloser.mockResolvedValue({ closed_by: 'u1', closed_at: 't' });
  const closer = renderHook(() => useWorkOrderCloser('wo1', true), { wrapper: wrapper() });
  await waitFor(() => expect(closer.result.current.data).toMatchObject({ closed_by: 'u1' }));
  expect(h.getCloser).toHaveBeenCalledWith('wo1');

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useSaveCloseoutTemplate(), { wrapper: w });
  h.setTemplate.mockResolvedValue(undefined);
  const items = [{ name: 'Handover', required: true }] as never;
  await act(async () => { await result.current.mutateAsync(items); });
  expect(h.setTemplate).toHaveBeenCalledWith(items);
  expect(spy).toHaveBeenCalledWith({ queryKey: ['closeout-template', 'org-1'] });
});

it('checklist item writes forward their payloads', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result: r2 } = renderHook(() => useCloseoutItemMutations('wo1'), { wrapper: w });
  h.attachDocument.mockResolvedValue(undefined);
  await act(async () => { await r2.current.attachDocument.mutateAsync({ itemId: 'i1', documentId: 'd1' }); });
  expect(h.attachDocument).toHaveBeenCalledWith('i1', 'd1');
  h.completeItem.mockResolvedValue(undefined);
  await act(async () => { await r2.current.completeItem.mutateAsync({ itemId: 'i1', doneOn: '2026-03-10' }); });
  expect(h.completeItem).toHaveBeenCalledWith('i1', '2026-03-10');
});

it('FR-CTD-009 the overdue counts read once through the batch repository call (#2800)', async () => {
  h.listOpenDue.mockResolvedValue([{ workOrderId: 'wo1', dueOn: '2026-11-01', doneOn: null }]);
  const { result } = renderHook(() => useOpenCloseoutDue(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toEqual([{ workOrderId: 'wo1', dueOn: '2026-11-01', doneOn: null }]));
  expect(h.listOpenDue).toHaveBeenCalledOnce();
});
