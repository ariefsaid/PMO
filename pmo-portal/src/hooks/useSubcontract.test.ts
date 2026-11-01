import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  getPoPosition: vi.fn(),
  listSubcontractAcceptances: vi.fn(),
  listPoVariations: vi.fn(),
  getVariationRoute: vi.fn(),
  getProjectSubcontractExposure: vi.fn(),
  listWorkOrderCostVariations: vi.fn(),
  listSubcontractCapExceptions: vi.fn(),
  setPoLines: vi.fn(),
  issuePoLines: vi.fn(),
  prepareSubcontractAcceptance: vi.fn(),
  confirmSubcontractAcceptance: vi.fn(),
  withdrawSubcontractAcceptance: vi.fn(),
  requestPoVariation: vi.fn(),
  decidePoVariation: vi.fn(),
  issuePoRevision: vi.fn(),
  linkPoVariation: vi.fn(),
  attributeSubcontractBillLines: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    subcontracts: h,
  },
}));

import {
  usePoPosition,
  useSubcontractAcceptances,
  usePoVariations,
  useVariationRoute,
  useProjectSubcontractExposure,
  useWorkOrderCostVariations,
  useSubcontractMutations,
} from './useSubcontract';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSubcontract hooks (src/hooks/useSubcontract.ts)', () => {
  it('usePoPosition fetches position for poId', async () => {
    const { Wrapper } = makeWrapper();
    h.getPoPosition.mockResolvedValueOnce([{ boq_item_id: 'b1', item_code: 'L1', po_qty: 100 }]);

    const { result } = renderHook(() => usePoPosition('po-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.getPoPosition).toHaveBeenCalledWith('po-1');
    expect(result.current.data).toEqual([{ boq_item_id: 'b1', item_code: 'L1', po_qty: 100 }]);
  });

  it('useSubcontractAcceptances fetches acceptances for poId', async () => {
    const { Wrapper } = makeWrapper();
    h.listSubcontractAcceptances.mockResolvedValueOnce([{ id: 'acc-1', lines: [] }]);

    const { result } = renderHook(() => useSubcontractAcceptances('po-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.listSubcontractAcceptances).toHaveBeenCalledWith('po-1');
    expect(result.current.data).toEqual([{ id: 'acc-1', lines: [] }]);
  });

  it('usePoVariations fetches variations for poId', async () => {
    const { Wrapper } = makeWrapper();
    h.listPoVariations.mockResolvedValueOnce([{ id: 'var-1', lines: [] }]);

    const { result } = renderHook(() => usePoVariations('po-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.listPoVariations).toHaveBeenCalledWith('po-1');
    expect(result.current.data).toEqual([{ id: 'var-1', lines: [] }]);
  });

  it('useVariationRoute fetches variation route by variationId', async () => {
    const { Wrapper } = makeWrapper();
    h.getVariationRoute.mockResolvedValueOnce({ route: 'standard', line_budget: 1000 });

    const { result } = renderHook(() => useVariationRoute('var-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.getVariationRoute).toHaveBeenCalledWith('var-1');
    expect(result.current.data).toEqual({ route: 'standard', line_budget: 1000 });
  });

  it('useProjectSubcontractExposure fetches exposure by projectId', async () => {
    const { Wrapper } = makeWrapper();
    h.getProjectSubcontractExposure.mockResolvedValueOnce([{ currency: 'IDR', verified_not_on_po_value: 1000 }]);

    const { result } = renderHook(() => useProjectSubcontractExposure('proj-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.getProjectSubcontractExposure).toHaveBeenCalledWith('proj-1');
    expect(result.current.data).toEqual([{ currency: 'IDR', verified_not_on_po_value: 1000 }]);
  });

  it('useWorkOrderCostVariations fetches variations for workOrderId', async () => {
    const { Wrapper } = makeWrapper();
    h.listWorkOrderCostVariations.mockResolvedValueOnce([{ id: 'var-1', amount: 1000 }]);

    const { result } = renderHook(() => useWorkOrderCostVariations('wo-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(h.listWorkOrderCostVariations).toHaveBeenCalledWith('wo-1');
    expect(result.current.data).toEqual([{ id: 'var-1', amount: 1000 }]);
  });

  it('useSubcontractMutations provides mutations that invalidate [subcontract, poId] and procurement detail', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    h.setPoLines.mockResolvedValueOnce(2);
    h.issuePoLines.mockResolvedValueOnce(1);
    h.prepareSubcontractAcceptance.mockResolvedValueOnce('acc-1');
    h.confirmSubcontractAcceptance.mockResolvedValueOnce('acc-1');
    h.withdrawSubcontractAcceptance.mockResolvedValueOnce(undefined);
    h.requestPoVariation.mockResolvedValueOnce('var-1');
    h.decidePoVariation.mockResolvedValueOnce(undefined);
    h.issuePoRevision.mockResolvedValueOnce(2);
    h.linkPoVariation.mockResolvedValueOnce(undefined);
    h.attributeSubcontractBillLines.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useSubcontractMutations('po-1', 'proc-1'), { wrapper: Wrapper });

    await act(async () => {
      await result.current.setPoLines.mutateAsync([]);
    });
    expect(h.setPoLines).toHaveBeenCalledWith('po-1', []);

    await act(async () => {
      await result.current.issuePoLines.mutateAsync();
    });
    expect(h.issuePoLines).toHaveBeenCalledWith('po-1');

    await act(async () => {
      await result.current.prepareAcceptance.mutateAsync({
        acceptanceDate: '2026-11-01',
        lines: [],
      });
    });
    expect(h.prepareSubcontractAcceptance).toHaveBeenCalledWith({
      poId: 'po-1',
      acceptanceDate: '2026-11-01',
      lines: [],
    });

    await act(async () => {
      await result.current.confirmAcceptance.mutateAsync('acc-1');
    });
    expect(h.confirmSubcontractAcceptance).toHaveBeenCalledWith('acc-1');

    await act(async () => {
      await result.current.withdrawAcceptance.mutateAsync('acc-1');
    });
    expect(h.withdrawSubcontractAcceptance).toHaveBeenCalledWith('acc-1');

    await act(async () => {
      await result.current.requestVariation.mutateAsync({
        origin: 'pre_work',
        reason: 'need more',
        lines: [],
      });
    });
    expect(h.requestPoVariation).toHaveBeenCalledWith({
      poId: 'po-1',
      origin: 'pre_work',
      reason: 'need more',
      lines: [],
    });

    await act(async () => {
      await result.current.decideVariation.mutateAsync({ id: 'var-1', approve: true, notes: 'ok' });
    });
    expect(h.decidePoVariation).toHaveBeenCalledWith('var-1', true, 'ok');

    await act(async () => {
      await result.current.issueRevision.mutateAsync('var-1');
    });
    expect(h.issuePoRevision).toHaveBeenCalledWith('var-1');

    await act(async () => {
      await result.current.linkVariation.mutateAsync({ variationId: 'var-1', workOrderId: 'wo-1', reason: null });
    });
    expect(h.linkPoVariation).toHaveBeenCalledWith('var-1', 'wo-1', null);

    await act(async () => {
      await result.current.attributeBillLines.mutateAsync({ invoiceId: 'inv-1', lines: [] });
    });
    expect(h.attributeSubcontractBillLines).toHaveBeenCalledWith('inv-1', []);

    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(calls.some((c) => c.includes('"subcontract"') && c.includes('"po-1"'))).toBe(true);
    expect(calls.some((c) => c.includes('"procurement"'))).toBe(true);
  });
});
