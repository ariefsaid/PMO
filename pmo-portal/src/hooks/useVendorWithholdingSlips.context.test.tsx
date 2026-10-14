import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const { repo, auth } = vi.hoisted(() => ({
  repo: { readBillContexts: vi.fn(), listBills: vi.fn() },
  auth: { orgId: 'org-a' as string | undefined },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { vendorWithholdingSlips: repo } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.orgId ? { org_id: auth.orgId } : null }) }));
import { useVendorWithholdingBillContexts, useVendorWithholdingCandidates } from './useVendorWithholdingSlips';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
const bill = (invoiceId: string, procurementId: string, projectId: string) => ({ invoice_id: invoiceId, procurement_id: procurementId, project_id: projectId });

beforeEach(() => {
  repo.readBillContexts.mockReset();
  repo.listBills.mockReset().mockResolvedValue({ rows: [], nextCursor: null });
  auth.orgId = 'org-a';
});

it('AC-UXT-007 resolves each candidate page through one deduplicated case and project batch', async () => {
  repo.readBillContexts.mockImplementation(async ({ procurementIds, projectIds }: { procurementIds: string[]; projectIds: string[] }) => ({
    procurements: Object.fromEntries(procurementIds.map((id) => [id, `Title ${id}`])),
    projects: Object.fromEntries(projectIds.map((id) => [id, { name: `Project ${id}`, pmoProjectNumber: `PMO-${id}` }])),
  }));
  const first = Array.from({ length: 50 }, (_, index) => bill(`invoice-${index}`, 'case-a', 'project-a'));
  const params = { vendorId: 'vendor-a', pphType: 'pph23', currency: 'IDR' };
  const Wrapper = wrapper();
  let pages = [first];
  const hook = renderHook(() => ({ contexts: useVendorWithholdingBillContexts(pages), candidates: useVendorWithholdingCandidates(params) }), { wrapper: Wrapper });
  await waitFor(() => expect(repo.readBillContexts).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(hook.result.current.contexts['invoice-49']?.caseTitle).toBe('Title case-a'));
  expect(repo.readBillContexts).toHaveBeenCalledWith({ procurementIds: ['case-a'], projectIds: ['project-a'] });
  expect(repo.listBills).toHaveBeenCalledWith({ ...params, candidatesOnly: true, cursor: undefined, limit: 50 });

  const second = [bill('invoice-next', 'case-b', 'project-b')];
  pages = [first, second];
  hook.rerender();
  await waitFor(() => expect(hook.result.current.contexts['invoice-next']?.caseTitle).toBe('Title case-b'));
  expect(repo.readBillContexts).toHaveBeenCalledTimes(2);
  expect(hook.result.current.contexts['invoice-0']?.projectName).toBe('Project project-a');
});

it('AC-UXT-007 exposes pending and unavailable states without using IDs as labels', async () => {
  let reject: ((error: Error) => void) | undefined;
  repo.readBillContexts.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const hook = renderHook(() => useVendorWithholdingBillContexts([[bill('invoice-a', 'case-a', 'project-a')]]), { wrapper: wrapper() });
  expect(hook.result.current['invoice-a']).toMatchObject({ state: 'pending' });
  await act(async () => reject?.(new Error('unavailable')));
  await waitFor(() => expect(hook.result.current['invoice-a']).toMatchObject({ state: 'unavailable' }));
  expect(hook.result.current['invoice-a']?.caseTitle).toBeUndefined();
});
