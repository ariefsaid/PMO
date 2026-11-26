import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ record: vi.fn(async () => 'survey-1'), confirm: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) }));
vi.mock('@/src/hooks/useOrgId', () => ({ useOrgId: () => 'org-1' }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { surveyRecord: h } }));

import { useSurveyMutations } from './useSurveyRecords';

it('invalidates project and work-order reconciliation after a survey quantity write', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const projectKey = ['billing-reconciliation', 'org-1', 'p1', null];
  const workOrderKey = ['billing-reconciliation', 'org-1', 'p1', 'wo-1'];
  client.setQueryData(projectKey, []);
  client.setQueryData(workOrderKey, []);
  const { result } = renderHook(() => useSurveyMutations('wo-1', 'p1'), { wrapper });

  await act(async () => { await result.current.record.mutateAsync({} as never); });

  expect(client.getQueryState(projectKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(workOrderKey)?.isInvalidated).toBe(true);
});
