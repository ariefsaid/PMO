import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

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
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

const mockTransition = vi.fn().mockResolvedValue(undefined);
const mockCreateQuotation = vi.fn().mockResolvedValue({ id: 'q-new' });
const mockCreateReceipt = vi.fn().mockResolvedValue({ id: 'r-new' });
const mockCreateInvoice = vi.fn().mockResolvedValue({ id: 'i-new' });
const mockCaptureVendorInvoice = vi.fn().mockResolvedValue({ id: 'vi-new' });

// The per-phase file sub-section has its own unit test + needs a QueryClient;
// stub it here so the page tests stay focused on the lifecycle behavior.
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
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

// LedgerFileCell's AttachButton calls useProcurementFiles → useQuery → needs a QueryClient.
// Stub the hook so ProcurementDetails tests stay QueryClient-free.
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

const mockApproveAmount = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: mockCreateQuotation, isPending: false, error: null },
    createReceipt: { mutateAsync: mockCreateReceipt, isPending: false, error: null },
    createInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: mockCaptureVendorInvoice, isPending: false, error: null },
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
const docsState = {
  data: [] as Record<string, unknown>[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
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
  useProcurementDocuments: () => docsState,
}));

// FK pickers (header edit project/vendor, quotation vendor) read cached option
// hooks; stub them so the detail test needs no QueryClient.
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
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
const navigate = vi.fn();
const toast = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
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
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({
    record: { mutateAsync: vi.fn(), isPending: false },
    correct: { mutateAsync: vi.fn(), isPending: false },
    void: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import ProcurementDetails from './ProcurementDetails';

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

// A PR right after the user selected a quote: status 'Quote Selected', no PO yet,
// the chosen quotation flagged is_selected + the header total/vendor synced by the
// select-quote RPC (PROC-004 re-review fixture).
const quoteSelectedProcurement = {
  ...baseProcurement,
  status: 'Quote Selected' as const,
  total_value: 148000, currency: 'USD',
  po_number: null,
  vendor_id: 'v-syn',
  vendor: { name: 'Synergy Systems' },
  requested_by_id: 'u-other',
  quotations: [
    {
      id: 'q-lo',
      procurement_id: 'proc-001',
      vendor_id: 'v-syn',
      total_amount: 148000,
      currency: 'USD',
      vq_number: 'VQ-2602050001',
      is_selected: true,
      reference: 'SYN-Q-220',
      received_date: '2026-02-05',
      file_url: null,
      org_id: 'org-1',
      created_at: '2026-02-05T00:00:00Z',
    },
    {
      id: 'q-hi',
      procurement_id: 'proc-001',
      vendor_id: 'v-apx',
      total_amount: 152000,
      currency: 'USD',
      vq_number: 'VQ-2602050002',
      is_selected: false,
      reference: 'APX-Q-101',
      received_date: '2026-02-06',
      file_url: null,
      org_id: 'org-1',
      created_at: '2026-02-06T00:00:00Z',
    },
  ],
  receipts: [],
  invoices: [],
};

const paidProcurement = {
  ...orderedProcurement,
  status: 'Paid' as const,
  invoices: [
    {
      id: 'i-1',
      procurement_id: 'proc-001',
      vi_number: 'VI-2601100001',
      status: 'Paid' as const,
      invoice_date: '2026-01-20',
      org_id: 'org-1',
      created_at: '2026-01-20T00:00:00Z',
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
const renderPage = (id = 'proc-001', tab?: string) =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}${tab ? `/${tab}` : ''}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>
  );

// ---------------------------------------------------------------------------
// D1 — AC-804: loading / empty / error+retry states (NFR-PROC-UI-001)
// ---------------------------------------------------------------------------
describe('AC-804: ProcurementDetails loading/empty/error states (NFR-PROC-UI-001)', () => {
  beforeEach(() => {
    detailState.data = undefined;
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    detailState.refetch = vi.fn();
    mockEffectiveRole = 'Finance';
  });

  it('AC-804: renders procurement-loading skeleton while pending', () => {
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('procurement-loading')).toBeInTheDocument();
  });

  it('AC-804: renders the no-access state when query resolves with no data', () => {
    detailState.isPending = false;
    detailState.data = undefined;
    renderPage();
    // A resolved-but-empty record is the same honest "no access / not found"
    // state as an RLS-filtered miss (polish #3) — no blank main area.
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
  });

  it('AC-804: renders error state with Retry button when query errors', () => {
    detailState.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('AC-804: clicking Retry calls refetch', () => {
    detailState.isError = true;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(detailState.refetch).toHaveBeenCalledTimes(1);
  });

  it('I7: the loading state keeps the "Back to Procurement" escape route', () => {
    detailState.isPending = true;
    renderPage();
    expect(screen.getByRole('button', { name: /Back to Procurement/i })).toBeInTheDocument();
  });

  it('I7: the error state keeps the "Back to Procurement" escape route', () => {
    detailState.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: /Back to Procurement/i })).toBeInTheDocument();
  });

  it('I7: the not-found state keeps the "Back to Procurement" escape route', () => {
    detailState.data = undefined;
    renderPage();
    expect(screen.getByRole('button', { name: /Back to Procurement/i })).toBeInTheDocument();
  });

  it.each([
    ['loading', { isPending: true, isError: false }],
    ['not-found', { isPending: false, isError: false }],
    ['error', { isPending: false, isError: true }],
  ])('#707: the %s state shows the Back bar only at phone width (hidden on desktop)', (_n, s) => {
    Object.assign(detailState, s);
    renderPage();
    const bar = screen.getByRole('button', { name: /Back to Procurement/i }).parentElement!;
    expect(bar.className).toContain('hidden');
    expect(bar.className).toContain('max-[920px]:flex');
  });

  it('AC-NAV-007: "Back to Procurement" navigates to the Procurement module index (no tab)', async () => {
    // Director ruling (2026-09-29): the destination stays canonical `/procurement` while a
    // direct link with no captured list context now additionally carries validated clean
    // return state.
    navigate.mockClear();
    detailState.isPending = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Back to Procurement/i }));
    expect(navigate).toHaveBeenCalledWith('/procurement', { state: {} });
  });
});

