/**
 * Stream S6 — Wave-0 mobile UX fixes for ProcurementDetails
 *
 * AC-S20-001: one evidence-first decision area
 *   The RecordHeader's primary action is the single decision control (#1404); there is no legacy
 *   mirrored mobile sticky-action bar.
 *
 * B-IMP-2 (AC-S6-2): SoD pre-announce on draft state for the author
 *   When the PR is in Draft and the current user is the requester (author),
 *   show inline copy "Submitting hands this to another approver — you can't
 *   approve your own procurement record." so the author understands SoD before submitting.
 *
 * C-IMP-1 (AC-S6-3): BackBar on success render at <=921px
 *   The BackBar is rendered (conditionally visible via CSS) on the success render
 *   path so mobile users have an in-content back escape. On desktop it is hidden.
 *   jsdom can't measure viewport, so we assert the BackBar DOM element is present
 *   in the success render with the correct hidden/visible CSS classes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BahasaProvider } from '@/test/bahasa';
import enProcurementRecord from '../../public/locales/en/procurementRecord.json';
import idProcurementRecord from '../../public/locales/id/procurementRecord.json';

// ---------------------------------------------------------------------------
// Stub ProcurementFilesSubsection — it calls useQueryClient() internally.
// Page-level tests focus on lifecycle/UX behavior; the subsection has its own
// unit tests. This matches the pattern in all sibling ProcurementDetails test files.
// ---------------------------------------------------------------------------
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/hooks/useProcurementItemEligibility', () => ({ useProcurementItemEligibility: () => ({ data: true, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }) }));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => ({ ...((await orig()) as Record<string, unknown>), useOrgTaxDefault: () => undefined }));
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

// ---------------------------------------------------------------------------
// Hook mocks (same pattern as the main test file)
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

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: mockCreateQuotation, isPending: false, error: null },
    createReceipt: { mutateAsync: mockCreateReceipt, isPending: false, error: null },
    createInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

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

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Engineer' }),
}));

let mockEffectiveRole = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole, realRole: mockEffectiveRole }),
}));

const navigate = vi.fn();
const toast = vi.fn();
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }), useIsNarrow: () => mockIsNarrow };
});
let mockIsNarrow = false;

// Stub hooks that DecisionSupportPanel uses
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

// useIsDesktop mock — controlled per test
let mockIsDesktop = false; // default: mobile
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => mockIsDesktop,
}));

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));

vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A Draft PR owned by u-alice (the mocked currentUser). */
const draftByAlice = {
  id: 'proc-s6-001',
  code: 'PROC-2026-S6-001',
  title: 'Office Supplies',
  status: 'Draft' as const,
  total_value: 500, currency: 'USD',
  pr_number: 'PR-2606130001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-alice',   // = currentUser.id → isRequester = true
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-13T00:00:00Z',
  updated_at: '2026-06-13T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001', budget: 1000000, spent: 0 },
  vendor: null,
  requested_by: { full_name: 'Alice Engineer' },
  approved_by: null,
  items: [
    { id: 'it1', org_id: 'org-1', procurement_id: 'proc-s6-001',
      name: 'Pens', description: null, quantity: 50, rate: 10, amount: 500 },
  ],
  quotations: [],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

/** A Draft PR by someone else — u-alice is NOT the requester (tests SoD copy absent). */
const draftByOther = {
  ...draftByAlice,
  requested_by_id: 'u-other',
  requested_by: { full_name: 'Bob PM' },
};

/** A Requested PR (not Draft) with u-alice as requester — SoD gate shows, not the pre-announce. */
const requestedByAlice = {
  ...draftByAlice,
  status: 'Requested' as const,
};

/** A Paid PR — terminal, no actions. */
const paidByAlice = {
  ...draftByAlice,
  status: 'Paid' as const,
  po_number: 'PO-001',
  approved_by_id: 'u-finance',
  approved_by: { full_name: 'Finance User' },
  quotations: [],
  receipts: [{ id: 'r1', procurement_id: 'proc-s6-001', gr_number: 'GR-001', status: 'Complete' as const, receipt_date: '2026-06-01', org_id: 'org-1', created_at: '2026-06-01T00:00:00Z' }],
  invoices: [{ id: 'i1', procurement_id: 'proc-s6-001', vi_number: 'VI-001', status: 'Paid' as const, invoice_date: '2026-06-10', org_id: 'org-1', created_at: '2026-06-10T00:00:00Z' }],
};

