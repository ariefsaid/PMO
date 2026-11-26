import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ setTerms: vi.fn(), reconciliation: vi.fn(), completeStage: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { billingStages: { setTerms: h.setTerms, reconciliation: h.reconciliation, completeStage: h.completeStage } } }));
import { useBillingReconciliation, useBillingStageMutations, useSaveBillingTerms } from './useBillingStages';

it('invalidates the claim trace with its full query key after a stage write', async () => {
  h.completeStage.mockReset().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useBillingStageMutations('claim-1', 'p1'), { wrapper });

  await act(async () => { await result.current.completeStage.mutateAsync({} as never); });

  expect(spy.mock.calls.map(([filter]) => (filter as { queryKey: unknown[] }).queryKey))
    .toContainEqual(['claim-billing-trace', 'org-1', 'claim-1', 'p1']);
});

it('saves every billing term through one repository operation', async () => {
  h.setTerms.mockReset().mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useSaveBillingTerms('p1'), { wrapper });
  const stages = [{ name: 'Approval', clientSide: true, documents: [] }];
  await act(async () => { await result.current.mutateAsync({ stages, deadlineDay: 25, warnDays: 5, retentionPct: 2.5 }); });
  expect(h.setTerms).toHaveBeenCalledOnce();
  expect(h.setTerms).toHaveBeenCalledWith('p1', stages, 25, 5, 2.5);
});

it('refreshes reconciliation when returning to the screen after an invoice change', async () => {
  h.reconciliation.mockReset().mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 45_000 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const first = renderHook(() => useBillingReconciliation('p1', null), { wrapper });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  first.unmount();
  renderHook(() => useBillingReconciliation('p1', null), { wrapper });
  await waitFor(() => expect(h.reconciliation).toHaveBeenCalledTimes(2));
});
