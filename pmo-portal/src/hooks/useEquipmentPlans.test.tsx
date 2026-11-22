import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  settings: vi.fn(), categories: vi.fn(), plansForMonth: vi.fn(), canApprove: vi.fn(), route: vi.fn(),
  setSettings: vi.fn(), upsertCategory: vi.fn(), setCategoryActive: vi.fn(),
  save: vi.fn(), submit: vi.fn(), reopen: vi.fn(), reject: vi.fn(), approve: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/equipmentPlans', () => ({ equipmentPlanRepository: h }));
import {
  EQUIPMENT_PLAN_QUERY_ROOT, useCanApprovePlan, useEquipmentPlanApprovalRoute, useEquipmentPlanSettings, usePlanCategories,
  usePlanMutations, usePlanSettingsMutations, usePlansForMonth,
} from './useEquipmentPlans';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue(null); });

it('settings, categories and the month plans read through the repository', async () => {
  h.settings.mockResolvedValue({ enabled: true, approvalStep: 'senior_role', allowSelfApproval: false });
  const { result } = renderHook(() => useEquipmentPlanSettings(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toMatchObject({ enabled: true }));
  expect(h.settings).toHaveBeenCalledOnce();

  h.categories.mockResolvedValue([{ id: 'c1', name: 'Crane', nameId: null, position: 1, active: true }]);
  const cats = renderHook(() => usePlanCategories(), { wrapper: wrapper() });
  await waitFor(() => expect(cats.result.current.data).toEqual([{ id: 'c1', name: 'Crane', nameId: null, position: 1, active: true }]));

  h.plansForMonth.mockResolvedValue([{ id: 'p1' }]);
  const plans = renderHook(() => usePlansForMonth('2026-03-01', true), { wrapper: wrapper() });
  await waitFor(() => expect(plans.result.current.data).toEqual([{ id: 'p1' }]));
  expect(h.plansForMonth).toHaveBeenCalledWith('2026-03-01');
});

it('the approver ask waits for the plan and is off when disabled', async () => {
  const off = renderHook(() => useCanApprovePlan('p1', false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  expect(h.canApprove).not.toHaveBeenCalled();
  h.canApprove.mockResolvedValue(true);
  const { result } = renderHook(() => useCanApprovePlan('p1', true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toBe(true));
  expect(h.canApprove).toHaveBeenCalledWith('p1');
});

it('AC-EQP-008 the waiting route is read through the repository, per plan, and only while the plan waits', async () => {
  const off = renderHook(() => useEquipmentPlanApprovalRoute('p1', false), { wrapper: wrapper() });
  expect(off.result.current.fetchStatus).toBe('idle');
  expect(h.route).not.toHaveBeenCalled();

  h.route.mockResolvedValueOnce({ kind: 'project', approvers: [{ id: 'u1', name: 'Ani', role: 'Finance' }] });
  const { result } = renderHook(() => useEquipmentPlanApprovalRoute('p1', true), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toMatchObject({ kind: 'project' }));
  expect(h.route).toHaveBeenCalledWith('p1');
});

it('AC-EQP-008 two plans never share a route: each answer is keyed by its own plan', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  // answer by the plan asked about, so the proof never depends on which fetch started first
  h.route.mockImplementation((id: string) => Promise.resolve(id === 'p1'
    ? { kind: 'project', approvers: [{ id: 'u1', name: 'Ani', role: 'Finance' }] }
    : { kind: 'admin', approvers: [{ id: 'u9', name: 'Zed', role: 'Admin' }] }));
  const first = renderHook(() => useEquipmentPlanApprovalRoute('p1', true), { wrapper: w });
  const second = renderHook(() => useEquipmentPlanApprovalRoute('p2', true), { wrapper: w });
  await waitFor(() => expect(first.result.current.data).toMatchObject({ kind: 'project' }));
  await waitFor(() => expect(second.result.current.data).toMatchObject({ kind: 'admin' }));
  expect(client.getQueryData([EQUIPMENT_PLAN_QUERY_ROOT, 'org-1', 'route', 'p1'])).toMatchObject({ kind: 'project' });
  expect(client.getQueryData([EQUIPMENT_PLAN_QUERY_ROOT, 'org-1', 'route', 'p2'])).toMatchObject({ kind: 'admin' });
});

it('settings and category writes forward their payloads', async () => {
  const { result } = renderHook(() => usePlanSettingsMutations(), { wrapper: wrapper() });
  h.setSettings.mockResolvedValue(undefined);
  const s = { enabled: true, approvalStep: 'senior_role' as const, allowSelfApproval: false };
  await act(async () => { await result.current.setSettings.mutateAsync(s); });
  expect(h.setSettings).toHaveBeenCalledWith(s);
  h.upsertCategory.mockResolvedValue(undefined);
  const cat = { id: null, name: 'Scaffolding', nameId: null, position: 2 };
  await act(async () => { await result.current.upsertCategory.mutateAsync(cat); });
  expect(h.upsertCategory).toHaveBeenCalledWith(cat);
  h.setCategoryActive.mockResolvedValue(undefined);
  await act(async () => { await result.current.setCategoryActive.mutateAsync({ id: 'c1', active: false }); });
  expect(h.setCategoryActive).toHaveBeenCalledWith('c1', false);
});

it('plan writes go one-per-state; approving also refreshes the purchases it creates', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const spy = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => usePlanMutations(), { wrapper: w });
  h.save.mockResolvedValue({ id: 'p1' });
  const input = { id: 'p1', projectId: 'prj', month: '2026-03-01', lines: [] } as never;
  await act(async () => { await result.current.save.mutateAsync(input); });
  expect(h.save).toHaveBeenCalledWith(input);
  h.submit.mockResolvedValue(undefined);
  await act(async () => { await result.current.submit.mutateAsync('p1'); });
  expect(h.submit).toHaveBeenCalledWith('p1');
  h.reopen.mockResolvedValue(undefined);
  await act(async () => { await result.current.reopen.mutateAsync('p1'); });
  expect(h.reopen).toHaveBeenCalledWith('p1');
  h.reject.mockResolvedValue(undefined);
  await act(async () => { await result.current.reject.mutateAsync({ id: 'p1', reason: 'wrong month' }); });
  expect(h.reject).toHaveBeenCalledWith('p1', 'wrong month');
  h.approve.mockResolvedValue(undefined);
  await act(async () => { await result.current.approve.mutateAsync('p1'); });
  expect(h.approve).toHaveBeenCalledWith('p1');
  const keys = spy.mock.calls.map(([a]) => (a as { queryKey: readonly unknown[] }).queryKey[0]);
  expect(keys).toContain(EQUIPMENT_PLAN_QUERY_ROOT);
  expect(keys).toContain('procurements'); // approving creates purchases
});
