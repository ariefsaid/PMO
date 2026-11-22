import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { QueryClientTestProvider } from '@/test/QueryClientTestProvider';
// C11: the follow-up task button mounts with its host page now, so every render here runs
// inside the shared test query client and the button's open-task read is stubbed quiet.
const render = ((ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(<QueryClientTestProvider>{ui}</QueryClientTestProvider>, options)) as typeof rtlRender;
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { repositories: { ...actual.repositories, task: { ...actual.repositories.task, findOpenForRecord: async () => null } } };
});

import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  th: { pct1: 80, pct2: 100 } as { pct1: number | null; pct2: number | null },
  req: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  waiting: { data: [] as unknown[] },
  userId: 'u-approver',
  keepers: [{ warehouse_id: 'w1', user_id: 'u-approver' }] as unknown[],
  decide: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: () => h.req,
  useWaitingForMe: () => h.waiting,
  useDeliveryNoteSettings: () => ({ data: null }),
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

vi.mock('@/src/hooks/useUsageThresholds', () => ({ useUsageThresholds: () => ({ thresholds: h.th, reload: vi.fn() }) }));

import MaterialRequestDetailPage from './MaterialRequestDetail';

const step = (position: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: `s${position}`, round: 1, position, role: 'Project Manager', label: `Check ${position}`, status, decidedBy: null, actedFor: null, decidedAt: null, reason: null, ...extra,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1', number: 'MRQ-0001', workOrderId: 'w', projectId: 'p', toWarehouseId: null, neededBy: '2026-11-25', note: null, status: 'pending', round: 1,
  createdBy: 'u-author', createdAt: '2026-11-19T08:00:00Z', submittedAt: '2026-11-19T08:05:00Z', transferDocumentId: null, transferCancelled: false,
  lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', quantity: 12, planQty: 10, priorQty: 0, overPlanReason: 'Extra slab' }],
  steps: [step(1, 'approved', { decidedBy: 'u-away', decidedAt: '2026-11-19T09:00:00Z' }), step(2, 'open'), step(3, 'waiting')],
  events: [],
  ...over,
});
const renderPage = () => render(
  <MemoryRouter initialEntries={['/material-requests/r1']}><ToastProvider>
    <Routes><Route path="/material-requests/:requestId" element={<MaterialRequestDetailPage />} /></Routes>
  </ToastProvider></MemoryRouter>);

describe('AC-MUT-009 usage warning on the request detail', () => {
  beforeEach(() => {
    h.userId = 'u-approver';
    h.keepers = [];
    h.waiting = { data: [] };
    h.req = { data: request(), isPending: false, isError: false, refetch: vi.fn() };
  });
  it('shows the warning for a line past a threshold, from the stored plan snapshot', () => {
    h.th = { pct1: 80, pct2: 100 };
    renderPage();
    expect(screen.getByTestId('mrq-usage-warning')).toHaveTextContent('Use reaches 120% of plan, past the 100% warning.');
  });
  it('shows nothing while the thresholds are unset', () => {
    h.th = { pct1: null, pct2: null };
    renderPage();
    expect(screen.queryByTestId('mrq-usage-warning')).not.toBeInTheDocument();
  });
});
