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

import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  req: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  waiting: { data: [] as unknown[] },
  dnSettings: { data: { enabled: false, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] } },
  userId: 'u-approver',
  keepers: [{ warehouse_id: 'w1', user_id: 'u-approver' }] as unknown[],
  decide: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: () => h.req,
  useWaitingForMe: () => h.waiting,
  useDeliveryNoteSettings: () => h.dnSettings,
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

import MaterialRequestDetailPage from './MaterialRequestDetail';

const step = (position: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: `s${position}`, round: 1, position, role: 'Project Manager', label: `Check ${position}`, status, decidedBy: null, actedFor: null, decidedAt: null, reason: null, ...extra,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1', number: 'MRQ-0001', workOrderId: 'w', projectId: 'p', toWarehouseId: null, neededBy: '2026-11-25', note: null, status: 'pending', round: 1,
  createdBy: 'u-author', createdAt: '2026-11-19T08:00:00Z', submittedAt: '2026-11-19T08:05:00Z', transferDocumentId: null, transferCancelled: false,
  lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', quantity: 12, planQty: 10, planSource: null, priorQty: 0, overPlanReason: 'Extra slab' }],
  steps: [step(1, 'approved', { decidedBy: 'u-away', decidedAt: '2026-11-19T09:00:00Z' }), step(2, 'open'), step(3, 'waiting')],
  events: [],
  ...over,
});
const renderPage = () => render(
  <MemoryRouter initialEntries={['/material-requests/r1']}><ToastProvider>
    <Routes><Route path="/material-requests/:requestId" element={<MaterialRequestDetailPage />} /></Routes>
  </ToastProvider></MemoryRouter>);

