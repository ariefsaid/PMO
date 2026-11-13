import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';
const itemEligibility = vi.hoisted(() => ({ data: true, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }));
const recordPush = vi.hoisted(() => ({ status: 'idle' as string, error: null }));
vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('@/src/hooks/useProcurementItemEligibility', () => ({ useProcurementItemEligibility: () => itemEligibility }));
afterEach(() => { clearOwnershipCache(); itemEligibility.data = true; itemEligibility.isPending = false; itemEligibility.isError = false; itemEligibility.isFetching = false; recordPush.status = 'idle'; subcontractPosition.data = []; subcontractPosition.isPending = false; subcontractPosition.isError = false; });

// OD-TAX-1 (#548): the money forms now PRE-SELECT the org's `default_tax_treatment`, which is a
// live org read (`useOrgTaxDefault` → react-query + AuthContext). Only the READ is stubbed here —
// `useTaxTreatmentPreselect` stays the real implementation, so this suite renders the shipped
// seeding behaviour without needing a QueryClientProvider/AuthProvider it otherwise has no use for.
// The pre-selection rule itself is owned by src/hooks/useOrgTaxDefault.test.tsx.
const orgDefault = vi.hoisted(() => ({ value: 'exclusive' as string | undefined }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => orgDefault.value };
});
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({
    data: { procurement: true, procurement_full: true },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

// Clicks the Confirm button inside the active confirm dialog (the
// confirm-before-write gate now wraps every mutation). Works for both the
// default (role="dialog") and destructive (role="alertdialog") surfaces.
async function confirmInDialog(label: RegExp | string) {
  // Wait for whichever surface mounted, then click its confirm button.
  const dialog = await screen.findByRole('dialog').catch(() => screen.findByRole('alertdialog'));
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

// ---------------------------------------------------------------------------
// Mutable hook state (mutable so each test can set it via beforeEach)
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};
const linkedDocsState = vi.hoisted(() => ({ data: [] as Record<string, unknown>[] }));
const erpState = vi.hoisted(() => ({ data: [] as Record<string, unknown>[] }));
const purchaseChoices = vi.hoisted(() => ({ data: [{ id: 'pur-1', title: 'Steel procurement', status: 'Ordered', project_id: 'proj-1', currency: 'USD', vendor: { name: 'Apex Supply' } }] as Record<string, unknown>[] }));
const fileState = vi.hoisted(() => ({ files: [] as Record<string, unknown>[] }));
const projectScopeState = vi.hoisted(() => ({ data: { project_manager_id: 'u-alice' } as Record<string, unknown> | null, isPending: false, isError: false }));

vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => projectScopeState }));

const mockTransition = vi.fn().mockResolvedValue(undefined);
const mockCreateQuotation = vi.fn().mockResolvedValue({ id: 'q-new' });
const mockCreateReceipt = vi.fn().mockResolvedValue({ id: 'r-new' });
const mockCreateInvoice = vi.fn().mockResolvedValue({ id: 'i-new' });
const mockCreatePurchaseRequest = vi.fn().mockResolvedValue({ id: 'pr-new' });
const mockCreateRfq = vi.fn().mockResolvedValue({ id: 'rfq-new' });
const mockCreatePayment = vi.fn().mockResolvedValue({ id: 'pay-new' });
const mockCreatePurchaseOrder = vi.fn().mockResolvedValue({ id: 'po-new' });
const mockCaptureVendorInvoice = vi.fn().mockResolvedValue({ id: 'vi-new' });
const mockCaptureSubcontractVendorInvoice = vi.fn().mockResolvedValue({ id: 'vi-sub-new' });
const subcontractPosition = vi.hoisted(() => ({
  data: [] as Record<string, unknown>[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
}));
vi.mock('@/src/hooks/useSubcontract', () => ({ usePoPosition: () => subcontractPosition }));
vi.mock('@/pages/procurement/SubcontractLinesSection', () => ({ SubcontractLinesSection: () => null }));

// The per-phase file sub-section has its own unit test + needs a QueryClient;
// stub it here so the page tests stay focused on the lifecycle behavior.
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProcurementRecords', () => ({
  useProcurementRecordMutations: () => ({
    createPurchaseRequest: { mutateAsync: mockCreatePurchaseRequest, isPending: false },
    createRfq: { mutateAsync: mockCreateRfq, isPending: false },
    createPurchaseOrder: { mutateAsync: mockCreatePurchaseOrder, isPending: false },
    createPayment: { mutateAsync: mockCreatePayment, isPending: false },
    pendingPush: recordPush,
  }),
}));

