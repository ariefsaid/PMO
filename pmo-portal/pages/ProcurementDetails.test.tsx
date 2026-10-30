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
const linkedDocsState = vi.hoisted(() => ({ data: [] as Record<string, unknown>[] }));
const projectScopeState = vi.hoisted(() => ({ data: { project_manager_id: 'u-alice' } as Record<string, unknown> | null, isPending: false, isError: false }));

vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => projectScopeState }));

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
const renderPage = (id = 'proc-001', tab?: string, query = '') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}${tab ? `/${tab}` : ''}${query}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>
  );

const chooseRecordKind = async (label: string) => {
  const header = screen.getByTestId('record-header');
  await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
  await userEvent.click(within(header).getByRole('menuitem', { name: label }));
};

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

  it('AC-1404: the four procurement stages show as a compact tracker', () => {
    renderPage();
    const tracker = screen.getByTestId('procurement-stage-tracker');
    expect(within(tracker).getAllByRole('listitem')).toHaveLength(4);
    expect(within(tracker).getByText('Request')).toBeInTheDocument();
    expect(within(tracker).getByText('Order')).toBeInTheDocument();
    expect(within(tracker).getByText('Receive')).toBeInTheDocument();
    expect(within(tracker).getByText('Pay')).toBeInTheDocument();
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

  it('AC-1404: the money card labels requested and ordered amounts from their sources', () => {
    renderPage();
    const moneyCard = screen.getByTestId('procurement-money-summary');
    expect(within(moneyCard).getByText('Requested')).toBeInTheDocument();
    // C6: the heading names the currency once, so the figures below are bare numbers.
    expect(within(moneyCard).getByText(/Money · USD, before tax/)).toBeInTheDocument();
    expect(within(moneyCard).getByText('50,000')).toBeInTheDocument();
    expect(within(moneyCard).queryByText('$50,000')).not.toBeInTheDocument();
    expect(within(moneyCard).getByText('Ordered')).toBeInTheDocument();
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

  it('PROC-004: quotation comparison cards identify the selected supplier and amount', () => {
    renderPage('proc-001', 'quotes');
    const comparisons = screen.getByTestId('quotation-comparison-cards');
    expect(within(comparisons).getByText('Synergy Systems')).toBeInTheDocument();
    expect(within(comparisons).getByText('$148,000')).toBeInTheDocument();
    expect(within(comparisons).getByText('Chosen')).toBeInTheDocument();
  });

  it('PROC-004: selected and lowest-price pills appear only on the chosen lowest quote row', () => {
    renderPage('proc-001', 'quotes');
    // VendorQuotesTab (Slice 3) replaced QuotationsSection — testid is now vendor-quotes.
    const section = screen.getByTestId('vendor-quotes');
    const quoteRows = Array.from(section.querySelectorAll('tr'));
    const chosenRow = quoteRows.find((row) => row.textContent?.includes('VQ-2602050001'));
    expect(chosenRow).toBeInTheDocument();
    expect(within(chosenRow as HTMLElement).getByText('Selected')).toBeInTheDocument();
    expect(within(chosenRow as HTMLElement).getByText('Lowest price')).toBeInTheDocument();

    const higherQuoteRow = quoteRows.find((row) => row.textContent?.includes('VQ-2602050002'));
    expect(higherQuoteRow).toBeInTheDocument();
    expect(within(higherQuoteRow as HTMLElement).queryByText('Selected')).not.toBeInTheDocument();
    expect(within(higherQuoteRow as HTMLElement).queryByText('Lowest price')).not.toBeInTheDocument();
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
    const header = screen.getByTestId('record-header');
    fireEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).getByRole('menuitem', { name: 'Reject' })).toBeInTheDocument();
  });

  it('AC-S20-001: the approver has one primary action with request and budget evidence on the page', async () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const budgetEvidence = screen.getByRole('heading', { name: /budget impact/i });
    const money = screen.getByTestId('procurement-money-summary');
    const header = screen.getByTestId('record-header');
    expect(screen.getByText('Workstations for HQ')).toBeInTheDocument();
    expect(screen.getByText('PROC-2026-001')).toBeInTheDocument();
    expect(within(money).getByText('50,000')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Approve' }).className).toContain('bg-primary');
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).getByRole('menuitem', { name: 'Reject' })).toBeInTheDocument();
    expect(within(header).getByRole('menuitem', { name: 'Cancel procurement' })).toBeInTheDocument();
    expect(budgetEvidence).toBeInTheDocument();
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

  it('AC-805: Submit for approval (Draft → Requested) is offered to Engineer', () => {
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
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    const rejectBtn = within(header).getByRole('menuitem', { name: /reject/i });
    // at rest: outline (background fill + input border), NOT the solid destructive fill
    // Reject remains in the overflow menu; its destructive confirmation is the actual action.
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
    await userEvent.type(screen.getByTestId('procurement-notes-input'), 'Over budget.');
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    await userEvent.click(within(header).getByRole('menuitem', { name: /reject/i }));
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

  it('AC-805 / IxD: an approver can enter an optional note beside the approval action', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
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
    renderPage('proc-001', 'timeline');
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

  it('Received status offers Record supplier invoice for Finance', () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other' };
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByRole('button', { name: 'Record supplier invoice' })).toBeInTheDocument();
  });

  it('Vendor Invoiced status offers Record payment for Finance (not the approver)', () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-someone-else',
    };
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
  });

  it('SoD-b: Record payment is NOT offered to the Finance user who approved the request', async () => {
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
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).queryByRole('menuitem', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('FR-PFE-005 payment-first: a Draft purchase with a recorded payment shows Mark as Paid to Finance, not to its approver', async () => {
    const withPayment = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other', payments: [{ id: 'pay-1', status: 'Scheduled', amount: 100 }] };
    detailState.data = { ...withPayment, approved_by_id: 'u-someone-else' };
    const first = renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).getByRole('menuitem', { name: /mark as paid/i })).toBeInTheDocument();
    first.unmount();
    detailState.data = { ...withPayment, approved_by_id: 'u-alice' };
    renderPage();
    const newHeader = screen.getByTestId('record-header');
    await userEvent.click(within(newHeader).getByRole('button', { name: /more procurement actions/i }));
    expect(within(newHeader).queryByRole('menuitem', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('a Draft purchase with no payment recorded has no secondary paid transition', async () => {
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other', payments: [] };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).queryByRole('menuitem', { name: /mark as paid/i })).not.toBeInTheDocument();
  });

  it('ADR-0093: a Requested purchase offers no record action; an approver is told to approve, the requester to wait', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    const first = renderPage('proc-001', 'files');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-capture-open')).not.toBeInTheDocument();
    first.unmount();
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage('proc-001', 'files');
    expect(screen.getAllByText('Waiting for approval').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('ledger-capture-open')).not.toBeInTheDocument();
  });

  it('AC-PFE-010: Record another document is filtered by what the role may record', async () => {
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other' };
    renderPage('proc-001', 'files');
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    // Finance may request, source, invoice and pay; it is not the requester and not a receiver, so no receipt.
    const menu = within(header).getByRole('menu', { name: /record another document/i });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Purchase request', 'Quote request', 'Purchase order', 'Supplier invoice', 'Payment',
      'Add quotation', 'Link from accounting system',
    ]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Supplier invoice' }));
    expect(screen.getByTestId('form-create-vi')).toBeInTheDocument();
  });

  it('D2 C1/C2: a goods receipt chosen as the first document is written through the page confirm, and only then reported', async () => {
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-other' };
    mockCreateReceipt.mockClear(); toast.mockClear();
    renderPage('proc-001', 'files');
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    await userEvent.click(within(header).getByRole('menuitem', { name: 'Receipt' }));
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
    renderPage('proc-001', 'files');
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    await userEvent.click(within(header).getByRole('menuitem', { name: 'Supplier invoice' }));
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    await confirmInDialog(/save supplier invoice/i);
    await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Supplier invoice recorded', undefined, 'success'));
  });

  it('an Engineer can record a receipt for their procurement but sees no Finance document kinds', async () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-alice' };
    renderPage('proc-001', 'files');
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    expect(within(header).getByRole('menuitem', { name: 'Receipt' })).toBeInTheDocument();
    expect(within(header).queryByRole('menuitem', { name: 'Supplier invoice' })).toBeNull();
    expect(within(header).queryByRole('menuitem', { name: 'Payment' })).toBeNull();
  });

  it('D2 C3: Mark as Paid is not offered on a purchase with nothing on it, and one line says why', () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', approved_by_id: 'u-someone-else', total_value: 0, items: [], invoices: [] };
    renderPage();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.getByText('Add a line item or a document with an amount before marking this paid.')).toBeInTheDocument();
  });

  it('Quote Selected status shows Record order for Finance', () => {
    detailState.data = { ...baseProcurement, status: 'Quote Selected', requested_by_id: 'u-other' };
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByRole('button', { name: 'Record order' })).toBeInTheDocument();
  });

  it('Rejected status shows Rework button for requester', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Rejected', requested_by_id: 'u-alice' };
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByRole('button', { name: 'Rework' })).toBeInTheDocument();
  });

  it('renders approval_notes when present', () => {
    detailState.data = { ...baseProcurement, status: 'Approved', statusEvents: [{ id: 'approved-note', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Approved', actor_id: 'u-alice', notes: 'Looks good.', created_at: '2026-06-05T00:00:00Z', org_id: 'org-1' }] };
    renderPage();
    expect(screen.getAllByText('Looks good.').length).toBeGreaterThan(0);
  });

  it('renders rejection_notes when present', () => {
    detailState.data = { ...baseProcurement, status: 'Rejected', statusEvents: [{ id: 'rejected-note', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Rejected', actor_id: 'u-alice', notes: 'Over budget.', created_at: '2026-06-05T00:00:00Z', org_id: 'org-1' }] };
    renderPage();
    expect(screen.getAllByText('Over budget.').length).toBeGreaterThan(0);
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
    await userEvent.click(within(screen.getByTestId('record-header')).getByRole('button', { name: 'Record payment' }));
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
    await userEvent.click(within(screen.getByTestId('record-header')).getByRole('button', { name: 'Record payment' }));
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
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    await userEvent.click(within(header).getByRole('menuitem', { name: 'Cancel procurement' }));
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

  it('offers a receipt capture for PM on Received status', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Receipt');
    expect(screen.getByTestId('form-create-gr')).toBeInTheDocument();
  });

  it('offers a receipt capture for PM on Ordered status', async () => {
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    expect(within(header).getByRole('menuitem', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('does NOT expose another requester’s receipt capture to an Engineer', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
  });

  // AC-AUTHZ: GR form mirrors the Ordered→Received authority — requester OR PM, not Finance.
  it('AC-AUTHZ: an Engineer requester can choose a receipt capture', async () => {
    mockEffectiveRole = 'Engineer';
    // u-alice is the mocked currentUser — making them the requester.
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-alice', receipts: [], invoices: [] };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    expect(within(header).getByRole('menuitem', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('AC-AUTHZ: Finance does NOT see the receipt capture (Finance excluded from Ordered→Received authority)', async () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /record another document/i }));
    expect(within(header).queryByRole('menuitem', { name: 'Receipt' })).toBeNull();
  });

  it('clicking Create GR shows the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Receipt');
    expect(screen.getByTestId('form-create-gr')).toBeInTheDocument();
    expect(screen.getByTestId('gr-status-select')).toBeInTheDocument();
  });

  it('P3: submitting GR form opens a confirm; createReceipt fires only on confirm', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Receipt');
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
    await chooseRecordKind('Receipt');
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

  it('offers a supplier invoice capture for Finance on an invoiced procurement', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Supplier invoice');
    expect(screen.getByTestId('form-create-vi')).toBeInTheDocument();
  });

  it('does NOT expose another requester’s supplier invoice capture to an Engineer', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
  });

  it('clicking Create VI shows the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Supplier invoice');
    expect(screen.getByTestId('form-create-vi')).toBeInTheDocument();
    expect(screen.getByTestId('vi-status-select')).toBeInTheDocument();
  });

  it('P4: submitting VI form opens a confirm; createInvoice fires only on confirm', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Supplier invoice');
    // #505: stating the tax treatment + amount is now part of recording a vendor invoice.
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
    await chooseRecordKind('Supplier invoice');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    // No confirm dialog, no write: the incomplete invoice never leaves the form.
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('cancelling VI form hides the form', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await chooseRecordKind('Supplier invoice');
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
    const header = screen.getByTestId('record-header');
    fireEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).getByTestId('edit-header')).toBeInTheDocument();
  });

  it('AC-PROC-002: header-edit is HIDDEN for a non-requester (record-scoped gate)', () => {
    // Edit is scoped to Draft/Rejected AND requester/Admin — a non-requester PM must not see it.
    detailState.data = { ...draftByAlice, requested_by_id: 'u-someone-else' };
    renderPage();
    const header = screen.getByTestId('record-header');
    fireEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).queryByTestId('edit-header')).toBeNull();
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

  it('AC-PROC-005: the Files tab renders the case ledger for a manager (capture affordance shown)', () => {
    // Slice 2: ProcurementDocumentsSection → ProcurementLedger (case ledger DataTable).
    // The 'documents-section' testid is replaced by 'procurement-ledger'; the 'add-document'
    // testid (old metadata form) is replaced by 'ledger-capture-row'.
    renderPage('proc-001', 'files');
    expect(screen.getByTestId('procurement-ledger')).toBeInTheDocument();
    // canManageFiles (PM = MASTER_DATA write) → capture row shows
    expect(screen.getByTestId('ledger-capture-row')).toBeInTheDocument();
  });

  it('AC-PROC-005: an Engineer sees the redacted document timeline without financial amounts', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-alice',
      invoices: [{ id: 'invoice-1', procurement_id: 'proc-001', vi_number: 'VI-1', amount: 62000, currency: 'USD', status: 'Received', invoice_date: '2026-06-02', created_at: '2026-06-02T00:00:00Z', org_id: 'org-1' }],
      payments: [{ id: 'payment-1', procurement_id: 'proc-001', amount: 12000, currency: 'USD', status: 'Paid', date: '2026-06-03', created_at: '2026-06-03T00:00:00Z', org_id: 'org-1' }],
    };
    renderPage('proc-001', 'files');
    expect(screen.getByTestId('procurement-timeline')).toBeInTheDocument();
    expect(screen.getByText('VI-1')).toBeInTheDocument();
    expect(screen.getByText('Invoices and payments are handled by Finance.')).toBeInTheDocument();
    expect(screen.queryByText('$62,000')).toBeNull();
    expect(screen.queryByText('$12,000')).toBeNull();
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

  // The primary approval action is blue; rejection stays in the overflow menu.
  it('polish#1: Approve renders as the PRIMARY blue (not success-green)', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const approve = screen.getByRole('button', { name: /^approve$/i });
    expect(approve.className).toContain('bg-primary');
    expect(approve.className).not.toContain('bg-success');
  });

  it('UIP-009: a Requested procurement shows its Purchase Request status in the record header', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(within(screen.getByTestId('record-header')).getByText('Purchase Request', { exact: true })).toBeInTheDocument();
  });

  it('AC-CONFIRM-001: Reject opens the existing destructive confirm without changing status', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /^Reject$/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(mockTransition).not.toHaveBeenCalled();
    expect(screen.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
    expect(screen.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');
  });

  it('polish#1: Reject is available from the overflow menu', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    expect(within(header).getByRole('menuitem', { name: /^reject$/i })).toBeInTheDocument();
  });

  // Polish #2 — the three "Cancel"s disambiguate: page action = "Cancel procurement",
  // and the confirm dialog's dismiss = "Keep request" (not "Cancel").
  it('polish#2: the PR cancel confirm dismiss reads "Keep request", not "Cancel"', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    await userEvent.click(within(header).getByRole('menuitem', { name: 'Cancel procurement' }));
    const dialog = await screen.findByRole('alertdialog');
    // dismiss is the non-destructive button: "Keep request"
    expect(within(dialog).getByRole('button', { name: /^keep procurement$/i })).toBeInTheDocument();
    // the dialog must NOT carry a bare "Cancel" dismiss (the double-negative tell)
    expect(within(dialog).queryByRole('button', { name: /^cancel$/i })).toBeNull();
  });

  it('polish#2: "Keep procurement" dismisses the dialog WITHOUT firing the transition', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    const header = screen.getByTestId('record-header');
    await userEvent.click(within(header).getByRole('button', { name: /more procurement actions/i }));
    await userEvent.click(within(header).getByRole('menuitem', { name: 'Cancel procurement' }));
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
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({
  useLinkedErpDocuments: () => ({ data: linkedDocsState.data, isError: false, isPending: false }),
  useUnlinkErpDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpOrphans: () => ({ data: [], isError: false, isPending: false }) }));
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

  it('AC-SEC-220: an Engineer cannot open another requester’s procurement or see its payment ceiling', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = invoicedOver;
    renderPage();
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
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

describe('AC-1404: procurement detail composition and role-safe actions', () => {
  beforeEach(() => {
    detailState.data = { ...baseProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    linkedDocsState.data = [];
    projectScopeState.data = { project_manager_id: 'u-alice' };
    projectScopeState.isPending = false;
    projectScopeState.isError = false;
    mockEffectiveRole = 'Finance';
  });

  it('AC-1404: Finance sees one filled Record payment action on an invoiced procurement', () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      invoices: [{ id: 'invoice-1', procurement_id: 'proc-001', vi_number: 'VI-1', amount: 62000, currency: 'USD', status: 'Received', invoice_date: '2026-06-02', created_at: '2026-06-02T00:00:00Z', org_id: 'org-1' }],
    };
    renderPage();

    const headerAction = within(screen.getByTestId('record-header')).getByRole('button', { name: 'Record payment' });
    expect(headerAction.className).toMatch(/bg-primary/);
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
  });

  it('AC-1404: an approver sees Approve and the approval-limit line, while the requester sees a waiting note', () => {
    detailState.data = {
      ...baseProcurement,
      requested_by_id: 'u-other',
      approvalRoute: { procurementId: 'proc-001', route: 'project', reason: 'within_budget', approvers: [{ id: 'u-alice', fullName: 'Alice Manager' }], requestAmount: 50000, lineBudget: 100000, lineUsed: 50000 },
    };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getAllByText('Within your limit').length).toBeGreaterThan(0);

    detailState.data = { ...baseProcurement, requested_by_id: 'u-alice' };
    renderPage();
    expect(screen.getAllByText(/Waiting for approval/i).length).toBeGreaterThan(0);
  });

  it('AC-1404: Engineer sees no supplier-invoice or payment amounts', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-alice',
      invoices: [{ id: 'invoice-1', procurement_id: 'proc-001', vi_number: 'VI-1', amount: 62000, currency: 'USD', status: 'Received', invoice_date: '2026-06-02', created_at: '2026-06-02T00:00:00Z', org_id: 'org-1' }],
      payments: [{ id: 'payment-1', procurement_id: 'proc-001', amount: 12000, currency: 'USD', status: 'Paid', date: '2026-06-03', created_at: '2026-06-03T00:00:00Z', org_id: 'org-1' }],
    };
    renderPage();

    expect(screen.getByText('Invoices and payments are handled by Finance.')).toBeInTheDocument();
    expect(screen.queryByText('$62,000')).toBeNull();
    expect(screen.queryByText('$12,000')).toBeNull();
  });

  it('AC-1404: timeline orders a linked accounting-system invoice and an approval note by date', () => {
    linkedDocsState.data = [{ id: 'erp-invoice-1', doctype: 'Purchase Invoice', name: 'ACC-INV-1', docDate: '2026-06-05', grandTotal: 62000, outstandingAmount: 62000 }];
    detailState.data = {
      ...baseProcurement,
      statusEvents: [{ id: 'event-1', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Approved', actor_id: 'u-finance', notes: 'Within approved project budget', created_at: '2026-06-04T00:00:00Z', org_id: 'org-1', actor: { full_name: 'Finance User' } }],
    };
    renderPage('proc-001', 'timeline');

    const rows = screen.getAllByTestId('procurement-timeline-row');
    const noteRow = rows.findIndex((row) => row.textContent?.includes('Within approved project budget'));
    const invoiceRow = rows.findIndex((row) => row.textContent?.includes('ACC-INV-1'));
    expect(noteRow).toBeGreaterThanOrEqual(0);
    expect(invoiceRow).toBeGreaterThan(noteRow);
    expect(rows[invoiceRow]).toHaveTextContent('from accounting system');
  });

  it('AC-1404: ?record=receipt opens the receipt capture form on arrival', () => {
    detailState.data = { ...orderedProcurement, requested_by_id: 'u-alice' };
    renderPage('proc-001', 'timeline', '?record=receipt');

    expect(screen.getByTestId('form-create-gr')).toBeInTheDocument();
  });

  it('AC-1404: a Project Manager can open only a procurement for a project they manage', () => {
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...baseProcurement, requested_by_id: 'u-other' };
    const first = renderPage();
    expect(screen.getByTestId('record-header')).toBeInTheDocument();

    first.unmount();
    projectScopeState.data = { project_manager_id: 'u-someone-else' };
    renderPage();
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
  });

  it('SEC-RS-1: a Project Manager opens an overhead procurement they raised (no project)', () => {
    mockEffectiveRole = 'Project Manager';
    projectScopeState.data = null;
    detailState.data = { ...baseProcurement, status: 'Draft', project_id: null, project: null, requested_by_id: 'u-alice' };
    renderPage();
    expect(screen.queryByTestId('procurement-no-access')).toBeNull();
    expect(screen.getByTestId('record-header')).toBeInTheDocument();
  });

  it("SEC-RS-1: a Project Manager opens their own procurement on another manager's project", () => {
    mockEffectiveRole = 'Project Manager';
    projectScopeState.data = { project_manager_id: 'u-someone-else' };
    detailState.data = { ...baseProcurement, status: 'Draft', requested_by_id: 'u-alice' };
    renderPage();
    expect(screen.queryByTestId('procurement-no-access')).toBeNull();
    expect(screen.getByTestId('record-header')).toBeInTheDocument();
  });

  it("SEC-RS-1: a Project Manager still cannot open a colleague's overhead procurement", () => {
    mockEffectiveRole = 'Project Manager';
    projectScopeState.data = null;
    detailState.data = { ...baseProcurement, project_id: null, project: null, requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByTestId('procurement-no-access')).toBeInTheDocument();
  });
});

