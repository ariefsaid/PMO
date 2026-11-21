import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  ns: [] as unknown[],
  req: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  waiting: { data: [] as unknown[] },
  userId: 'u-approver',
  keepers: [{ warehouse_id: 'w1', user_id: 'u-approver' }] as unknown[],
  decide: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: () => h.req,
  useWaitingForMe: () => h.waiting,
  useMaterialRequestMutations: () => ({
    decide: h.decide, cancel: { mutateAsync: vi.fn(), isPending: false }, retryTransfer: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({ data: [{ id: 'i1', code: 'CEM', name: 'Cement' }] }),
  useStockWarehouses: () => ({ data: [{ id: 'w1', code: 'MAIN', name: 'Main store', kind: 'central', archived_at: null }] }),
  useStockKeepers: () => ({ data: h.keepers }),
}));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: () => ({ data: { id: 'w', wo_number: 'WO-0042', title: 'Slab pour' } }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p', name: 'Harbour Road', short_name: null, code: null }] }) }));
vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [{ id: 'u-author', full_name: 'Eli Engineer' }, { id: 'u-approver', full_name: 'Pia Manager' }, { id: 'u-away', full_name: 'Finn Away' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));
vi.mock('@/src/components/shell', () => ({ BackBar: () => null }));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: (ns?: unknown, o?: unknown) => { h.ns.push(ns); return (actual.useTranslation as (a?: unknown, b?: unknown) => unknown)(ns, o); } };
});

import MaterialRequestDetailPage from './MaterialRequestDetail';

describe('AC-MRI-018 detail page namespaces', () => {
  it('asks for the stock catalogue together with its own, so nothing suspends after the approve dialog opens', () => {
    h.req = { data: { id: 'r1', number: 'MRQ-0001', workOrderId: 'w', projectId: 'p', neededBy: '2026-11-25', note: null, status: 'pending', round: 1, createdBy: 'u-author', transferDocumentId: null, transferCancelled: false, lines: [], steps: [], events: [], createdAt: '2026-11-19T08:00:00Z' }, isPending: false, isError: false, refetch: vi.fn() };
    render(<MemoryRouter initialEntries={['/material-requests/r1']}><ToastProvider><Routes><Route path="/material-requests/:requestId" element={<MaterialRequestDetailPage />} /></Routes></ToastProvider></MemoryRouter>);
    expect(h.ns).toContainEqual(['materialRequests', 'stock']);
  });
});