// LedgerFileCell's AttachButton calls useProcurementFiles → useQuery → needs a QueryClient.
// Stub the hook so ProcurementDetails tests stay QueryClient-free.
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: vi.fn(() => ({
    list: { data: fileState.files, isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(async () => 'https://signed/url'),
    progress: null,
    uploadError: null,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  })),
}));

const mockApproveAmount = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: mockCreateQuotation, isPending: false, error: null },
    createReceipt: { mutateAsync: mockCreateReceipt, isPending: false, error: null },
    createInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: mockCaptureVendorInvoice, isPending: false, error: null },
    captureSubcontractVendorInvoice: { mutateAsync: mockCaptureSubcontractVendorInvoice, isPending: false, error: null },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
    approveAmount: { mutateAsync: mockApproveAmount, isPending: false },
  }),
}));

// CRUD slice hooks (editing paths). Stubbed so the detail-page tests can assert
// the affordances + delegation without a live repository.
const mockUpdateHeader = vi.fn().mockResolvedValue(undefined);
const mockCreateItem = vi.fn().mockResolvedValue({ id: 'it-new' });
const mockUpdateItem = vi.fn().mockResolvedValue(undefined);
const mockDeleteItem = vi.fn().mockResolvedValue(undefined);
const mockSelectQuote = vi.fn().mockResolvedValue(undefined);
const mockCreateDocument = vi.fn().mockResolvedValue({ id: 'd-new' });
const mockDeleteDocument = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useProcurementCrudMutations: () => ({
    updateHeader: { mutateAsync: mockUpdateHeader, isPending: false },
    createItem: { mutateAsync: mockCreateItem, isPending: false },
    updateItem: { mutateAsync: mockUpdateItem, isPending: false },
    deleteItem: { mutateAsync: mockDeleteItem, isPending: false },
    selectQuote: { mutateAsync: mockSelectQuote, isPending: false },
    createDocument: { mutateAsync: mockCreateDocument, isPending: false },
    deleteDocument: { mutateAsync: mockDeleteDocument, isPending: false },
  }),
}));

// FK pickers (header edit project/vendor, quotation vendor) read cached option
// hooks; stub them so the detail test needs no QueryClient.
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }, { value: 'v-syn', label: 'Synergy Systems', sub: 'Vendor' }, { value: 'v-apx', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
}));

// Default role — overridden in specific tests. ADR-0016: the page now gates write
// affordances on the REAL JWT role, so the mock returns realRole alongside
// effectiveRole (equal here — no impersonation in these specs). Behavior is unchanged;
// this mirrors the realRole field already supplied by the Budget/StatusControl tests.
let mockEffectiveRole = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole, realRole: mockEffectiveRole }),
}));

// Toast: the IA-3 detail page emits a success toast on transition. Tabs are
// gone — back-nav is a plain react-router navigate (AC-NAV-007).
const toast = vi.fn();
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }) };
});

// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel is now mounted in ProcurementDetails.
// Stub useProjectBudget so the panel renders a real (non-loading) state without a
// QueryClientProvider — the detail-page tests assert existing lifecycle behavior, not
// the budget panel itself (that is covered by DecisionSupportPanel.test.tsx).
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel also reads committed spend.
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: purchaseChoices.data, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

