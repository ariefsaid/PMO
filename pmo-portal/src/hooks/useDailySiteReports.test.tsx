import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  saveDraft: vi.fn(async () => 'report-1'),
  submit: vi.fn(async () => undefined),
  withdraw: vi.fn(async () => undefined),
  validate: vi.fn(async () => undefined),
  returnReport: vi.fn(async () => undefined),
  correct: vi.fn(async () => undefined),
  uploadPhoto: vi.fn(async () => undefined),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { dailySiteReport: h } }));

import { useDailySiteReportMutations } from './useDailySiteReports';

it('invalidates reconciliation after saving site progress quantities', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const projectKey = ['billing-reconciliation', 'org-1', 'p1', null];
  const workOrderKey = ['billing-reconciliation', 'org-1', 'p1', 'wo-1'];
  const otherProjectKey = ['billing-reconciliation', 'org-1', 'p2', null];
  client.setQueryData(projectKey, []);
  client.setQueryData(workOrderKey, []);
  client.setQueryData(otherProjectKey, []);
  const { result } = renderHook(() => useDailySiteReportMutations('p1'), { wrapper });

  await act(async () => {
    await result.current.save.mutateAsync({ workOrderId: 'wo-1', workDate: '2026-11-26', progress: [], idle: [], consumables: [] });
  });

  expect(client.getQueryState(projectKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(workOrderKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(otherProjectKey)?.isInvalidated).toBe(false);
});
