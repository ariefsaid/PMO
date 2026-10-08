import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, auth } = vi.hoisted(() => ({
  repo: { coverage: vi.fn(), get: vi.fn(), listBills: vi.fn(), listSlips: vi.fn(), record: vi.fn(), correct: vi.fn(), void: vi.fn() },
  auth: { orgId: 'org-a' as string | undefined },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { vendorWithholdingSlips: repo } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: auth.orgId ? { org_id: auth.orgId } : null }) }));

import { useVendorWithholdingCandidates, useVendorWithholdingCoverage, useVendorWithholdingRegister, useVendorWithholdingSlip, useVendorWithholdingSlipMutations, vendorWithholdingSlipKeys } from './useVendorWithholdingSlips';

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};
beforeEach(() => {
  Object.values(repo).forEach((fn) => fn.mockReset());
  auth.orgId = 'org-a';
  repo.coverage.mockResolvedValue([{ invoice_id: 'i1', state: 'not-recorded' }]);
  repo.get.mockResolvedValue({ header: { id: 's1' }, bills: [] });
  repo.listBills.mockResolvedValue({ rows: [{ invoice_id: 'i1' }], nextCursor: null });
  repo.listSlips.mockResolvedValue({ rows: [{ slip_id: 's1' }], nextCursor: null });
  repo.record.mockResolvedValue({ slipId: 's1', revision: 1 });
  repo.correct.mockResolvedValue({ slipId: 's1', revision: 2 });
  repo.void.mockResolvedValue({ slipId: 's1', revision: 2 });
});

describe('AC-BUPOT-019 withholding-slip queries', () => {
  it('keys coverage and detail by organization, and returns repository facts', async () => {
    const { client, wrapper } = setup();
    const coverage = renderHook(() => useVendorWithholdingCoverage(['i2', 'i1', 'i2']), { wrapper });
    await waitFor(() => expect(coverage.result.current.isSuccess).toBe(true));
    expect(coverage.result.current.data).toEqual([{ invoice_id: 'i1', state: 'not-recorded' }]);
    expect(repo.coverage).toHaveBeenCalledWith(['i1', 'i2']);
    expect(client.getQueryCache().find({ queryKey: vendorWithholdingSlipKeys.coverage('org-a', ['i1', 'i2']) })).toBeTruthy();

    const detail = renderHook(() => useVendorWithholdingSlip('s1'), { wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(repo.get).toHaveBeenCalledWith('s1');
    expect(client.getQueryCache().find({ queryKey: vendorWithholdingSlipKeys.detail('org-a', 's1') })).toBeTruthy();
    auth.orgId = 'org-b';
    const otherOrg = renderHook(() => useVendorWithholdingSlip('s1'), { wrapper });
    await waitFor(() => expect(otherOrg.result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().find({ queryKey: vendorWithholdingSlipKeys.detail('org-b', 's1') })).toBeTruthy();
  });

  it('queries candidates and register with org-scoped canonical keys and pages', async () => {
    const { client, wrapper } = setup();
    const params = { vendorId: 'v1', pphType: 'pph23', currency: 'IDR' };
    const candidates = renderHook(() => useVendorWithholdingCandidates(params), { wrapper });
    await waitFor(() => expect(candidates.result.current.isSuccess).toBe(true));
    expect(repo.listBills).toHaveBeenCalledWith({ vendorId: 'v1', pphType: 'pph23', currency: 'IDR', candidatesOnly: true, cursor: undefined, limit: 50 });
    expect(client.getQueryCache().find({ queryKey: vendorWithholdingSlipKeys.candidates('org-a', params) })).toBeTruthy();
    const registerParams = { vendorId: 'v1', taxPeriod: '2026-10-01' };
    const register = renderHook(() => useVendorWithholdingRegister(registerParams), { wrapper });
    await waitFor(() => expect(register.result.current.isSuccess).toBe(true));
    expect(repo.listSlips).toHaveBeenCalledWith({ ...registerParams, cursor: undefined, limit: 50 });
    expect(client.getQueryCache().find({ queryKey: vendorWithholdingSlipKeys.register('org-a', registerParams) })).toBeTruthy();
  });

  it('does not fetch without an organization or selected invoice IDs', () => {
    const { wrapper } = setup(); auth.orgId = undefined;
    const noOrg = renderHook(() => useVendorWithholdingCoverage(['i1']), { wrapper });
    expect(noOrg.result.current.fetchStatus).toBe('idle');
    expect(noOrg.result.current.data).toBeUndefined();
    expect(repo.coverage).not.toHaveBeenCalled();
    auth.orgId = 'org-a';
    const noIds = renderHook(() => useVendorWithholdingCoverage([]), { wrapper });
    expect(noIds.result.current.fetchStatus).toBe('idle');
    expect(repo.coverage).not.toHaveBeenCalled();
    const noCandidates = renderHook(() => useVendorWithholdingCandidates({ vendorId: '', pphType: '', currency: '' }), { wrapper });
    expect(noCandidates.result.current.fetchStatus).toBe('idle');
    const disabledCandidates = renderHook(() => useVendorWithholdingCandidates({ vendorId: 'v1', pphType: 'pph23', currency: 'IDR', enabled: false }), { wrapper });
    expect(disabledCandidates.result.current.fetchStatus).toBe('idle');
    const disabledRegister = renderHook(() => useVendorWithholdingRegister({ enabled: false }), { wrapper });
    expect(disabledRegister.result.current.fetchStatus).toBe('idle');
    expect(repo.listBills).not.toHaveBeenCalled();
    expect(repo.listSlips).not.toHaveBeenCalled();
  });

  it('surfaces a failed coverage query without manufacturing zero-valued facts', async () => {
    repo.coverage.mockRejectedValueOnce(new Error('network unavailable'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useVendorWithholdingCoverage(['i1']), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('AC-BUPOT-019 record/correct/void cache behavior', () => {
  it.each(['record', 'correct', 'void'] as const)('%s invalidates affected organization data after success', async (operation) => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useVendorWithholdingSlipMutations(), { wrapper });
    await act(async () => { await result.current[operation].mutateAsync({ slipId: 's1' } as never); });
    expect(repo[operation]).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vendorWithholdingSlips', 'org-a'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['procurement', 'org-a'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['record-history', 'org-a'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['vendorWithholdingSlips', 'org-b'] });
  });

  it.each(['record', 'correct', 'void'] as const)('%s invalidates stale organization data after refusal', async (operation) => {
    repo[operation].mockRejectedValueOnce(Object.assign(new Error('stale'), { code: '40001', details: 'bupot-stale' }));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useVendorWithholdingSlipMutations(), { wrapper });
    await act(async () => { await expect(result.current[operation].mutateAsync({ slipId: 's1' } as never)).rejects.toMatchObject({ details: 'bupot-stale' }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vendorWithholdingSlips', 'org-a'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['procurement', 'org-a'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['record-history', 'org-a'] });
  });
});