// ---------------------------------------------------------------------------
// Batch-A cleanup: E4 (no disabled Audit trail), H2 (no success BackBar),
// G5 (stat tiles use "Pending"/"None yet", not em-dash)
// ---------------------------------------------------------------------------
describe('ProcurementDetails — Batch-A cleanup (E4 / H2 / G5)', () => {
  beforeEach(() => {
    detailState.data = { ...baseProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
  });

  it('CW-3a: the Procurement detail opens with the shared RecordHeader (icon + name + status)', () => {
    renderPage();
    const header = screen.getByTestId('record-header');
    expect(header).toBeInTheDocument();
    expect(within(header).getByRole('heading', { name: /Workstations for HQ/i })).toBeInTheDocument();
    // the status pill is part of the one shared header anatomy
    expect(within(header).getByTestId('procurement-status-badge')).toBeInTheDocument();
  });

  it('CW-3a: the procurement lifecycle renders the bar stepper, NOT the retired circle-node stepper', () => {
    renderPage();
    // The lifecycle is rendered as the canonical even-flex BAR stepper (.jstep steps)…
    expect(document.querySelector('.jstep')).toBeInTheDocument();
    // …and the retired numbered-circle node stepper (.pstep) is gone.
    expect(document.querySelector('.pstep')).toBeNull();
  });

  it('H2: the success render has no ALWAYS-VISIBLE BackBar; the mobile BackBar (≤920px) is CSS-hidden on desktop', () => {
    renderPage();
    // The record is loaded; the RecordHeader heading is present.
    expect(screen.getByRole('heading', { name: /Workstations for HQ/i })).toBeInTheDocument();
    // C-IMP-1 (AC-S6-3): a mobile BackBar IS in the DOM for mobile back-nav (≤920px),
    // but it is wrapped in `hidden max-[920px]:block` — CSS-only, single render.
    // The wrapper must carry `hidden` to keep desktop unchanged (I7 intent preserved).
    const mobileBackBarWrapper = screen.getByTestId('mobile-back-bar');
    expect(mobileBackBarWrapper).toBeInTheDocument();
    expect(mobileBackBarWrapper.className).toContain('hidden');
  });

  it('E4: the success render has no disabled "Audit trail" stub action', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /Audit trail/i })).toBeNull();
  });

  it('G5 / I3 (design-review): absent stat tiles are OMITTED rather than showing "Pending" / "None yet"', () => {
    renderPage();
    // I3 fix: baseProcurement has no selected quote, no PO, no receipts.
    // The revamp removes placeholder tiles — only the PR value tile is present.
    // "Pending" and "None yet" must NOT appear as tile values (sparse layout).
    const strips = screen.getAllByTestId('stat-tiles');
    const mainStrip = strips[0]; // first stat-tiles = the overview bento tiles
    const tileText = within(mainStrip).getAllByTestId('stat-tile').map((el) => el.textContent ?? '');
    expect(tileText.some((t) => t.includes('Pending'))).toBe(false);
    expect(tileText.some((t) => t.toLowerCase().includes('none yet'))).toBe(false);
    // PR value tile must still be present
    expect(tileText.some((t) => t.includes('$50,000'))).toBe(true);
    // no em-dash in tile area
    expect(tileText.some((t) => t.includes('—'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-004 — the selected-quote tile + row pill bind from Quote Selected
// (PROC-004 re-review). Before the fix the binding only appeared at Ordered/Paid
// (keyed off the PO-committed quote), so a freshly-selected quote read
// "Pending — N received" and no row carried the "Selected" pill.
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-004: selected-quote binds on the Quote Selected state (PROC-004)', () => {
  beforeEach(() => {
    detailState.data = { ...quoteSelectedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Finance';
  });

  it('PROC-004: the "Selected quote" tile shows the chosen quote vendor + amount (not "Pending")', () => {
    renderPage();
    const tileLabel = screen.getByText('Selected quote');
    const tile = tileLabel.closest('[data-testid="stat-tile"]') as HTMLElement;
    // The selected quote is $148,000 from Synergy Systems — bound from this state.
    expect(within(tile).getByText('$148,000')).toBeInTheDocument();
    expect(within(tile).getByText('Synergy Systems')).toBeInTheDocument();
    // It must NOT read the pre-selection "Pending" / "N received" placeholder.
    expect(within(tile).queryByText('Pending')).toBeNull();
    expect(within(tile).queryByText(/received/i)).toBeNull();
  });

  it('PROC-004: the selected quotation row carries the "Selected · best value" pill', () => {
    renderPage('proc-001', 'quotes');
    // VendorQuotesTab (Slice 3) replaced QuotationsSection — testid is now vendor-quotes.
    const section = screen.getByTestId('vendor-quotes');
    // The chosen $148,000 (VQ-2602050001) row shows "Selected · best value"; the $152,000 one does not.
    // Both desktop + mobile branches render the pill so at least one match expected.
    expect(within(section).getAllByText(/Selected · best value/i).length).toBeGreaterThanOrEqual(1);
    // The VQ number is present in the section
    expect(within(section).getAllByText('VQ-2602050001').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// D2 — AC-805: role-gated cosmetic action bar (FR-PROC-006, UI gate)
// ---------------------------------------------------------------------------
describe('AC-805: role-gated transition actions (FR-PROC-006, UI gate)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.refetch = vi.fn();
  });

  it('AC-805: Engineer viewing Requested procurement is NOT offered Approve/Reject', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Requested' };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('AC-805: Finance viewer IS offered Approve and Reject for Requested procurement', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
  });

  it('AC-S20-001: one complete decision area follows request identity, value and budget evidence in keyboard order', async () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(document.querySelector('[data-testid="mobile-sticky-action"]')).toBeNull();
    const budgetEvidence = screen.getByRole('heading', { name: /budget impact/i });
    const requestValue = screen.getByText('PR value').closest('[data-testid="stat-tile"]')!;
    const decision = screen.getByTestId('decision-card');
    expect(screen.getByText('Workstations for HQ')).toBeInTheDocument();
    expect(screen.getByText('PROC-2026-001')).toBeInTheDocument();
    expect(requestValue.compareDocumentPosition(budgetEvidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(budgetEvidence.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(decision).getAllByRole('button', { name: /approve/i })).toHaveLength(1);
    expect(within(decision).getAllByRole('button', { name: /reject/i })).toHaveLength(1);
    expect(within(decision).getAllByRole('button', { name: /cancel procurement/i })).toHaveLength(1);

    within(decision).getByRole('button', { name: /add a note/i }).focus();
    await userEvent.tab();
    expect(within(decision).getByRole('button', { name: /approve/i })).toHaveFocus();
    await userEvent.tab();
    expect(within(decision).getByRole('button', { name: /reject/i })).toHaveFocus();
    await userEvent.tab();
    expect(within(decision).getByRole('button', { name: /cancel procurement/i })).toHaveFocus();
  });

  it('AC-S20-002: policy and separation-of-duties detail follows financial evidence without losing its explanation', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const evidence = screen.getByRole('heading', { name: /budget impact/i });
    const policy = screen.getByTestId('sod-ready-hint');
    expect(evidence.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(policy).toHaveTextContent(/requester cannot self-approve/i);
  });

  it('AC-805: no Approve/Reject for Draft status (not a legal transition from Draft)', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Draft' };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('AC-805: Submit for approval (Draft → Requested) offered to Engineer', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Draft' };
    renderPage();
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeInTheDocument();
  });

  it('AC-805: Paid status shows no transition actions (terminal)', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...paidProcurement };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    // "Mark as Paid" is the lifecycle transition button (terminal state: must not appear).
    // Use an exact/anchored match to avoid colliding with "Add Payment" (record capture).
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('item G: a destructive action is a quiet OUTLINE at rest; the solid red is only in the confirm dialog', async () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const rejectBtn = screen.getByRole('button', { name: /reject/i });
    // at rest: outline (background fill + input border), NOT the solid destructive fill
    expect(rejectBtn.className).toContain('border-input');
    expect(rejectBtn.className).toContain('bg-background');
    expect(rejectBtn.className).not.toContain('bg-destructive');
    // opening the confirm dialog surfaces the solid red confirm (the only solid fill)
    await userEvent.click(rejectBtn);
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: /reject/i });
    expect(confirm.className).toContain('bg-destructive');
  });
});

// ---------------------------------------------------------------------------
// D2 — AC-805: transition button wires to mutation (FR-PROC-006)
// ---------------------------------------------------------------------------
describe('AC-805: transition mutations called on action click', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.refetch = vi.fn();
    mockTransition.mockClear();
    mockEffectiveRole = 'Finance';
  });

  it('AC-805: clicking Approve then confirming calls transition mutation with Approved', async () => {
    // Finance user, not the requester → allowed
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    // confirm-before-write: the mutation has NOT fired on the first click
    expect(mockTransition).not.toHaveBeenCalled();
    await confirmInDialog(/approve/i);
    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Approved' })
    ));
  });

  it('AC-805 / AC-IXD-WP-003: clicking Submit for approval (a routine forward step) fires the transition on a SINGLE click — no confirm (OD-UX-1)', async () => {
    mockEffectiveRole = 'Engineer';
    // AC-W3-D10: Submit is only enabled when ≥1 line item exists; give the fixture an item.
    detailState.data = {
      ...baseProcurement,
      status: 'Draft',
      total_value: 500, currency: 'USD',
      items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Widget', description: null, quantity: 1, rate: 500, amount: 500 }],
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /submit for approval/i }));
    // OD-UX-1: routine reversible forward steps are single-click + a toast, no modal.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Requested' })
    ));
  });
});

