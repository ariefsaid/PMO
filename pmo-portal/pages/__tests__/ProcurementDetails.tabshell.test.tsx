import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

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

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/hooks/useProcurementItemEligibility', () => ({ useProcurementItemEligibility: () => ({ data: true, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }) }));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
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
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

// LedgerFileCell's AttachButton calls useProcurementFiles → useQuery → needs a QueryClient.
// Stub the hook so tabshell tests stay QueryClient-free.
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: vi.fn(() => ({
    list: { data: [], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(async () => 'https://signed/url'),
    progress: null,
    uploadError: null,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  })),
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: vi.fn(), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn(), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn(), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
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
vi.mock('react-router', async (orig) => {
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
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));

vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
import ProcurementDetails from '../ProcurementDetails';

const orderedProcurement = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Ordered' as const,
  total_value: 50000, currency: 'USD',
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
    { id: 'q-1', procurement_id: 'proc-001', vendor_id: 'v-1', total_amount: 48000, currency: 'USD', vq_number: 'VQ-2601100001', is_selected: true, reference: 'VQ-2601100001', received_date: '2026-01-10', org_id: 'org-1', created_at: '2026-01-10T00:00:00Z' },
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

  // The record page's tabs are now Timeline · Line items · Quotations · Files · Details (#1404): the old
  // Overview is the Timeline (the legacy overview/history paths resolve to it), Documents became
  // Files (the legacy documents path resolves there), Vendor quotes became Quotations, and the lifecycle verb lives in the RecordHeader actions.
  it('renders the Procurement tablist with Timeline · Line items · Quotations · Files · Details', () => {
    renderAt('/procurement/proc-001');
    const tablist = screen.getByRole('tablist', { name: /Procurement sections/i });
    expect(within(tablist).getByRole('tab', { name: /Timeline/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Line items/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Quotations/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Files/ })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Details/ })).toBeInTheDocument();
  });

  it('defaults to the Timeline tab when no :tab param is present', () => {
    renderAt('/procurement/proc-001');
    expect(screen.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
    // The Timeline panel renders the case timeline.
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: /Timeline/ })).toBeInTheDocument();
  });

  it('an unknown :tab param falls back to Timeline', () => {
    renderAt('/procurement/proc-001/bogus');
    expect(screen.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a legacy /procurement/:id/documents link (bill and slip deep links) lands on Files', () => {
    renderAt('/procurement/proc-001/documents');
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true');
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-001/files', expect.anything());
  });

  it('deep-links to the Files tab via /procurement/:id/files', () => {
    renderAt('/procurement/proc-001/files');
    expect(screen.getByRole('tab', { name: /Files/ })).toHaveAttribute('aria-selected', 'true');
    // The Timeline-only panel content is NOT rendered on the Files panel.
    expect(screen.getByTestId('procurement-tabpanel-files')).toBeInTheDocument();
    expect(screen.queryByTestId('procurement-tabpanel-timeline')).toBeNull();
  });

  it('routes an order intake handoff through the Files tab capture row', () => {
    detailState.data = { ...orderedProcurement, status: 'Draft', purchase_orders: [] };
    renderAt('/procurement/proc-001/timeline?record=po');

    expect(navigate).toHaveBeenCalledWith('/procurement/proc-001/files', expect.objectContaining({ replace: true }));
    expect(screen.queryByTestId('procurement-record-capture')).toBeNull();
  });

  it('deep-links to the Line items tab and shows the line-items section', () => {
    renderAt('/procurement/proc-001/items');
    expect(screen.getByRole('tab', { name: /Line items/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
  });

  // list-working-set-return (#682): tab switches now forward the current router `location.state`
  // so a captured list-return context survives a tab change (Director ruling 2026-09-29 amended
  // — same class as the other `{ replace: true }` tab-switch assertions).
  it('clicking a tab navigates (replace) to its deep-link, forwarding location.state', async () => {
    renderAt('/procurement/proc-001');
    await userEvent.click(screen.getByRole('tab', { name: /Quotations/ }));
    // #879: the navigation carries the tab-switch marker (AppShell route-focus exemption).
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-001/quotes', {
      replace: true,
      state: { pmoTabSwitch: true },
    });
  });

  it('ArrowRight moves selection to the next tab (roving keyboard nav), forwarding location.state', async () => {
    renderAt('/procurement/proc-001');
    const first = screen.getByRole('tab', { name: /Timeline/ });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    // #879: the navigation carries the tab-switch marker (AppShell route-focus exemption).
    expect(navigate).toHaveBeenCalledWith('/procurement/proc-001/items', {
      replace: true,
      state: { pmoTabSwitch: true },
    });
  });

  it('the active panel is a role=tabpanel labelled by the active tab (a11y wiring)', () => {
    renderAt('/procurement/proc-001');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'procurement-detail-tabpanel-timeline');
    expect(panel).toHaveAttribute('aria-labelledby', 'procurement-detail-tab-timeline');
  });

  it('the RecordHeader action area is rendered OUTSIDE the tabs (present on every tab)', () => {
    renderAt('/procurement/proc-001/files');
    expect(screen.getByTestId('record-header-actions')).toBeInTheDocument();
  });

  it('the tab count badges reflect items / quotes counts', () => {
    renderAt('/procurement/proc-001');
    // 1 item, 1 quotation.
    expect(screen.getByRole('tab', { name: /Line items\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Quotations\s*1/ })).toBeInTheDocument();
  });

  it('CanWrite gating still applies: a Finance non-requester is NOT offered Record receipt', () => {
    // (An Engineer only opens purchases they raised, so Finance is the viewer without receipt authority.)
    mockEffectiveRole = 'Finance';
    detailState.data = { ...orderedProcurement, requested_by_id: 'u-other' };
    renderAt('/procurement/proc-001');
    // Ordered→Received authority is the requester or a Project Manager; the header is otherwise present.
    expect(screen.getByTestId('record-header-actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record receipt/i })).toBeNull();
  });

  it('the header advance verb shows for an authorized viewer (Record receipt at Ordered for PM)', () => {
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...orderedProcurement, requested_by_id: 'u-other' };
    renderAt('/procurement/proc-001/files');
    // Verb is in the header actions regardless of active tab.
    expect(within(screen.getByTestId('record-header-actions')).getByRole('button', { name: /record receipt/i })).toBeInTheDocument();
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