const mockLinkErpDocuments = vi.fn().mockResolvedValue({ results: [] });
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({
  useLinkedErpDocuments: () => ({ data: linkedDocsState.data, isError: false, isPending: false }),
  useLinkErpDocuments: () => ({ mutateAsync: mockLinkErpDocuments, isPending: false }),
  useUnlinkErpDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpOrphans: () => ({ data: erpState.data, isError: false, isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/src/components/documents/viewerContext', () => ({ useViewerOnDemand: () => ({ open: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useErpJournalLines', () => import('@/pages/__tests__/helpers/erpJournalLinesMock'));
vi.mock('@/src/hooks/useOdoo', () => ({
  useMasterRecords: () => ({ data: { rows: [], total: 0 }, isError: false }),
  useMasterSummary: () => ({ data: { asOf: '2026-11-13T00:00:00.000Z' } }),
}));
vi.mock('@/src/hooks/useOdooPurchase', () => ({
  useOdooPurchaseCommands: () => ({ data: [], isError: false }),
  useOdooUnreachable: () => ({ unreachable: false, lastOkAt: null }),
  useResolveHeldPayment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useOdooRevenue', () => ({
  useOdooRevenueCommands: () => ({ data: [], isError: false }),
  useResolveHeldRevenueCommand: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({
    record: { mutateAsync: vi.fn(), isPending: false },
    correct: { mutateAsync: vi.fn(), isPending: false },
    void: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const baseProcurement = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 50000,
  currency: 'USD',
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-alice',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001', budget: 1000000, spent: 500000 },
  vendor: null,
  requested_by: { full_name: 'Alice Manager' },
  approved_by: null,
  items: [],
  quotations: [],
  receipts: [],
  invoices: [],
  // I1/I3 (design-review): the ERP-canonical record arrays are required for stepper
  // refs and sparse tile derivation. Base fixture starts empty (no records yet).
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

const orderedProcurement = {
  ...baseProcurement,
  status: 'Ordered' as const,
  pr_number: 'PR-2601100001',
  po_number: 'PO-2601100001',
  approved_by_id: 'u-finance',
  approved_by: { full_name: 'Finance User' },
  quotations: [
    {
      id: 'q-1',
      procurement_id: 'proc-001',
      vendor_id: 'v-1',
      total_amount: 48000,
      currency: 'USD',
      vq_number: 'VQ-2601100001',
      is_selected: true,
      reference: 'VQ-2601100001',
      received_date: '2026-01-10',
      org_id: 'org-1',
      created_at: '2026-01-10T00:00:00Z',
    },
  ],
  receipts: [
    {
      id: 'r-1',
      procurement_id: 'proc-001',
      gr_number: 'GR-2601100001',
      status: 'Partial' as const,
      receipt_date: '2026-01-15',
      org_id: 'org-1',
      created_at: '2026-01-15T00:00:00Z',
    },
  ],
  invoices: [],
  // I1 (design-review): stepper PO ref now comes from purchase_orders, not po_number header column.
  purchase_requests: [
    {
      id: 'pr-rec-1',
      pr_number: 'PR-2601100001',
      status: 'Submitted',
      date: '2026-01-05',
      reference_number: null,
      amount: 50000,
      currency: 'USD',
      procurement_id: 'proc-001',
      org_id: 'org-1',
      created_at: '2026-01-05T00:00:00Z',
    },
  ],
  purchase_orders: [
    {
      id: 'po-rec-1',
      po_number: 'PO-2601100001',
      status: 'Issued',
      date: '2026-01-10',
      reference_number: null,
      amount: 48000,
      currency: 'USD',
      procurement_id: 'proc-001',
      org_id: 'org-1',
      created_at: '2026-01-10T00:00:00Z',
    },
  ],
};

// ---------------------------------------------------------------------------
// Render helper (renders at the route path so useParams works)
// ---------------------------------------------------------------------------
// The page is now a tabbed record shell (`/procurement/:id/:tab?`, default Overview).
// `tab` deep-links a panel so a test can land on the tab that owns the content it
// asserts (line items / documents / supplier quotes). Goals unchanged — only the journey
// step "land on the owning tab" is made explicit (the content moved behind a tab).
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-probe" data-state={JSON.stringify(location.state ?? null)}>{location.pathname + location.search}</output>;
};

const renderPage = (id = 'proc-001', tab?: string, query = '', state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: `/procurement/${id}${tab ? `/${tab}` : ''}${query}`, state }]}>
      <LocationProbe />
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
        <Route path="/projects/:projectId" element={<LocationProbe />} />
        <Route path="/companies/:companyId" element={<LocationProbe />} />
        <Route path="/procurement" element={<LocationProbe />} />
        <Route path="/procurement/new" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

const chooseRecordKind = async (label: string) => {
  const header = screen.getByTestId('record-header');
  await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
  await userEvent.click(await screen.findByRole('menuitem', { name: label }));
};
const currentRoute = () => screen.getAllByTestId('location-probe').at(-1)!;

beforeEach(() => {
  detailState.data = { ...baseProcurement };
  detailState.isPending = false;
  detailState.isFetching = false;
  detailState.isError = false;
  detailState.error = null;
  detailState.refetch.mockReset();
  mockEffectiveRole = 'Finance';
  mockTransition.mockReset().mockResolvedValue(undefined);
  mockCreateQuotation.mockReset().mockResolvedValue({ id: 'q-new' });
  mockCreateReceipt.mockReset().mockResolvedValue({ id: 'r-new' });
  mockCreateInvoice.mockReset().mockResolvedValue({ id: 'i-new' });
  mockCreatePurchaseOrder.mockReset().mockResolvedValue({ id: 'po-new' });
  mockCreatePurchaseRequest.mockReset().mockResolvedValue({ id: 'pr-new' });
  mockCreateRfq.mockReset().mockResolvedValue({ id: 'rfq-new' });
  mockCreatePayment.mockReset().mockResolvedValue({ id: 'pay-new' });
  mockApproveAmount.mockReset().mockResolvedValue(undefined);
  mockSelectQuote.mockReset().mockResolvedValue(undefined);
  mockUpdateHeader.mockReset().mockResolvedValue(undefined);
  mockCreateItem.mockReset().mockResolvedValue({ id: 'it-new' });
  mockUpdateItem.mockReset().mockResolvedValue(undefined);
  mockDeleteItem.mockReset().mockResolvedValue(undefined);
  mockLinkErpDocuments.mockReset().mockResolvedValue({ results: [] });
  linkedDocsState.data = [];
  erpState.data = [];
  fileState.files = [];
  recordPush.status = 'idle';
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe('Procurement record floor controls', () => {
  it('floor: Phone Back to Procurement opens the procurement list', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Procurement' }));
    expect(currentRoute()).toHaveTextContent(/^\/procurement$/);
  });

  it('floor: Header project link opens the matching project record', async () => {
    renderPage();
    await userEvent.click(within(screen.getByTestId('record-header')).getByRole('link', { name: 'Open HQ Fit-Out' }));
    expect(currentRoute()).toHaveTextContent(/^\/projects\/proj-1$/);
  });

  it('floor: Header supplier link opens the matching company record', async () => {
    detailState.data = { ...baseProcurement, vendor_id: 'v1', vendor: { name: 'Apex Supply' } };
    renderPage();
    await userEvent.click(within(screen.getByTestId('record-header')).getByRole('link', { name: 'Open Apex Supply' }));
    expect(currentRoute()).toHaveTextContent('/companies/v1');
  });

  it('floor: Rework sends the returned case to Draft', async () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Rejected', requested_by_id: 'u-alice' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Rework' }));
    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Draft' })));
  });

  it.each([
    ['Purchase request', 'Purchase request'],
    ['Quote request', 'Quote request'],
    ['Purchase order', 'Purchase order'],
    ['Payment', 'Payment'],
  ])('floor: Record another document %s opens its capture for this case', async (choice, captureTitle) => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other' };
    renderPage();
    await chooseRecordKind(choice);
    expect(screen.getByTestId('procurement-record-capture')).toHaveTextContent(captureTitle);
  });

  it('floor: Add quotation opens the quotation capture for this case', async () => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other' };
    renderPage();
    await chooseRecordKind('Add quotation');
    expect(screen.getByTestId('procurement-tabpanel-quotes')).toBeInTheDocument();
    expect(screen.getByTestId('add-quotation-form')).toBeInTheDocument();
  });

  it('floor: Link from accounting opens the accounting document dialog for this case', async () => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other' };
    erpState.data = [{ id: 'erp-1', doctype: 'Purchase Invoice', name: 'PINV-10', supplier: 'Apex Supply', currency: 'USD', grandTotal: 200, netTotal: 180, outstanding: 200, docDate: '2026-10-01', dueDate: null, billNo: null, erpStatus: 'Unpaid', isReturn: false, projectIds: ['proj-1'], procurementId: null, linkId: null }];
    renderPage();
    await chooseRecordKind('Link from accounting system');
    expect(screen.getByRole('dialog', { name: /link PINV-10 to a purchase/i })).toBeInTheDocument();
  });

  it('floor: More Export case downloads a CSV with the case identifiers and state', async () => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other', vendor: { name: 'Apex Supply' } };
    let resolveBlob: (blob: Blob) => void = () => undefined;
    const blobPromise = new Promise<Blob>((resolve) => { resolveBlob = resolve; });
    const createObjectURL = vi.fn((blob: Blob) => {
      resolveBlob(blob);
      return 'blob:procurement-case';
    });
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'More procurement actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export' }));
    const blob = await blobPromise;
    expect(await blob.text()).toContain('"PROC-2026-001","Workstations for HQ","Approved","HQ Fit-Out","Apex Supply"');
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:procurement-case');
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });

  it('floor: Phone main action approves this case and phone More opens its case menu', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 639px'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await confirmInDialog('Approve');
    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Approved' })));
    await userEvent.click(screen.getByRole('button', { name: 'More procurement actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Purchase request' })).toBeInTheDocument();
  });

  it('floor: Payment ceiling Approve higher amount commits the billed amount', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', approved_by_id: 'u-approver', paymentCeiling: { ok: false, reason: 'vendor bill exceeds approved amount', billedNet: 1200, approvedAmount: 1000 }, paymentEligibility: 'allowed' };
    renderPage('proc-001', 'quotes');
    await userEvent.click(screen.getByRole('button', { name: 'Approve higher amount' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockApproveAmount).toHaveBeenCalledWith(1200));
  });

  it('floor: Budget panel project link opens the matching project record', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested' };
    renderPage();
    const budgetHeading = screen.getByRole('heading', { name: 'Budget impact' });
    await userEvent.click(within(budgetHeading.parentElement!).getByRole('link', { name: 'Open HQ Fit-Out' }));
    expect(currentRoute()).toHaveTextContent(/^\/projects\/proj-1$/);
  });

  it('floor: Capture discard guard Stay keeps the capture open and Leave closes it', async () => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other' };
    renderPage();
    await chooseRecordKind('Purchase order');
    await userEvent.type(screen.getByTestId('purchase_order-ref-input'), 'PO-DRAFT');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    const discard = await screen.findByRole('dialog', { name: 'Discard your changes?' });
    await userEvent.click(within(discard).getByRole('button', { name: 'Stay' }));
    expect(screen.getByTestId('procurement-record-capture')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole('button', { name: 'Leave' }));
    expect(screen.queryByTestId('procurement-record-capture')).not.toBeInTheDocument();
  });

  it('floor: Page Retry refetches the procurement record after a read error', async () => {
    detailState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(detailState.refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Timeline', 'timeline'],
    ['Files', 'files'],
    ['Details', 'details'],
  ])('floor: %s tab opens its panel and writes its URL', async (label, tab) => {
    renderPage('proc-001', 'quotes');
    await userEvent.click(screen.getByRole('tab', { name: new RegExp(label) }));
    expect(screen.getByTestId(`procurement-tabpanel-${tab}`)).toBeInTheDocument();
    expect(currentRoute()).toHaveTextContent(`/procurement/proc-001/${tab}`);
  });

  it('floor: Timeline record expansion shows its attached file actions', async () => {
    const file = { id: 'file-1', file_path: 'org-1/proc-001/purchase_order/order-1/order.pdf', title: 'Order copy', archived_at: null };
    detailState.data = { ...orderedProcurement, purchase_orders: [{ ...orderedProcurement.purchase_orders[0], files: [file] }] };
    fileState.files = [file];
    renderPage('proc-001', 'timeline');
    const order = screen.getAllByText('Purchase order').map((element) => element.closest('summary')).find(Boolean);
    expect(order).not.toBeNull();
    await userEvent.click(order!);
    expect((await screen.findAllByRole('button', { name: 'Download file order.pdf' })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Remove file order.pdf' }).length).toBeGreaterThan(0);
  });

  it('floor: Choose quote commits the selected quotation id and amount', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Quoted', requested_by_id: 'u-other', quotations: [
      { id: 'q-1', procurement_id: 'proc-001', vendor_id: 'v1', total_amount: 48000, currency: 'USD', vq_number: 'VQ-1', is_selected: false, reference: 'Q-1', received_date: '2026-10-01', org_id: 'org-1', created_at: '2026-10-01T00:00:00Z' },
      { id: 'q-2', procurement_id: 'proc-001', vendor_id: 'v2', total_amount: 52000, currency: 'USD', vq_number: 'VQ-2', is_selected: false, reference: 'Q-2', received_date: '2026-10-02', org_id: 'org-1', created_at: '2026-10-02T00:00:00Z' },
    ] };
    renderPage('proc-001', 'quotes');
    await userEvent.click(screen.getByRole('button', { name: /select quote Apex Supply/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Select quote' }));
    await waitFor(() => expect(mockSelectQuote).toHaveBeenCalledWith('q-1'));
  });

  it('floor: Quotations selection records the selected quote id from the alternate quote', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Quoted', requested_by_id: 'u-other', quotations: [
      { id: 'q-a', procurement_id: 'proc-001', vendor_id: 'v1', total_amount: 48000, currency: 'USD', vq_number: 'VQ-A', is_selected: false, reference: 'Q-A', received_date: '2026-10-01', org_id: 'org-1', created_at: '2026-10-01T00:00:00Z' },
      { id: 'q-b', procurement_id: 'proc-001', vendor_id: 'v2', total_amount: 52000, currency: 'USD', vq_number: 'VQ-B', is_selected: false, reference: 'Q-B', received_date: '2026-10-02', org_id: 'org-1', created_at: '2026-10-02T00:00:00Z' },
    ] };
    renderPage('proc-001', 'quotes');
    await userEvent.click(screen.getByRole('button', { name: /select quote VQ-B/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Select quote' }));
    await waitFor(() => expect(mockSelectQuote).toHaveBeenCalledWith('q-b'));
  });

  it('floor: Drawer handoff launches the matching main action once for this case', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('proc-001', undefined, '', { runMainAction: 'Approved', pmoListReturn: { list: 'procurement', href: '/procurement?project=proj-1' } });
    await confirmInDialog('Approve');
    await waitFor(() => expect(mockTransition).toHaveBeenCalledTimes(1));
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Approved' }));
  });
});