// ---------------------------------------------------------------------------
// AC-805 / OD-PROC-1 — Approve/Reject optional notes input
// ---------------------------------------------------------------------------
describe('AC-805: Approve/Reject notes input (OD-PROC-1 optional Notes)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.refetch = vi.fn();
    mockTransition.mockClear();
    mockEffectiveRole = 'Finance';
  });

  it('AC-805: entering notes + Approve + confirm calls transition mutation with the notes argument', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    // IxD Change 1: Notes is progressive-disclosure — reveal the optional field first.
    await userEvent.click(screen.getByTestId('procurement-notes-reveal'));
    await userEvent.type(screen.getByTestId('procurement-notes-input'), 'Within budget — approved.');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await confirmInDialog(/approve/i);
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'Approved', notes: 'Within budget — approved.' })
      )
    );
  });

  it('AC-805 / P2: entering notes + Reject opens a destructive confirm; confirm passes the notes', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    // IxD Change 1: reveal the progressive-disclosure Notes field before typing.
    await userEvent.click(screen.getByTestId('procurement-notes-reveal'));
    await userEvent.type(screen.getByTestId('procurement-notes-input'), 'Over budget.');
    await userEvent.click(screen.getByRole('button', { name: /reject/i }));
    // Reject is destructive → alertdialog surface
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
    await confirmInDialog(/reject/i);
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'Rejected', notes: 'Over budget.' })
      )
    );
  });

  it('AC-805: notes input is NOT shown when no Approve/Reject action is available', () => {
    detailState.data = { ...baseProcurement, status: 'Draft' };
    renderPage();
    expect(screen.queryByTestId('procurement-notes-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('procurement-notes-reveal')).not.toBeInTheDocument();
  });

  it('AC-805 / IxD: at rest (Approve available) the Notes textarea is hidden behind a reveal link', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    // Progressive disclosure: only the "Add a note" link shows at rest, no textarea.
    expect(screen.queryByTestId('procurement-notes-input')).not.toBeInTheDocument();
    const reveal = screen.getByTestId('procurement-notes-reveal');
    expect(reveal).toBeInTheDocument();
    await userEvent.click(reveal);
    expect(screen.getByTestId('procurement-notes-input')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D3 — Document trail renders numbers + receipt/invoice status
// (covered end-to-end by AC-816; verified here as part of D3)
// ---------------------------------------------------------------------------
describe('Document trail renders PR/VQ/PO/GR/VI numbers (AC-816 data)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
  });

  it('renders PR number from an actual purchase_request record (I1: not the header column)', () => {
    // I1 (design-review): the stepper derives its PR ref from the purchase_request
    // record array, not the denormalized pr_number header column. The test now
    // requires an actual purchase_request row for the PR# to appear in the stepper.
    detailState.data = {
      ...baseProcurement,
      status: 'Requested',
      pr_number: 'PR-2606040001',
      purchase_requests: [
        {
          id: 'pr-rec-1',
          pr_number: 'PR-2606040001',
          status: 'Submitted',
          date: '2026-06-04',
          reference_number: null,
          amount: 50000,
          procurement_id: 'proc-001',
          org_id: 'org-1',
          created_at: '2026-06-04T00:00:00Z',
        },
      ],
    };
    renderPage();
    // PR# appears in the lifecycle bar stepper (from the purchase_request record).
    expect(screen.getAllByText('PR-2606040001').length).toBeGreaterThanOrEqual(1);
  });

  it('renders VQ number, PO number, GR number and status from Ordered procurement', () => {
    detailState.data = orderedProcurement;
    renderPage('proc-001', 'documents');
    // Numbers may appear in both the doc-trail panel and the section body — use getAllByText
    expect(screen.getAllByText('PO-2601100001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VQ-2601100001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('GR-2601100001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Partial').length).toBeGreaterThanOrEqual(1);
  });

  it('renders VI number and status from Paid procurement', () => {
    detailState.data = paidProcurement;
    renderPage();
    expect(screen.getAllByText('VI-2601100001').length).toBeGreaterThanOrEqual(1);
  });

  it('renders total_value via formatCurrency (money never raw)', () => {
    detailState.data = { ...baseProcurement, total_value: 50000, currency: 'USD' };
    renderPage();
    // formatCurrency(50000) = "$50,000"
    // May appear in multiple places (header + DecisionSupportPanel stat tiles) — any occurrence is proof.
    expect(screen.getAllByText('$50,000').length).toBeGreaterThanOrEqual(1);
  });

  it('renders procurement title in the header', () => {
    detailState.data = baseProcurement;
    renderPage();
    expect(screen.getByRole('heading', { name: /Workstations for HQ/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage: mid-flow statuses
// ---------------------------------------------------------------------------
describe('Action bar covers mid-flow transitions', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
  });

  it('Received status shows Mark Vendor Invoiced for Finance', () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /mark supplier invoiced/i })).toBeInTheDocument();
  });

  it('Vendor Invoiced status shows Mark as Paid for Finance (not the approver)', () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-someone-else',
    };
    renderPage();
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
  });

  it('SoD-b: Mark as Paid is NOT offered to the Finance user who approved the request', () => {
    // current user is u-alice (Finance). They also approved → the RPC's SoD-b
    // ALWAYS rejects pay-by-approver, so the UI must not offer the action.
    mockEffectiveRole = 'Finance';
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-alice',
    };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('FR-PFE-005 payment-first: a Draft purchase with a recorded payment shows Mark as Paid to Finance, not to its approver', () => {
    const withPayment = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other', payments: [{ id: 'pay-1', status: 'Scheduled', amount: 100 }] };
    detailState.data = { ...withPayment, approved_by_id: 'u-someone-else' };
    const first = renderPage();
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
    first.unmount();
    detailState.data = { ...withPayment, approved_by_id: 'u-alice' };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('a Draft purchase with no payment recorded offers no Mark as Paid', () => {
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other', payments: [] };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('ADR-0093: a Requested purchase offers no record action; an approver is told to approve, the requester to wait', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    const first = renderPage('proc-001', 'documents');
    expect(screen.getByText('Approve to start recording documents.')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-capture-open')).not.toBeInTheDocument();
    first.unmount();
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage('proc-001', 'documents');
    expect(screen.getByText('Waiting for approval.')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-capture-open')).not.toBeInTheDocument();
  });

  it('AC-PFE-010: an empty Draft offers "Record the first document", filtered by what the role may record', () => {
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other' };
    renderPage('proc-001', 'documents');
    const choice = screen.getByLabelText('Record the first document') as HTMLSelectElement;
    // Finance may request, source, invoice and pay; it is not the requester and not a receiver, so no goods receipt.
    expect([...choice.options].map((o) => o.text)).toEqual(['Request', 'Quote request', 'Order', 'Supplier invoice', 'Payment']);
    fireEvent.change(choice, { target: { value: 'vendor_invoice' } });
    expect(screen.getByRole('button', { name: /capture supplier invoice/i })).toBeInTheDocument();
  });

  it('D2 C1/C2: a goods receipt chosen as the first document is written through the page confirm, and only then reported', async () => {
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other' };
    mockCreateReceipt.mockClear(); toast.mockClear();
    renderPage('proc-001', 'documents');
    fireEvent.change(screen.getByLabelText('Record the first document'), { target: { value: 'goods_receipt' } });
    await userEvent.click(screen.getByRole('button', { name: /capture goods receipt/i }));
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    // Staged, not written: nothing is created and nothing is toasted until the confirm.
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(await screen.findByText(/This records a complete goods receipt against procurement record/)).toBeInTheDocument();
    await confirmInDialog(/save gr/i);
    await waitFor(() => expect(mockCreateReceipt).toHaveBeenCalledTimes(1));
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({ status: 'Complete' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Goods receipt recorded', undefined, 'success'));
  });

  it('D2 C1/C2: a supplier invoice chosen as the first document is written through the page confirm, and only then reported', async () => {
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other' };
    mockCreateInvoice.mockClear(); toast.mockClear();
    renderPage('proc-001', 'documents');
    fireEvent.change(screen.getByLabelText('Record the first document'), { target: { value: 'vendor_invoice' } });
    await userEvent.click(screen.getByRole('button', { name: /capture supplier invoice/i }));
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    await confirmInDialog(/save supplier invoice/i);
    await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Supplier invoice recorded', undefined, 'success'));
  });

  it('a requester without a recording role is offered only the request (no choice to make)', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-alice' };
    renderPage('proc-001', 'documents');
    expect(screen.queryByLabelText('Record the first document')).toBeNull();
  });

  it('D2 C3: Mark as Paid is not offered on a purchase with nothing on it, and one line says why', () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', approved_by_id: 'u-someone-else', total_value: 0, items: [], invoices: [] };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).not.toBeInTheDocument();
    expect(screen.getByText('Add a line item or a document with an amount before marking this paid.')).toBeInTheDocument();
  });

  it('Quote Selected status shows Generate Purchase Order for Finance', () => {
    detailState.data = { ...baseProcurement, status: 'Quote Selected', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /generate purchase order/i })).toBeInTheDocument();
  });

  it('Rejected status shows Rework button for requester', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Rejected', requested_by_id: 'u-alice' };
    renderPage();
    expect(screen.getByRole('button', { name: /rework/i })).toBeInTheDocument();
  });

  it('renders approval_notes when present', () => {
    detailState.data = { ...baseProcurement, status: 'Approved', approval_notes: 'Looks good.' };
    renderPage();
    expect(screen.getByText('Looks good.')).toBeInTheDocument();
  });

  it('renders rejection_notes when present', () => {
    detailState.data = { ...baseProcurement, status: 'Rejected', rejection_notes: 'Over budget.' };
    renderPage();
    expect(screen.getByText('Over budget.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-806: RPC error surfaces in the UI (FR-PROC-003/004)
// ---------------------------------------------------------------------------
describe('AC-806: mutation error renders in UI', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
  });

  it('AC-806: shows RPC error message when transition mutation fails (after confirm)', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    mockTransition.mockRejectedValueOnce(new Error('not authorized (42501)'));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await confirmInDialog(/approve/i);
    await waitFor(() =>
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument()
    );
    mockTransition.mockResolvedValue(undefined);
  });
});

// ---------------------------------------------------------------------------
// P1/P2 — confirm severity + sub-task (b) error-code classification
// ---------------------------------------------------------------------------
describe('Confirm severity + error-code classified toast (P1/P2, sub-task b)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
    mockTransition.mockClear().mockResolvedValue(undefined);
    toast.mockClear();
  });

  it('AC-PMC-008: a NULL-amount invoice falls back to the procurement total in the Paid confirmation', async () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-someone-else',
      total_value: 620,
      invoices: [{
        id: 'i-null', procurement_id: 'proc-001', vi_number: 'VI-NULL', status: 'Received',
        invoice_date: '2026-01-20', amount: null, tax_treatment: 'exclusive', tax_amount: null,
        withheld_amount: null, org_id: 'org-1', created_at: '2026-01-20T00:00:00Z',
      }],
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /mark as paid/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('$620');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('P1: a forward action (Mark as Paid) opens a DEFAULT-tone popover confirm', async () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-someone-else',
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /mark as paid/i }));
    // default tone => role="dialog", NOT alertdialog
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('P2: a destructive action (Cancel procurement) opens an alertdialog; only confirm fires the transition', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    // requester (u-alice) may cancel a Requested PR (canCancel early). The page
    // terminal action reads "Cancel procurement" (double-negative cleanup, polish #2).
    await userEvent.click(screen.getByRole('button', { name: /^Cancel procurement$/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
    // commit button reads "Cancel procurement" (disambiguated from the dialog's own dismiss)
    await confirmInDialog(/cancel procurement/i);
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Cancelled' })),
    );
  });

  it('sub-task b: a P0001 failure toasts the illegal-stage headline + verbatim detail', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const e = Object.assign(new Error('illegal transition Requested→Approved'), { code: 'P0001' });
    mockTransition.mockRejectedValueOnce(e);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await confirmInDialog(/approve/i);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "That move isn't allowed from the current stage.",
        expect.stringContaining('illegal transition'),
        'warning',
      ),
    );
  });

  it('sub-task b: a 42501 failure toasts the not-permitted (SoD) headline', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const e = Object.assign(new Error('permission denied for transition_procurement'), { code: '42501' });
    mockTransition.mockRejectedValueOnce(e);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await confirmInDialog(/approve/i);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "You don't have permission to do that.",
        // AC-ERR-002: the SoD-specific copy, not Postgres's own "permission denied for
        // transition_procurement" — an internal function name is not product copy.
        'Your role does not allow this change. Ask an administrator if you think it should.',
        'warning',
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// D3 — GR creation panel (AC-816 UI support)
// ---------------------------------------------------------------------------
describe('GR creation panel (D3, AC-816 UI support)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    // AC-AUTHZ (0018): GR creation authority = requester OR PM (not Finance).
    // Tests that exercise the GR form use PM role or make the user the requester.
    mockEffectiveRole = 'Project Manager';
    mockCreateReceipt.mockClear();
    mockCreateReceipt.mockResolvedValue({ id: 'r-new' });
  });

  it('shows Create Goods Receipt button for PM on Received status', () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('shows Create Goods Receipt button for PM on Ordered status', () => {
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('does NOT show Create GR button for Engineer who is NOT the requester', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.queryByTestId('btn-create-gr')).not.toBeInTheDocument();
  });

  // AC-AUTHZ: GR form mirrors the Ordered→Received authority — requester OR PM, not Finance.
  it('AC-AUTHZ: Engineer who IS the requester sees the GR form (mirrors RPC requester-OR-PM authority)', () => {
    mockEffectiveRole = 'Engineer';
    // u-alice is the mocked currentUser — making them the requester.
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-alice', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('AC-AUTHZ: Finance does NOT see the GR form (Finance excluded from Ordered→Received authority)', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.queryByTestId('btn-create-gr')).not.toBeInTheDocument();
  });

  it('clicking Create GR shows the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-gr'));
    expect(screen.getByTestId('form-create-gr')).toBeInTheDocument();
    expect(screen.getByTestId('gr-status-select')).toBeInTheDocument();
  });

  it('P3: submitting GR form opens a confirm; createReceipt fires only on confirm', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-gr'));
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    // confirm-before-write: not fired yet
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    await confirmInDialog(/save gr/i);
    await waitFor(() =>
      expect(mockCreateReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Complete' })
      )
    );
  });

  it('cancelling GR form hides the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-gr'));
    // The form Cancel is a type="button" without danger styling — find it within the form
    const form = screen.getByTestId('form-create-gr');
    const cancelBtns = screen.getAllByRole('button', { name: /^Cancel$/i });
    // The form-level Cancel button is inside the form; click it
    const formCancelBtn = cancelBtns.find((btn) => form.contains(btn));
    await userEvent.click(formCancelBtn!);
    expect(screen.queryByTestId('form-create-gr')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D3 — VI creation panel (AC-816 UI support)
// ---------------------------------------------------------------------------
describe('VI creation panel (D3, AC-816 UI support)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    orgDefault.value = 'exclusive';
    mockEffectiveRole = 'Finance';
    mockCreateInvoice.mockClear();
    mockCreateInvoice.mockResolvedValue({ id: 'i-new' });
  });

  it('shows Create Supplier Invoice button for Finance on Vendor Invoiced status', () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-vi')).toBeInTheDocument();
  });

  it('does NOT show Create VI button for Engineer', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.queryByTestId('btn-create-vi')).not.toBeInTheDocument();
  });

  it('clicking Create VI shows the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    expect(screen.getByTestId('form-create-vi')).toBeInTheDocument();
    expect(screen.getByTestId('vi-status-select')).toBeInTheDocument();
  });

  it('P4: submitting VI form opens a confirm; createInvoice fires only on confirm', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    // #505: stating the tax treatment + amount is now part of recording a supplier invoice.
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'inclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '450');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    await confirmInDialog(/save supplier invoice/i);
    await waitFor(() =>
      expect(mockCreateInvoice).toHaveBeenCalledWith(
        // #505: the staged tax facts survive the confirm hop and reach the mutation.
        expect.objectContaining({ status: 'Received', taxTreatment: 'inclusive', taxAmount: 450 })
      )
    );
  });

  it('#505: the VI form cannot be saved until a tax treatment is chosen', async () => {
    // ⚑ The org states nothing readable. Since #548 (OD-TAX-1) the control opens pre-selected to
    // the org default, so this is the one route left to an UNANSWERED treatment — and the #505
    // guard behind it is unchanged and still refuses the write.
    orgDefault.value = undefined;
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    // No confirm dialog, no write: the incomplete invoice never leaves the form.
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('cancelling VI form hides the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    // Two "Cancel" buttons now (GR and VI) — use getAllByRole and click the VI one (last)
    const cancelBtns = screen.getAllByRole('button', { name: /^Cancel$/i });
    await userEvent.click(cancelBtns[cancelBtns.length - 1]);
    expect(screen.queryByTestId('form-create-vi')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CRUD slice — line items / quotations / select-quote / header-edit / documents
// (AC-PROC-002..005). Verifies the sections wire in + gate by status/role.
// ---------------------------------------------------------------------------
const draftByAlice = {
  ...baseProcurement,
  status: 'Draft' as const,
  requested_by_id: 'u-alice', // u-alice is the mocked currentUser → requester
  items: [
    {
      id: 'it1', org_id: 'org-1', procurement_id: 'proc-001',
      name: 'Welding wire', description: null, quantity: 10, rate: 50, amount: 500,
    },
  ],
};

describe('CRUD slice: line items, quotations, header-edit, documents (AC-PROC-002..005)', () => {
  beforeEach(() => {
    detailState.data = draftByAlice;
    detailState.isPending = false;
    detailState.isError = false;
    docsState.data = [];
    docsState.isPending = false;
    docsState.isError = false;
    mockEffectiveRole = 'Project Manager';
    mockUpdateHeader.mockClear();
    mockCreateItem.mockClear();
    mockDeleteItem.mockClear();
    mockSelectQuote.mockClear();
    mockCreateDocument.mockClear();
  });

  it('AC-PROC-003: line items section renders the editable add-row while Draft for the requester', () => {
    renderPage('proc-001', 'items');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
    expect(screen.getByTestId('line-item-add-row')).toBeInTheDocument();
    expect(screen.getByText('Welding wire')).toBeInTheDocument();
  });

  it('AC-PROC-003: line items are READ-ONLY once the PR leaves Draft (no add-row)', () => {
    detailState.data = { ...draftByAlice, status: 'Approved' as const };
    renderPage('proc-001', 'items');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
    expect(screen.queryByTestId('line-item-add-row')).toBeNull();
  });

  it('AC-PROC-002: the Draft-header edit affordance shows for the requester while Draft', () => {
    renderPage();
    expect(screen.getByTestId('edit-header')).toBeInTheDocument();
  });

  it('AC-PROC-002: header-edit is HIDDEN for a non-requester (record-scoped gate)', () => {
    // Edit is scoped to Draft/Rejected AND requester/Admin — a non-requester PM must not see it.
    detailState.data = { ...draftByAlice, requested_by_id: 'u-someone-else' };
    renderPage();
    expect(screen.queryByTestId('edit-header')).toBeNull();
  });

  it('AC-PROC-004: the Select-quote action shows at Vendor Quoted for a sourcing role', () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Quoted' as const,
      requested_by_id: 'u-other',
      quotations: [
        {
          id: 'q2', org_id: 'org-1', procurement_id: 'proc-001', vendor_id: 'v2',
          total_amount: 2944, currency: 'USD', vq_number: 'VQ-2', is_selected: false, reference: null,
          received_date: '2026-06-01', file_url: null,
        },
      ],
    };
    renderPage('proc-001', 'quotes');
    // VendorQuotesTab renders desktop + mobile branches so there may be 2 buttons.
    expect(screen.getAllByRole('button', { name: /select quote vq-2/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('AC-PROC-005: the Documents tab renders the case ledger for a manager (capture affordance shown)', () => {
    // Slice 2: ProcurementDocumentsSection → ProcurementLedger (case ledger DataTable).
    // The 'documents-section' testid is replaced by 'procurement-ledger'; the 'add-document'
    // testid (old metadata form) is replaced by 'ledger-capture-row'.
    renderPage('proc-001', 'documents');
    expect(screen.getByTestId('procurement-ledger')).toBeInTheDocument();
    // canManageFiles (PM = MASTER_DATA write) → capture row shows
    expect(screen.getByTestId('ledger-capture-row')).toBeInTheDocument();
  });

  it('AC-PROC-005: Documents capture affordance is HIDDEN for an Engineer (no procFile create)', () => {
    mockEffectiveRole = 'Engineer';
    // An Engineer who is not the requester cannot write files → capture row hidden.
    renderPage('proc-001', 'documents');
    expect(screen.getByTestId('procurement-ledger')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('AC-PROC-003: an Engineer requester CAN edit their own Draft line items', () => {
    mockEffectiveRole = 'Engineer';
    renderPage('proc-001', 'items');
    // u-alice is the requester AND the mocked currentUser → the add-row shows for the Engineer requester.
    expect(screen.getByTestId('line-item-add-row')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// UI-POLISH — One-Blue + copy disambiguation + no-access deep-link
// ---------------------------------------------------------------------------
describe('UI-POLISH: procurement detail surface refinements', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    detailState.refetch = vi.fn();
    mockTransition.mockClear();
    mockEffectiveRole = 'Finance';
  });

  // Polish #1 — Approve is the single primary blue; Reject stays a quiet outline.
  it('polish#1: Approve renders as the PRIMARY blue (not success-green)', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const approve = screen.getByRole('button', { name: /^approve$/i });
    expect(approve.className).toContain('bg-primary');
    expect(approve.className).not.toContain('bg-success');
  });

  it('polish#1: Reject stays a quiet outline at rest (no solid fill competing with Approve)', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const reject = screen.getByRole('button', { name: /^reject$/i });
    expect(reject.className).toContain('border-input');
    expect(reject.className).not.toContain('bg-destructive');
    expect(reject.className).not.toContain('bg-success');
  });

  // Polish #2 — the three "Cancel"s disambiguate: page action = "Cancel procurement",
  // and the confirm dialog's dismiss = "Keep procurement" (not "Cancel").
  it('polish#2: the PR cancel confirm dismiss reads "Keep procurement", not "Cancel"', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel procurement$/i }));
    const dialog = await screen.findByRole('alertdialog');
    // dismiss is the non-destructive button: "Keep procurement"
    expect(within(dialog).getByRole('button', { name: /^keep procurement$/i })).toBeInTheDocument();
    // the dialog must NOT carry a bare "Cancel" dismiss (the double-negative tell)
    expect(within(dialog).queryByRole('button', { name: /^cancel$/i })).toBeNull();
  });

  it('polish#2: "Keep procurement" dismisses the dialog WITHOUT firing the transition', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel procurement$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^keep procurement$/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mockTransition).not.toHaveBeenCalled();
  });

  // Polish #3 — an Engineer deep-linking a record they cannot read (RLS no-rows,
  // PGRST116) gets a clear "no access" state, not a blank main area or a raw error.
  it('polish#3: a no-access (PGRST116) record renders a "no access" gate, not a generic error', () => {
    mockEffectiveRole = 'Engineer';
    detailState.isError = true;
    detailState.error = Object.assign(new Error('no rows'), { code: 'PGRST116' });
    detailState.data = undefined;
    renderPage();
    const gate = screen.getByTestId('procurement-no-access');
    expect(gate).toBeInTheDocument();
    expect(gate).toHaveTextContent(/don.?t have access to this record/i);
    // it must NOT fall through to the generic "Couldn't load" transient-error state
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('polish#3: a genuine transient error (no PGRST116 code) still shows the retry error state', () => {
    detailState.isError = true;
    detailState.error = new Error('network down');
    detailState.data = undefined;
    renderPage();
    expect(screen.queryByTestId('procurement-no-access')).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));

describe('0349: approved-amount ceiling and quote re-route (AC-SEC-220/221)', () => {
  const invoicedOver = {
    ...baseProcurement,
    status: 'Vendor Invoiced' as const,
    requested_by_id: 'u-other',
    approved_by_id: 'u-approver',
    approved_total_value: 1000,
    paymentCeiling: { ok: false, reason: 'vendor bill exceeds approved amount', billedNet: 1200, approvedAmount: 1000 },
  };
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
    mockApproveAmount.mockClear();
    mockSelectQuote.mockClear();
    toast.mockClear();
  });

  it('AC-SEC-220: a blocked payment explains the overage and lets an eligible approver approve the billed amount', async () => {
    detailState.data = invoicedOver;
    renderPage();
    expect(screen.getByTestId('payment-ceiling-note')).toHaveTextContent('Billed amount exceeds the approved amount by');
    fireEvent.click(screen.getByRole('button', { name: 'Approve higher amount' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockApproveAmount).toHaveBeenCalledWith(1200));
  });

  it('AC-SEC-220: the requester sees the explanation but no approval action', () => {
    detailState.data = { ...invoicedOver, requested_by_id: 'u-alice' };
    renderPage();
    expect(screen.getByTestId('payment-ceiling-note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve higher amount' })).toBeNull();
  });

  it('AC-SEC-220: a role that cannot approve sees no approval action', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = invoicedOver;
    renderPage();
    expect(screen.getByTestId('payment-ceiling-note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve higher amount' })).toBeNull();
  });

  it('AC-SEC-220: a refused higher-amount approval surfaces a classified message', async () => {
    mockApproveAmount.mockRejectedValueOnce(Object.assign(new Error('separation of duties: the bill recorder cannot approve the billed amount'), { code: '42501' }));
    detailState.data = invoicedOver;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Approve higher amount' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.any(String), expect.anything(), 'warning'));
  });

  it('AC-SEC-220: within the approved amount there is no ceiling message', () => {
    detailState.data = { ...invoicedOver, paymentCeiling: { ok: true, reason: null, billedNet: 900, approvedAmount: 1000 } };
    renderPage();
    expect(screen.queryByTestId('payment-ceiling-note')).toBeNull();
  });

  const quoted = (amount: number) => ({
    ...baseProcurement,
    status: 'Vendor Quoted' as const,
    requested_by_id: 'u-other',
    approved_total_value: 1000,
    quotations: [{
      id: 'q9', org_id: 'org-1', procurement_id: 'proc-001', vendor_id: 'v2',
      total_amount: amount, currency: 'USD', vq_number: 'VQ-9', is_selected: false, reference: null,
      received_date: '2026-06-01', file_url: null,
    }],
  });
  const selectFirstQuote = async () => {
    fireEvent.click(screen.getAllByRole('button', { name: /select quote vq-9/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Select quote' }));
    await waitFor(() => expect(mockSelectQuote).toHaveBeenCalledWith('q9'));
  };

  it('AC-SEC-221: selecting a quote above the approved amount says the request went back for approval', async () => {
    detailState.data = quoted(1500);
    renderPage('proc-001', 'quotes');
    await selectFirstQuote();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      'Quote selected',
      'The quote is above the approved amount, so the procurement went back for approval.',
      'success',
    ));
  });

  it('AC-SEC-221: selecting a quote within the approved amount still reports Quote Selected', async () => {
    detailState.data = quoted(900);
    renderPage('proc-001', 'quotes');
    await selectFirstQuote();
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Quote selected', 'The procurement advanced to Quote Selected', 'success'));
  });
});