const renderPage = (id = 'proc-s6-001', state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: `/procurement/${id}`, state }]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
const ProcurementRecordCatalogue = ({ children }: { children: React.ReactNode }) => {
  const { i18n } = useTranslation();
  i18n.addResourceBundle('en', 'procurementRecord', enProcurementRecord, true, true);
  i18n.addResourceBundle('id', 'procurementRecord', idProcurementRecord, true, true);
  return <>{children}</>;
};

const renderBahasaPage = (id = 'proc-s6-001') =>
  render(
    <BahasaProvider>
      <ProcurementRecordCatalogue>
        <MemoryRouter initialEntries={[`/procurement/${id}`]}>
          <Routes>
            <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
          </Routes>
        </MemoryRouter>
      </ProcurementRecordCatalogue>
    </BahasaProvider>,
  );

// AC-S6-3: BackBar on success render at <=921px (C-IMP-1)
// ---------------------------------------------------------------------------
describe('AC-S6-3 (C-IMP-1): BackBar present in success render DOM for mobile back-nav', () => {
  beforeEach(() => {
    detailState.data = { ...draftByAlice };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Engineer';
    mockIsDesktop = false; // mobile
  });

  it('AC-S6-3: the success render includes a "Back to Procurement" button (mobile BackBar in DOM)', () => {
    renderPage();
    // The BackBar must be present in the DOM on the success render (mobile escape route).
    // On desktop it is hidden via CSS, but the DOM node must exist for single-render parity.
    const backBtn = screen.getByTestId('mobile-back-bar');
    expect(backBtn).toBeInTheDocument();
  });

  it('AC-S6-3: the mobile BackBar carries max-[920px]:block and hidden classes (CSS-only show/hide)', () => {
    renderPage();
    const mobileBackBar = screen.getByTestId('mobile-back-bar');
    // Must be hidden on desktop (hidden = display:none by default) and block on mobile.
    expect(mobileBackBar.className).toContain('hidden');
    expect(mobileBackBar.className).toContain('max-[920px]:block');
  });

  it('AC-S6-3: clicking the mobile BackBar navigates to /procurement', async () => {
    // Director ruling (2026-09-29): the destination stays canonical `/procurement` while a
    // direct link with no captured list context now additionally carries validated clean
    // return state (the same fallback shape as AC-NAV-007's Projects/Procurement equivalents).
    navigate.mockClear();
    renderPage();
    const backBtn = screen.getByRole('button', { name: /Back to Procurement/i });
    backBtn.click();
    expect(navigate).toHaveBeenCalledWith('/procurement', { state: {} });
  });
});