beforeEach(() => {
  detailState.data = { ...baseProcurement };
  detailState.isPending = false;
  detailState.isFetching = false;
  detailState.isError = false;
  detailState.error = null;
  detailState.refetch.mockReset();
  mockEffectiveRole = 'Finance';
  mockTransition.mockReset().mockResolvedValue(undefined);
  mockCreateQuotation.mockReset().mockResolvedValue({ id: 'q-new' });
  mockCreateReceipt.mockReset().mockResolvedValue({ id: 'r-new' });
  mockCreateInvoice.mockReset().mockResolvedValue({ id: 'i-new' });
  mockCreatePurchaseOrder.mockReset().mockResolvedValue({ id: 'po-new' });
  mockCreatePurchaseRequest.mockReset().mockResolvedValue({ id: 'pr-new' });
  mockCreateRfq.mockReset().mockResolvedValue({ id: 'rfq-new' });
  mockCreatePayment.mockReset().mockResolvedValue({ id: 'pay-new' });
  mockApproveAmount.mockReset().mockResolvedValue(undefined);
  mockSelectQuote.mockReset().mockResolvedValue(undefined);
  mockUpdateHeader.mockReset().mockResolvedValue(undefined);
  mockCreateItem.mockReset().mockResolvedValue({ id: 'it-new' });
  mockUpdateItem.mockReset().mockResolvedValue(undefined);
  mockDeleteItem.mockReset().mockResolvedValue(undefined);
  mockLinkErpDocuments.mockReset().mockResolvedValue({ results: [] });
  linkedDocsState.data = [];
  erpState.data = [];
  fileState.files = [];
  recordPush.status = 'idle';
  sessionStorage.clear();
});

