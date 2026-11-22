import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  list: vi.fn(), view: vi.fn(), subcontractPos: vi.fn(), openBackcharges: vi.fn(), rateLines: vi.fn(),
  prepare: vi.fn(), submit: vi.fn(), returnToPreparer: vi.fn(), approve: vi.fn(), cancel: vi.fn(), bill: vi.fn(),
  setDeselection: vi.fn(), prepareAcceptance: vi.fn(), recordBackcharge: vi.fn(), setBackcharge: vi.fn(), setRate: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { subcontractCertificates: h } }));
import {
  useCertificateMutations, useCertificateView, useCertificates, useOpenBackcharges, useRateLines, useSubcontractPos,
} from './useSubcontractCertificates';

const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => { for (const m of Object.values(h)) m.mockReset().mockResolvedValue([]); });

it('the certificate list, view, PO options, open backcharges and rate lines read through the repository', async () => {
  h.list.mockResolvedValue({ rows: [{ id: 'c1' }], hasMore: true });
  const list = renderHook(() => useCertificates({ status: 'submitted' as never, offset: 50 }), { wrapper: wrapper() });
  await waitFor(() => expect(list.result.current.data).toEqual({ rows: [{ id: 'c1' }], hasMore: true }));
  expect(h.list).toHaveBeenCalledWith({ status: 'submitted', offset: 50 });

  const idle = renderHook(() => useCertificateView(undefined), { wrapper: wrapper() });
  expect(idle.result.current.fetchStatus).toBe('idle');
  h.view.mockResolvedValue({ certificate: { id: 'c1' }, derived: { lines: [] } });
  const view = renderHook(() => useCertificateView('c1'), { wrapper: wrapper() });
  await waitFor(() => expect(view.result.current.data).toMatchObject({ certificate: { id: 'c1' } }));
  expect(h.view).toHaveBeenCalledWith('c1');

  h.subcontractPos.mockResolvedValue([{ po_id: 'po1' }]);
  const pos = renderHook(() => useSubcontractPos(), { wrapper: wrapper() });
  await waitFor(() => expect(pos.result.current.data).toEqual([{ po_id: 'po1' }]));

  const idleBack = renderHook(() => useOpenBackcharges(undefined, 'p1'), { wrapper: wrapper() });
  expect(idleBack.result.current.fetchStatus).toBe('idle');
  h.openBackcharges.mockResolvedValue([{ id: 'bc1' }]);
  const back = renderHook(() => useOpenBackcharges('v1', 'p1'), { wrapper: wrapper() });
  await waitFor(() => expect(back.result.current.data).toEqual([{ id: 'bc1' }]));
  expect(h.openBackcharges).toHaveBeenCalledWith('v1', 'p1');

  h.rateLines.mockResolvedValue([{ id: 'r1' }]);
  const rates = renderHook(() => useRateLines('v1'), { wrapper: wrapper() });
  await waitFor(() => expect(rates.result.current.data).toEqual([{ id: 'r1' }]));
  expect(h.rateLines).toHaveBeenCalledWith('v1');
});

it('every certificate write forwards its payload verbatim', async () => {
  const { result } = renderHook(() => useCertificateMutations(), { wrapper: wrapper() });
  h.prepare.mockResolvedValue('c1');
  await act(async () => { await result.current.prepare.mutateAsync({ poId: 'po1', periodStart: '2026-03-01' }); });
  expect(h.prepare).toHaveBeenCalledWith('po1', '2026-03-01');
  h.submit.mockResolvedValue(undefined);
  await act(async () => { await result.current.submit.mutateAsync('c1'); });
  expect(h.submit).toHaveBeenCalledWith('c1');
  h.returnToPreparer.mockResolvedValue(undefined);
  await act(async () => { await result.current.returnToPreparer.mutateAsync({ id: 'c1', reason: 'twice' }); });
  expect(h.returnToPreparer).toHaveBeenCalledWith('c1', 'twice');
  h.approve.mockResolvedValue(undefined);
  await act(async () => { await result.current.approve.mutateAsync('c1'); });
  expect(h.approve).toHaveBeenCalledWith('c1');
  h.cancel.mockResolvedValue(undefined);
  await act(async () => { await result.current.cancel.mutateAsync({ id: 'c1', reason: 'duplicate' }); });
  expect(h.cancel).toHaveBeenCalledWith('c1', 'duplicate');
  h.bill.mockResolvedValue({ status: 'billed' });
  await act(async () => { await result.current.bill.mutateAsync({ certificateId: 'c1', invoiceDate: '2026-03-10' }); });
  expect(h.bill).toHaveBeenCalledWith({ certificateId: 'c1', invoiceDate: '2026-03-10' });
  h.setDeselection.mockResolvedValue(undefined);
  const deselection = { certificateId: 'c1', workDate: 'd', workOrderLineId: 'l', crewId: 'cr', deselect: true, reason: 'rain' } as never;
  await act(async () => { await result.current.setDeselection.mutateAsync(deselection); });
  expect(h.setDeselection).toHaveBeenCalledWith(deselection);
  h.prepareAcceptance.mockResolvedValue('acc1');
  await act(async () => { await result.current.prepareAcceptance.mutateAsync('c1'); });
  expect(h.prepareAcceptance).toHaveBeenCalledWith('c1');
  h.recordBackcharge.mockResolvedValue('bc1');
  const backcharge = { vendorId: 'v1', projectId: 'p1', amount: 5, currency: 'IDR', reasonCode: 'DAM' } as never;
  await act(async () => { await result.current.recordBackcharge.mutateAsync(backcharge); });
  expect(h.recordBackcharge).toHaveBeenCalledWith(backcharge);
  h.setBackcharge.mockResolvedValue(undefined);
  await act(async () => { await result.current.setBackcharge.mutateAsync({ certificateId: 'c1', backchargeId: 'bc1', include: true }); });
  expect(h.setBackcharge).toHaveBeenCalledWith('c1', 'bc1', true);
  h.setRate.mockResolvedValue('r1');
  const rate = { vendorId: 'v1', boqItemId: 'b1', unit: 'm3', rate: 2, currency: 'IDR', effectiveFrom: '2026-03-01' } as never;
  await act(async () => { await result.current.setRate.mutateAsync(rate); });
  expect(h.setRate).toHaveBeenCalledWith(rate);
});
