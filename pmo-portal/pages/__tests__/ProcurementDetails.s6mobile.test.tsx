/**
 * Stream S6 — Wave-0 mobile UX fixes for ProcurementDetails
 *
 * B-C-2 + A-IMP-2 (AC-S6-1): sticky mobile primary action
 *   On mobile (isDesktop=false), the stage-appropriate primary action is anchored
 *   in a fixed bottom bar so it's always reachable. The decision-card action row
 *   is the canonical slot; the sticky bar mirrors the primary CTA on mobile only.
 *
 * B-IMP-2 (AC-S6-2): SoD pre-announce on draft state for the author
 *   When the PR is in Draft and the current user is the requester (author),
 *   show inline copy "Submitting hands this to another approver — you can't
 *   approve your own request." so the author understands SoD before submitting.
 *
 * C-IMP-1 (AC-S6-3): BackBar on success render at <=921px
 *   The BackBar is rendered (conditionally visible via CSS) on the success render
 *   path so mobile users have an in-content back escape. On desktop it is hidden.
 *   jsdom can't measure viewport, so we assert the BackBar DOM element is present
 *   in the success render with the correct hidden/visible CSS classes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Stub ProcurementFilesSubsection — it calls useQueryClient() internally.
// Page-level tests focus on lifecycle/UX behavior; the subsection has its own
// unit tests. This matches the pattern in all sibling ProcurementDetails test files.
// ---------------------------------------------------------------------------
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
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }) };
});

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
  total_value: 500,
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

const renderPage = (id = 'proc-s6-001') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
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
    navigate.mockClear();
    renderPage();
    const backBtn = screen.getByRole('button', { name: /Back to Procurement/i });
    backBtn.click();
    expect(navigate).toHaveBeenCalledWith('/procurement');
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
    expect(notice).toHaveTextContent(/can.?t approve your own request/i);
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
// AC-S6-1: sticky mobile primary action (B-C-2 + A-IMP-2)
// ---------------------------------------------------------------------------
describe('AC-S6-1 (B-C-2 + A-IMP-2): sticky mobile primary action bar', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
    mockEffectiveRole = 'Engineer';
    mockIsDesktop = false;
  });

  it('AC-S6-1: mobile success render with actions shows the sticky-action bar', () => {
    detailState.data = { ...draftByAlice }; // Draft + has items → Submit Request shown
    renderPage();
    // The sticky action bar must be present with the testid
    expect(screen.getByTestId('mobile-sticky-action')).toBeInTheDocument();
  });

  it('AC-S6-1: the sticky bar carries fixed/sticky bottom positioning classes', () => {
    detailState.data = { ...draftByAlice };
    renderPage();
    const sticky = screen.getByTestId('mobile-sticky-action');
    const cls = sticky.className;
    // Must use fixed/sticky positioning at bottom
    expect(/fixed|sticky/.test(cls)).toBe(true);
    expect(/bottom-/.test(cls)).toBe(true);
  });

  it('AC-S6-1: the sticky bar is only shown on mobile (max-[920px] or hidden on desktop)', () => {
    detailState.data = { ...draftByAlice };
    renderPage();
    const sticky = screen.getByTestId('mobile-sticky-action');
    // Must be hidden on desktop-sized viewports
    expect(sticky.className).toContain('hidden');
    expect(sticky.className).toMatch(/max-\[920px\]/);
  });

  it('AC-S6-1: the sticky bar contains the stage primary action label (Submit Request for Draft)', () => {
    detailState.data = { ...draftByAlice };
    renderPage();
    const sticky = screen.getByTestId('mobile-sticky-action');
    // The sticky bar is aria-hidden (reach shortcut, not canonical slot) so we check textContent
    expect(sticky.textContent).toMatch(/submit request/i);
  });

  it('AC-S6-1: on terminal status (Paid, no actions) the sticky bar is absent or empty', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...paidByAlice };
    renderPage();
    // When no actions are available, the sticky bar should not render
    expect(screen.queryByTestId('mobile-sticky-action')).toBeNull();
  });
});
