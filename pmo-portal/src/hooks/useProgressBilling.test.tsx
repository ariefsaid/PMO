import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const h = vi.hoisted(() => ({ withdrawClaim: vi.fn(), raiseInvoice: vi.fn(), recordAssessment: vi.fn(), createClaim: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { progressBilling: {
  withdrawClaim: h.withdrawClaim, createClaim: h.createClaim, raiseInvoice: h.raiseInvoice, recordAssessment: h.recordAssessment,
} } }));
import { useProgressBillingMutations } from './useProgressBilling';

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useProgressBillingMutations('p1'), { wrapper });
  const keys = () => spy.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
  return { result, keys };
}

describe('useProgressBillingMutations', () => {
  it('AC-PB-008 a claim write refreshes the claims, the bill of quantities and the billing summary', async () => {
    h.withdrawClaim.mockResolvedValue(undefined);
    const { result, keys } = setup();
    await act(async () => { await result.current.withdrawClaim.mutateAsync('k1'); });
    expect(keys()).toEqual(expect.arrayContaining([
      JSON.stringify(['boq-items', 'org-1', 'p1']),
      JSON.stringify(['progress-claims', 'org-1', 'p1']),
      JSON.stringify(['project-billing', 'org-1', 'p1']),
    ]));
  });

  it('AC-PB-009 a failed raise still refreshes the claims — the ERP may have committed before the error', async () => {
    h.raiseInvoice.mockRejectedValue(new Error('ERP unreachable'));
    const { result, keys } = setup();
    await act(async () => {
      await expect(result.current.raiseInvoice.mutateAsync({ claimId: 'k1', customerId: 'c1' })).rejects.toThrow('ERP unreachable');
    });
    expect(keys()).toContain(JSON.stringify(['progress-claims', 'org-1', 'p1']));
    expect(h.raiseInvoice).toHaveBeenCalledWith({ claimId: 'k1', projectId: 'p1', customerId: 'c1' }, undefined);
  });

  it('AC-PB-019 an assessment refreshes the billing summary and the management pack', async () => {
    h.recordAssessment.mockResolvedValue(40);
    const { result, keys } = setup();
    await act(async () => { await result.current.recordAssessment.mutateAsync({ month: '2026-09-01', quantities: [], note: null }); });
    expect(h.recordAssessment).toHaveBeenCalledWith({ projectId: 'p1', month: '2026-09-01', quantities: [], note: null });
    expect(keys()).toEqual(expect.arrayContaining([JSON.stringify(['project-billing', 'org-1', 'p1']), JSON.stringify(['managementPack'])]));
  });

  // OD-BILL-1: an unraised claim counts as pending against its work order, so every claim write moves the
  // work-order billing (the Work orders tab) and the org-wide still-to-invoice card (dashboards).
  const WO_BILLING = [JSON.stringify(['work-order-billing', 'org-1', 'p1']), JSON.stringify(['unbilled-work-orders', 'org-1'])];
  it('AC-BWO-004 creating a claim refreshes the work-order billing and the still-to-invoice card', async () => {
    h.createClaim.mockResolvedValue('k1');
    const { result, keys } = setup();
    await act(async () => { await result.current.createClaim.mutateAsync({} as never); });
    expect(keys()).toEqual(expect.arrayContaining(WO_BILLING));
  });
  it('AC-BWO-004 withdrawing a claim refreshes the work-order billing and the still-to-invoice card', async () => {
    h.withdrawClaim.mockResolvedValue(undefined);
    const { result, keys } = setup();
    await act(async () => { await result.current.withdrawClaim.mutateAsync('k1'); });
    expect(keys()).toEqual(expect.arrayContaining(WO_BILLING));
  });
  it('AC-BWO-004 raising (even a failed raise) refreshes the work-order billing and the still-to-invoice card', async () => {
    h.raiseInvoice.mockRejectedValue(new Error('ERP unreachable'));
    const { result, keys } = setup();
    await act(async () => {
      await expect(result.current.raiseInvoice.mutateAsync({ claimId: 'k1', customerId: 'c1' })).rejects.toThrow('ERP unreachable');
    });
    expect(keys()).toEqual(expect.arrayContaining(WO_BILLING));
  });
});