// ---------------------------------------------------------------------------
// AC-S6-2: SoD pre-announce on Draft state for the author (B-IMP-2)
// ---------------------------------------------------------------------------
describe('AC-S6-2 (B-IMP-2): SoD pre-announce shown to author on Draft', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Engineer';
    mockIsDesktop = false;
  });

  it('AC-S6-2: Draft author sees the SoD pre-announce copy', () => {
    detailState.data = { ...draftByAlice }; // u-alice = requester
    renderPage();
    // The pre-announce must appear for Draft status when viewer is the author
    expect(screen.getByTestId('sod-pre-announce')).toBeInTheDocument();
    expect(screen.getByTestId('sod-pre-announce')).toHaveTextContent(
      /submitting hands this to another approver/i,
    );
  });

  it('AC-S6-2: pre-announce copy mentions self-approval restriction', () => {
    detailState.data = { ...draftByAlice };
    renderPage();
    const notice = screen.getByTestId('sod-pre-announce');
    expect(notice).toHaveTextContent(/can.?t approve your own procurement/i);
  });

  it('AC-S6-2: localizes the procurement-record SoD pre-announce in Bahasa', () => {
    detailState.data = { ...draftByAlice };
    renderBahasaPage();
    expect(screen.getByTestId('sod-pre-announce')).toHaveTextContent(
      'Mengirim ini ke peninjau lain. Anda tidak dapat menyetujui catatan pengadaan Anda sendiri.',
    );
  });

  it('AC-S6-2: the pre-announce is NOT shown when the viewer is NOT the author (Draft, different user)', () => {
    detailState.data = { ...draftByOther }; // u-alice is not requester
    renderPage();
    expect(screen.queryByTestId('sod-pre-announce')).toBeNull();
  });

  it('AC-S6-2: the pre-announce is NOT shown for non-Draft statuses (e.g. Requested)', () => {
    detailState.data = { ...requestedByAlice }; // Requested, not Draft
    renderPage();
    // At Requested, the SoD blocked-VIEWER gate already shows; no Draft pre-announce needed
    expect(screen.queryByTestId('sod-pre-announce')).toBeNull();
  });

  it('AC-S6-2: the pre-announce is NOT shown on Paid (terminal, no actions)', () => {
    mockEffectiveRole = 'Finance'; // Finance to see paid state cleanly
    detailState.data = { ...paidByAlice };
    renderPage();
    expect(screen.queryByTestId('sod-pre-announce')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-S20-001: one evidence-first decision area; no legacy mirrored phone CTA.
// The decision card + sticky RecordActionZone were replaced by the RecordHeader's one primary action
// (#1404); the phone-only fixed bar repeats that same verb. Look pins (sticky/bottom-0 classes, button
// counts inside a zone) are dropped; the goal — one canonical control, no second legacy bar — holds.
// ---------------------------------------------------------------------------
describe('AC-S20-001: one decision area on phone', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Engineer';
    mockIsDesktop = false;
  });

  it('AC-S20-001: a Draft request has one Submit control in the header actions and no legacy mobile bar', () => {
    detailState.data = { ...draftByAlice };
    renderPage();
    const actions = screen.getByTestId('record-header-actions');
    expect(within(actions).getAllByRole('button', { name: /submit for approval/i })).toHaveLength(1);
    expect(screen.queryByTestId('mobile-sticky-action')).toBeNull();
  });

  it('AC-S20-001: a terminal request has no mirrored bar or transition action', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...paidByAlice };
    renderPage();
    expect(screen.queryByTestId('mobile-sticky-action')).toBeNull();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
  });
});

describe('B4: one filled main action per screen, wherever it is started', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Engineer';
    mockIsDesktop = false;
    mockIsNarrow = false;
  });

  it('B4: below 640px only the phone action bar carries the main action', () => {
    mockIsNarrow = true;
    detailState.data = { ...draftByAlice };
    renderPage();
    expect(screen.getAllByRole('button', { name: /submit for approval/i })).toHaveLength(1);
    expect(within(screen.getByTestId('record-header-actions')).queryByRole('button', { name: /submit for approval/i })).toBeNull();
  });

  it('B4: opening the record from the drawer main action starts that same action', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...draftByOther, status: 'Received' as const };
    renderPage('proc-s6-001', { runMainAction: 'Vendor Invoiced' });
    expect(screen.getByTestId('vi-inline-capture')).toBeInTheDocument();
  });

  it('B4: a stale hand-off for a different step does nothing', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...draftByOther, status: 'Received' as const };
    renderPage('proc-s6-001', { runMainAction: 'Paid' });
    expect(screen.queryByTestId('vi-inline-capture')).toBeNull();
  });
});

describe('C1/O18: the no-access page names the record a procurement and carries the page heading', () => {
  it('C1: a hidden or missing record reads as a procurement, under one h1', () => {
    detailState.data = undefined;
    detailState.isError = true;
    detailState.error = Object.assign(new Error('not found'), { code: 'PGRST116' });
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    const page = screen.getByTestId('procurement-no-access');
    expect(page).toHaveTextContent('This procurement record either doesn\'t exist');
    expect(page).not.toHaveTextContent(/request/i);
    detailState.isError = false;
    detailState.error = null;
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