describe('material request detail', () => {
  beforeEach(() => {
    h.userId = 'u-approver';
    h.keepers = [{ warehouse_id: 'w1', user_id: 'u-approver' }];
    h.waiting = { data: [{ requestId: 'r1', stepPosition: 2, role: 'Project Manager', label: 'Check 2', actingFor: null, submittedAt: '2026-11-19T08:05:00Z' }] };
    h.req = { data: request(), isPending: false, isError: false, refetch: vi.fn() };
    h.decide.mutateAsync = vi.fn().mockResolvedValue(undefined);
  });

  it.each([
    ['standard', 'From usage standards'], ['adjusted', 'Adjusted by the planner'], ['allowance', 'From material allowance'], ['none', 'No plan'],
  ])('AC-CUS-008 the approver sees the source of the snapshotted plan figure: %s', (source, label) => {
    h.req = { data: request({ lines: [{ id: 'l1', lineNo: 1, itemId: 'i1', quantity: 12, planQty: 10, planSource: source, priorQty: 0, overPlanReason: null }] }), isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByTestId('mrq-detail-plan-source')).toHaveTextContent(label);
  });
  it('FR-CUS-012 a request submitted before plan sources existed shows no label', () => {
    renderPage();
    expect(screen.queryByTestId('mrq-detail-plan-source')).not.toBeInTheDocument();
  });

  it('shows the chain with who acted and the line against plan', () => {
    renderPage();
    expect(screen.getByTestId('mrq-chain')).toHaveTextContent('Finn Away');
    expect(screen.getByText(/Over plan: Extra slab/)).toBeInTheDocument();
    expect(screen.getByText(/Plan 10 · already requested 0 · new total 12/)).toBeInTheDocument();
  });

  it('#2609 header names the work order (linked) and its project', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'WO-0042 · Slab pour' })).toHaveAttribute('href', '/work-orders/w');
    expect(screen.getByText(/Harbour Road/)).toBeInTheDocument();
  });

  it('AC-MRQ-013 offers Approve only for the step in my queue', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('AC-MRQ-003 never offers Approve to the author, even with the step in their queue', () => {
    h.userId = 'u-author';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('offers no decision when the step is not in my queue', () => {
    h.waiting = { data: [] };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('a middle step approves without asking for a warehouse', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!);
    expect(h.decide.mutateAsync).toHaveBeenCalledWith({ id: 'r1', position: 2, decision: 'approve', reason: undefined, sourceWarehouseId: null });
  });

  it('the final step needs the source warehouse before it can approve (FR-MRQ-011)', async () => {
    h.req = { data: request({ steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'open')] }), isPending: false, isError: false, refetch: vi.fn() };
    h.waiting = { data: [{ requestId: 'r1', stepPosition: 3, role: 'Project Manager', label: 'Check 3', actingFor: null, submittedAt: '2026-11-19T08:05:00Z' }] };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = screen.getAllByRole('button', { name: 'Approve' }).at(-1)!;
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/Warehouse the material leaves from/), 'w1');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(h.decide.mutateAsync).toHaveBeenCalledWith({ id: 'r1', position: 3, decision: 'approve', reason: undefined, sourceWarehouseId: 'w1' });
  });

  it('a database refusal is shown as one plain sentence in the dialog', async () => {
    h.decide.mutateAsync = vi.fn().mockRejectedValue(new Error('MRQ_OUT_OF_ORDER: step 1 first'));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!);
    expect(await screen.findByText('An earlier step has not been approved yet.')).toBeInTheDocument();
  });

  it('AC-MRQ-007 links an approved request to its transfer draft', () => {
    h.req = { data: request({ status: 'approved', transferDocumentId: 'doc-9', steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'approved')] }), isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByRole('link', { name: 'Open the delivery document' })).toHaveAttribute('href', '/stock/documents/doc-9');
  });

  it('says so when no one holds the open step', () => {
    h.req = { data: request({ steps: [step(1, 'approved'), step(2, 'waiting'), step(3, 'waiting')] }), isPending: false, isError: false, refetch: vi.fn() };
    h.waiting = { data: [] };
    renderPage();
    expect(screen.getByText(/No approver is available/)).toBeInTheDocument();
  });

  it('#2607 shows transfer retry to a source-warehouse keeper after cancellation', () => {
    const approved = { status: 'approved', transferDocumentId: 'doc-9', transferCancelled: true, steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'approved')] };
    h.req = { data: request(approved), isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByRole('button', { name: 'Create the transfer again' })).toBeInTheDocument();
  });

  it('#2614 hides transfer retry from a non-keeper', () => {
    h.userId = 'u-away';
    h.req = { data: request({ status: 'approved', transferDocumentId: 'doc-9', transferCancelled: true, steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'approved')] }), isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Create the transfer again' })).not.toBeInTheDocument();
  });

  it('#2607 hides the transfer retry from the author', () => {
    h.userId = 'u-author';
    h.req = { data: request({ status: 'approved', transferDocumentId: 'doc-9', transferCancelled: true, steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'approved')] }), isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Create the transfer again' })).not.toBeInTheDocument();
  });

  describe('#2687 printable delivery note action', () => {
    it('AC-DNP-001 shows print action when delivery notes are enabled and request is approved', () => {
      h.dnSettings = { data: { enabled: true, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] } };
      h.req = {
        data: request({ status: 'approved', steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'approved')] }),
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
      renderPage();
      expect(screen.getByRole('button', { name: 'Print delivery note' })).toBeInTheDocument();
    });

    it('AC-DNP-002 hides print action when delivery notes are disabled', () => {
      h.dnSettings = { data: { enabled: false, signatureBlocks: [] } };
      h.req = {
        data: request({ status: 'approved', steps: [step(1, 'approved'), step(2, 'approved'), step(3, 'approved')] }),
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
      renderPage();
      expect(screen.queryByRole('button', { name: 'Print delivery note' })).not.toBeInTheDocument();
    });

    it('AC-DNP-003 hides print action when request is pending even if enabled', () => {
      h.dnSettings = { data: { enabled: true, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] } };
      h.req = {
        data: request({ status: 'pending', steps: [step(1, 'approved'), step(2, 'open'), step(3, 'waiting')] }),
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      };
      renderPage();
      expect(screen.queryByRole('button', { name: 'Print delivery note' })).not.toBeInTheDocument();
    });
  });
});