describe('Procurement detail restructure fixes', () => {
  beforeEach(() => {
    detailState.data = { ...baseProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    linkedDocsState.data = [];
    projectScopeState.data = { project_manager_id: 'u-alice' };
    projectScopeState.isPending = false;
    projectScopeState.isError = false;
    mockEffectiveRole = 'Finance';
  });

  it('shows a skipped request stage and an unknown requested amount when an order exists', () => {
    detailState.data = {
      ...orderedProcurement,
      status: 'Vendor Invoiced',
      total_value: 110500,
      purchase_requests: [],
      purchase_orders: [
        { ...orderedProcurement.purchase_orders[0], id: 'po-first', po_number: 'PO-2609020001', amount: 84000, date: '2025-09-02', created_at: '2025-09-02T00:00:00Z' },
        { ...orderedProcurement.purchase_orders[0], id: 'po-second', po_number: 'PO-2609180002', amount: 26500, date: '2025-09-18', created_at: '2025-09-18T00:00:00Z' },
      ],
      receipts: [],
      invoices: [],
      payments: [],
    };

    renderPage();

    const tracker = screen.getByTestId('procurement-stage-tracker');
    const requestLabel = within(tracker).getByText('Request');
    expect(requestLabel).toHaveClass('text-muted-foreground');
    expect(within(tracker).getAllByText('Not recorded')).toHaveLength(2);
    expect(within(tracker).getByText(/Tue 2 Sep/)).toBeInTheDocument();

    const money = screen.getByTestId('procurement-money-summary');
    const requestedFigure = within(money).getByRole('button', { name: 'Requested calculation' }).parentElement?.parentElement;
    expect(requestedFigure).toHaveTextContent('—');
    expect(requestedFigure).toHaveTextContent('No purchase request: started at the order');
    expect(requestedFigure).not.toHaveTextContent('$110,500');
  });

  it('labels empty ordered, invoiced, and paid figures as not recorded', () => {
    renderPage();

    const money = screen.getByTestId('procurement-money-summary');
    expect(within(money).getAllByText('None recorded')).toHaveLength(3);
    for (const kind of ['Ordered', 'Invoiced', 'Paid']) {
      const figure = within(money).getByRole('button', { name: `${kind} calculation` }).parentElement?.parentElement;
      expect(figure).toHaveTextContent('—');
      expect(figure).toHaveTextContent('None recorded');
      expect(figure).not.toHaveTextContent('$0');
    }
  });

  it('keeps the engineer approval wait in the header actions without the floating paragraph', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement };

    renderPage();

    const headerActions = screen.getByTestId('record-header-actions');
    expect(within(headerActions).getByText('Waiting for approval by a project manager or Finance')).toBeInTheDocument();
    expect(screen.queryByTestId('sod-ready-hint')).toBeNull();
  });

  it('shows the raised event and the complete status progression in the timeline', () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Paid',
      statusEvents: [
        { id: 'submitted', procurement_id: 'proc-001', from_status: 'Draft', to_status: 'Requested', actor_id: 'u-alice', notes: null, created_at: '2026-06-04T01:00:00Z', org_id: 'org-1', actor: { full_name: 'Alice Manager' } },
        { id: 'approved', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Approved', actor_id: 'u-finance', notes: 'Budget approved', created_at: '2026-06-05T01:00:00Z', org_id: 'org-1', actor: { full_name: 'Finance User' } },
        { id: 'returned', procurement_id: 'proc-001', from_status: 'Requested', to_status: 'Rejected', actor_id: 'u-finance', notes: 'Choose a supplier first', created_at: '2026-06-06T01:00:00Z', org_id: 'org-1', actor: { full_name: 'Finance User' } },
        { id: 'cancelled', procurement_id: 'proc-001', from_status: 'Approved', to_status: 'Cancelled', actor_id: 'u-alice', notes: 'Project cancelled', created_at: '2026-06-07T01:00:00Z', org_id: 'org-1', actor: { full_name: 'Alice Manager' } },
        { id: 'paid', procurement_id: 'proc-001', from_status: 'Vendor Invoiced', to_status: 'Paid', actor_id: 'u-finance', notes: null, created_at: '2026-06-08T01:00:00Z', org_id: 'org-1', actor: { full_name: 'Finance User' } },
      ],
    };

    renderPage('proc-001', 'timeline');

    const rows = screen.getAllByTestId('procurement-timeline-row');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent('Procurement raised');
    expect(rows[0]).toHaveTextContent('Alice Manager');
    expect(rows[0]).toHaveTextContent('Thu 4 Jun');
    expect(screen.getByText('Submitted for approval')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Returned or rejected')).toBeInTheDocument();
    expect(screen.getByText('Choose a supplier first')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(rows[5]).toHaveTextContent('Paid');
  });
});
