import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mutable hook state (mirrors ProcurementDetails.test.tsx's harness)
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: vi.fn(), isPending: false },
    createRfq: { mutateAsync: vi.fn(), isPending: false },
    createPurchaseOrder: { mutateAsync: vi.fn(), isPending: false },
    createPayment: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/pages/procurement/ProcurementFilesSubsection', () => ({
  ProcurementFilesSubsection: () => null,
}));
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: vi.fn(), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn(), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn(), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
  }),
}));
const docsState = { data: [], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useProcurementCrudMutations: () => ({
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    createItem: { mutateAsync: vi.fn(), isPending: false },
    updateItem: { mutateAsync: vi.fn(), isPending: false },
    deleteItem: { mutateAsync: vi.fn(), isPending: false },
    selectQuote: { mutateAsync: vi.fn(), isPending: false },
    createDocument: { mutateAsync: vi.fn(), isPending: false },
    deleteDocument: { mutateAsync: vi.fn(), isPending: false },
  }),
  useProcurementDocuments: () => docsState,
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
}));
let mockEffectiveRole = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole, realRole: mockEffectiveRole }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import ProcurementDetails from '../ProcurementDetails';

const orderedProcurement = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Ordered' as const,
  total_value: 50000,
  pr_number: 'PR-2601100001',
  po_number: 'PO-2601100001',
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: 'u-finance',
  vendor_id: 'v-1',
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001', budget: 1000000, spent: 500000 },
  vendor: { name: 'Apex Supply' },
  requested_by: { full_name: 'Alice Manager' },
  approved_by: { full_name: 'Finance User' },
  items: [
    { id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Desk', description: null, quantity: 2, rate: 100, amount: 200 },
  ],
  quotations: [
    { id: 'q-1', procurement_id: 'proc-001', vendor_id: 'v-1', total_amount: 48000, vq_number: 'VQ-2601100001', is_selected: true, reference: 'VQ-2601100001', received_date: '2026-01-10', org_id: 'org-1', created_at: '2026-01-10T00:00:00Z' },
  ],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [
    { id: 'se1', procurement_id: 'proc-001', from_status: null, to_status: 'Requested', actor_id: 'u-other', created_at: '2026-04-28T09:00:00Z', org_id: 'org-1' },
    { id: 'se2', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Approved', actor_id: 'u-finance', created_at: '2026-04-29T09:00:00Z', org_id: 'org-1' },
  ],
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProcurementDetails — tabbed record shell (Slice 1)', () => {
  beforeEach(() => {
    detailState.data = { ...orderedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Finance';
    navigate.mockClear();
  });

  it('renders the Procurement tablist with Overview · Line items · Documents · Vendor quotes', () => {
    renderAt('/procurement/proc-001');
    const tablist = screen.getByRole('tablist', { name: /Procurement sections/i });
    expect(within(tablist).getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Line items/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Documents/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Vendor quotes/ })).toBeInTheDocument();
  });

  it('defaults to the Overview tab when no :tab param is present', () => {
    renderAt('/procurement/proc-001');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // The Overview bento renders its progression timeline.
    expect(screen.getByTestId('procurement-progression')).toBeInTheDocument();
  });

  it('an unknown :tab param falls back to Overview', () => {
    renderAt('/procurement/proc-001/bogus');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('deep-links to the Documents tab via /procurement/:id/documents', () => {
    renderAt('/procurement/proc-001/documents');
    expect(screen.getByRole('tab', { name: /Documents/ })).toHaveAttribute('aria-selected', 'true');
    // The Overview-only progression slot is NOT rendered on the Documents panel.
    expect(screen.queryByTestId('procurement-progression')).toBeNull();
  });

  it('deep-links to the Line items tab and shows the line-items section', () => {
    renderAt('/procurement/proc-001/items');
    expect(screen.getByRole('tab', { name: /Line items/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
  });

  it('clicking a tab navigates (replace) to its deep-link', async () => {
    renderAt('/procurement/proc-001');
    await userEvent.click(screen.getByRole('tab', { name: /Vendor quotes/ }));
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-001/quotes', { replace: true });
  });

  it('ArrowRight moves selection to the next tab (roving keyboard nav)', async () => {
    renderAt('/procurement/proc-001');
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-001/items', { replace: true });
  });

  it('the active panel is a role=tabpanel labelled by the active tab (a11y wiring)', () => {
    renderAt('/procurement/proc-001');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'procurement-detail-tabpanel-overview');
    expect(panel).toHaveAttribute('aria-labelledby', 'procurement-detail-tab-overview');
  });

  it('the RecordActionZone is rendered OUTSIDE the tabs (present on every tab)', () => {
    renderAt('/procurement/proc-001/documents');
    expect(screen.getByTestId('record-action-zone')).toBeInTheDocument();
  });

  it('the tab count badges reflect items / documents / quotes counts', () => {
    renderAt('/procurement/proc-001');
    // 1 item, 1 quotation, 0 documents-collection rows.
    expect(screen.getByRole('tab', { name: /Line items\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Vendor quotes\s*1/ })).toBeInTheDocument();
  });

  it('CanWrite gating still applies: an Engineer non-requester is NOT offered Confirm Receipt', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...orderedProcurement, requested_by_id: 'u-other' };
    renderAt('/procurement/proc-001');
    // Ordered→Received authority excludes a non-requester Engineer.
    expect(screen.queryByRole('button', { name: /confirm receipt/i })).toBeNull();
  });

  it('the action zone advance verb shows for an authorized viewer (Confirm Receipt at Ordered for PM)', () => {
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...orderedProcurement, requested_by_id: 'u-other' };
    renderAt('/procurement/proc-001/documents');
    // Verb is in the action zone regardless of active tab.
    expect(screen.getByRole('button', { name: /confirm receipt/i })).toBeInTheDocument();
  });
});
