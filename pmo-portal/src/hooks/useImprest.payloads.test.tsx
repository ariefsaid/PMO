import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { imprest } = vi.hoisted(() => ({
  imprest: {
    createPlan: vi.fn(), savePlanLine: vi.fn(), deletePlanLine: vi.fn(), setProcurementLimit: vi.fn(), proposeFloatAmount: vi.fn(),
    decideFloatChange: vi.fn(), transitionReplenishment: vi.fn(), setClaimFloat: vi.fn(), transitionPlan: vi.fn(),
    requestReplenishment: vi.fn(), floatChoices: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { imprest } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import {
  useCreatePlan, useSavePlanLine, useDeletePlanLine, useSetProcurementLimit, useProposeFloatAmount, useDecideFloatChange,
  useTransitionReplenishment, useSetClaimFloat, useRequestReplenishment, useTransitionPlan,
} from './useImprest';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

beforeEach(() => { for (const fn of Object.values(imprest)) fn.mockReset().mockResolvedValue(undefined); });

describe('#2544 site float mutations hand the repository exactly what the user chose', () => {
  const setup = () => renderHook(() => ({
    createPlan: useCreatePlan(), savePlanLine: useSavePlanLine(), deletePlanLine: useDeletePlanLine(), limit: useSetProcurementLimit(),
    propose: useProposeFloatAmount(), decide: useDecideFloatChange(), transition: useTransitionReplenishment(),
    claimFloat: useSetClaimFloat(), request: useRequestReplenishment(), plan: useTransitionPlan(),
  }), { wrapper: wrap(new QueryClient({ defaultOptions: { queries: { retry: false } } })) });

  it('#2544 plan writes: month plan, plan line category and amount, line delete by id', async () => {
    const { result } = setup();
    await act(async () => { await result.current.createPlan.mutateAsync({ floatId: 'f1', month: '2026-11-01' }); });
    await act(async () => { await result.current.savePlanLine.mutateAsync({ planId: 'p1', category: 'Vehicle', amount: 250000 }); });
    await act(async () => { await result.current.deletePlanLine.mutateAsync('l9'); });
    expect(imprest.createPlan).toHaveBeenCalledWith('f1', '2026-11-01');
    expect(imprest.savePlanLine).toHaveBeenCalledWith('p1', 'Vehicle', 250000);
    expect(imprest.deletePlanLine).toHaveBeenCalledWith('l9');
  });

  it('#2544 float amount: a proposal carries the new amount; a decision carries approve flag and optional note', async () => {
    const { result } = setup();
    await act(async () => { await result.current.propose.mutateAsync({ floatId: 'f1', amount: 7_500_000 }); });
    await act(async () => { await result.current.decide.mutateAsync({ changeId: 'c1', approve: false, notes: 'Too high' }); });
    await act(async () => { await result.current.decide.mutateAsync({ changeId: 'c2', approve: true }); });
    expect(imprest.proposeFloatAmount).toHaveBeenCalledWith('f1', 7_500_000);
    expect(imprest.decideFloatChange).toHaveBeenNthCalledWith(1, 'c1', false, 'Too high');
    expect(imprest.decideFloatChange).toHaveBeenNthCalledWith(2, 'c2', true, undefined);
  });

  it('#2544 a replenishment transition sends its note and payment reference as options; a plain request defaults to replenishment kind', async () => {
    const { result } = setup();
    await act(async () => { await result.current.transition.mutateAsync({ id: 'r1', to: 'Paid', paymentReference: 'REF-9' }); });
    await act(async () => { await result.current.transition.mutateAsync({ id: 'r2', to: 'Rejected', notes: 'Attach receipts' }); });
    await act(async () => { await result.current.request.mutateAsync({ floatId: 'f1' }); });
    expect(imprest.transitionReplenishment).toHaveBeenNthCalledWith(1, 'r1', 'Paid', { notes: undefined, paymentReference: 'REF-9' });
    expect(imprest.transitionReplenishment).toHaveBeenNthCalledWith(2, 'r2', 'Rejected', { notes: 'Attach receipts', paymentReference: undefined });
    expect(imprest.requestReplenishment).toHaveBeenCalledWith('f1', undefined);
  });

  it('#2544 org procurement limit and the claim-to-float link (including unlinking) pass through unchanged', async () => {
    const { result } = setup();
    await act(async () => { await result.current.limit.mutateAsync(750000); });
    await act(async () => { await result.current.claimFloat.mutateAsync({ claimId: 'cl1', floatId: 'f2' }); });
    await act(async () => { await result.current.claimFloat.mutateAsync({ claimId: 'cl1', floatId: null }); });
    expect(imprest.setProcurementLimit).toHaveBeenCalledWith(750000);
    expect(imprest.setClaimFloat).toHaveBeenNthCalledWith(1, 'cl1', 'f2');
    expect(imprest.setClaimFloat).toHaveBeenNthCalledWith(2, 'cl1', null);
  });

  it('#2544 a failed write rejects to the caller, so the screen can name the error', async () => {
    imprest.proposeFloatAmount.mockRejectedValue(new Error('refused'));
    const { result } = setup();
    await act(async () => { await expect(result.current.propose.mutateAsync({ floatId: 'f1', amount: 1 })).rejects.toThrow('refused'); });
  });
});
