/**
 * AC-IXD-PROC-W5-1 — Wave-5 PR-1: Evidence-before-decision reorder
 *
 * (Restructured for the header-action page, #1404 — see the note above the first describe.)
 * Four behavioral assertions:
 *  (a) Evidence (line-items section + quotations section) appears BEFORE the
 *      DecisionCard (the action buttons) in DOM order.
 *  (b) At `Approved`, exactly ONE button is primary; "Generate Purchase Order"
 *      is present but NOT primary — both are reachable (OD-W5-2).
 *  (c) SoD-blocked state: GateNotice renders INSIDE the decision area when the
 *      viewer cannot approve; NO action buttons appear in that area (D6).
 *  (d) "Cancel procurement" (destructive) renders AFTER/BELOW the primary CTA —
 *      never before it in DOM order (D8).
 *
 * All states: normal / SoD-blocked / terminal (Paid — no decision actions).
 * Terminal + adminBreakGlass existing tests must not regress.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Shared mock state (mutable per test)
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

// The per-phase file sub-section has its own unit test + needs a QueryClient;
// stub it here so the page tests stay focused on the lifecycle behavior.
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
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
}));

let mockRole = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockRole, realRole: mockRole }),
}));
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel now mounts in ProcurementDetails.
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
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));

vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
import { headerActions, openMoreActions } from '@/pages/__tests__/helpers/procurementHeader';
import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 50000, currency: 'USD',
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Alice Requester' },
  approved_by: null,
  items: [
    {
      id: 'it1',
      org_id: 'org-1',
      procurement_id: 'proc-001',
      name: 'Laptop Workstation',
      description: null,
      quantity: 10,
      rate: 5000,
      amount: 50000,
    },
  ],
  quotations: [
    {
      id: 'q-1',
      procurement_id: 'proc-001',
      vendor_id: 'v-1',
      total_amount: 48000,
      currency: 'USD',
      vq_number: 'VQ-001',
      is_selected: false,
      reference: 'REF-001',
      received_date: '2026-06-01',
      file_url: null,
      org_id: 'org-1',
      created_at: '2026-06-01T00:00:00Z',
    },
  ],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

const approvedBase = {
  ...base,
  status: 'Approved' as const,
  requested_by_id: 'u-other',
};

const paidBase = {
  ...base,
  status: 'Paid' as const,
  approved_by_id: 'u-fin',
  receipts: [
    {
      id: 'r-1',
      procurement_id: 'proc-001',
      gr_number: 'GR-001',
      status: 'Complete',
      receipt_date: '2026-06-05',
      org_id: 'org-1',
      created_at: '2026-06-05T00:00:00Z',
    },
  ],
  invoices: [
    {
      id: 'i-1',
      procurement_id: 'proc-001',
      vi_number: 'VI-001',
      status: 'Paid',
      invoice_date: '2026-06-06',
      org_id: 'org-1',
      created_at: '2026-06-06T00:00:00Z',
    },
  ],
};

// Requester viewing their own Requested PR — SoD blocks approval
const selfRequestedBase = {
  ...base,
  status: 'Requested' as const,
  requested_by_id: 'u-alice', // u-alice is the currentUser mock
};

// Draft with Cancel available (Draft → Cancelled is valid for requester)
const draftWithCancelBase = {
  ...base,
  status: 'Draft' as const,
  requested_by_id: 'u-alice', // requester = currentUser
  items: [
    {
      id: 'it1',
      org_id: 'org-1',
      procurement_id: 'proc-001',
      name: 'Laptop',
      description: null,
      quantity: 1,
      rate: 1000,
      amount: 1000,
    },
  ],
};

// Tabbed shell (`/procurement/:id/:tab?`). The decision zone (action buttons) renders
// OUTSIDE the tabs (after the active panel in DOM), so the "evidence precedes decision"
// goal holds on whichever tab the evidence lives. `tab` deep-links the owning panel.
const renderPage = (tab?: string) =>
  render(
    <MemoryRouter initialEntries={[`/procurement/proc-001${tab ? `/${tab}` : ''}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Helper: get the compare-position of two elements in DOM order.
// Returns true if `a` appears before `b` in document order.
// ---------------------------------------------------------------------------
function appearsBeforeInDOM(a: Element, b: Element): boolean {
  return !!(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

// ---------------------------------------------------------------------------
// The procurement record restructure (#1404) moved the decision from a sticky card BELOW the evidence to the
// RecordHeader: one primary action in `record-header-actions`, the rest (Return/Reject, Cancel procurement,
// Request quotations, …) in its "More procurement actions" menu. So the old evidence-before-decision DOM order
// is deliberately reversed (the action leads the page); what still holds, and is asserted below, is that the
// SoD/policy explanation follows the financial evidence, there is exactly one primary per stage, and the
// destructive verbs sit after the primary.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (a) — S-20: policy / SoD context follows the financial evidence.
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (a): policy context follows the request evidence', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-S20-001: budget evidence precedes the approval policy note', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const evidence = screen.getByRole('heading', { name: /budget impact/i });
    const policy = screen.getByTestId('sod-ready-hint');
    expect(appearsBeforeInDOM(evidence, policy)).toBe(true);
  });

  it('AC-IXD-PROC-W5-1a: the lifecycle tracker and the line-items evidence are on the page for the approver', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('items');
    expect(screen.getByTestId('procurement-stage-tracker')).toBeInTheDocument();
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
    expect(headerActions().getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1a: at terminal Paid state the header offers no lifecycle action buttons', () => {
    mockRole = 'Finance';
    detailState.data = { ...paidBase };
    renderPage();
    expect(screen.queryByRole('button', { name: /record payment/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (b) — One primary per stage (One-Blue Rule); both Approved paths reachable
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (b): exactly one primary button per stage (One-Blue Rule)', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  const primaries = () => headerActions().getAllByRole('button').filter((btn) => btn.className.includes('bg-primary'));

  it('AC-IXD-PROC-W5-1b: at Approved stage exactly ONE header button carries the primary variant class', () => {
    detailState.data = { ...approvedBase };
    renderPage();
    expect(primaries()).toHaveLength(1);
  });

  // The Approved primary is now "Record order" (the restructure prefers the order step; see the report on
  // OD-W5-2): quotations stay one menu click away, so BOTH paths remain reachable and only one is blue.
  it('AC-IXD-PROC-W5-1b: at Approved stage "Record order" is the primary button', () => {
    detailState.data = { ...approvedBase };
    renderPage();
    expect(headerActions().getByRole('button', { name: 'Record order' }).className).toContain('bg-primary');
  });

  it('AC-IXD-PROC-W5-1b: at Approved stage "Request quotations" is present but NOT primary (a menu item)', async () => {
    detailState.data = { ...approvedBase };
    renderPage();
    const header = await openMoreActions();
    const quotes = header.getByRole('menuitem', { name: 'Request quotations' });
    expect(quotes.className).not.toContain('bg-primary');
  });

  it('AC-IXD-PROC-W5-1b: both Approved-stage paths are reachable (order action + request quotations)', async () => {
    detailState.data = { ...approvedBase };
    renderPage();
    expect(headerActions().getByRole('button', { name: 'Record order' })).toBeInTheDocument();
    const header = await openMoreActions();
    expect(header.getByRole('menuitem', { name: 'Request quotations' })).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1b: at Requested stage (Finance, not requester) exactly ONE primary (Approve)', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toHaveAccessibleName(/^approve$/i);
  });

  it('AC-IXD-PROC-W5-1b: no stage emits two primary buttons (Draft submit check)', () => {
    mockRole = 'Engineer';
    detailState.data = {
      ...base,
      status: 'Draft',
      requested_by_id: 'u-alice',
      items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Widget', description: null, quantity: 1, rate: 500, amount: 500 }],
    };
    renderPage();
    expect(primaries().length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (c) — SoD: a viewer who cannot decide gets no decision buttons and a reason
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (c): SoD-blocked state — no decision actions, the reason is stated', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  // The requester's own Requested purchase now reads "Waiting for approval" next to the header actions (the
  // longer separation-of-duties gate paragraph was dropped from the requester's view by the restructure).
  it('AC-IXD-PROC-W5-1c: when the requester views their own Requested PR, the header says it is waiting for approval', () => {
    // u-alice (currentUser) is both Finance role AND the requester → SoD blocked
    detailState.data = { ...selfRequestedBase };
    renderPage();
    expect(within(screen.getByTestId('record-header-actions')).getByText(/waiting for approval/i)).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1c: SoD-blocked state has NO Approve/Reject in the header actions or its menu', async () => {
    detailState.data = { ...selfRequestedBase };
    renderPage();

    const header = await openMoreActions();
    expect(header.queryByRole('button', { name: /^approve$/i })).toBeNull();
    expect(header.queryByRole('menuitem', { name: /^reject$/i })).toBeNull();
    expect(header.getByRole('menuitem', { name: 'Full history' })).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1c: a non-SoD-blocked Finance viewer sees Approve+Reject in the header (no gate)', async () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    expect(headerActions().getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    const header = await openMoreActions();
    expect(header.getByRole('menuitem', { name: /^reject$/i })).toBeInTheDocument();
    // No SoD gate notice for an unblocked viewer
    expect(screen.queryByTestId('sod-blocked-hint')).toBeNull();
    expect(screen.queryByText(/separation-of-duties gate/i)).toBeNull();
  });

  it('AC-IXD-PROC-W5-1c: the SoD-aware ready hint is shown when the viewer CAN act', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    // Since I5 the copy is SoD-aware ("You may approve or reject…") rather than the old generic copy.
    expect(screen.getByTestId('sod-ready-hint')).toHaveTextContent(/you may approve or reject|requester cannot self.?approv/i);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (d) — Destructive verbs render AFTER the primary CTA in DOM order (D8)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (d): destructive verbs render after the primary CTA in DOM order (D8)', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1d: at Draft+requester, "Cancel procurement" appears after "Submit for approval" in DOM order', async () => {
    mockRole = 'Engineer';
    detailState.data = {
      ...draftWithCancelBase,
      items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Widget', description: null, quantity: 1, rate: 500, amount: 500 }],
    };
    renderPage();

    const submitBtn = headerActions().getByRole('button', { name: 'Submit for approval' });
    const header = await openMoreActions();
    const cancelItem = header.getByRole('menuitem', { name: /^cancel procurement$/i });

    expect(
      appearsBeforeInDOM(submitBtn, cancelItem),
      '"Submit for approval" (primary) must appear before "Cancel procurement" in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1d: at Requested (Finance, not requester), "Cancel procurement" appears after "Approve" in DOM order', async () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const approveBtn = headerActions().getByRole('button', { name: /^approve$/i });
    const header = await openMoreActions();
    const cancelItem = header.getByRole('menuitem', { name: /^cancel procurement$/i });

    expect(
      appearsBeforeInDOM(approveBtn, cancelItem),
      '"Approve" (primary) must appear before "Cancel procurement" in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1d: at Approved stage, "Cancel procurement" appears after "Record order" in DOM order', async () => {
    detailState.data = { ...approvedBase };
    renderPage();

    const orderBtn = headerActions().getByRole('button', { name: 'Record order' });
    const header = await openMoreActions();
    const cancelItem = header.getByRole('menuitem', { name: /^cancel procurement$/i });

    expect(
      appearsBeforeInDOM(orderBtn, cancelItem),
      '"Record order" (primary) must appear before "Cancel procurement" in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1d: "Reject" appears after "Approve" in DOM order', async () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const approveBtn = headerActions().getByRole('button', { name: /^approve$/i });
    const header = await openMoreActions();
    const rejectItem = header.getByRole('menuitem', { name: /^reject$/i });

    expect(
      appearsBeforeInDOM(approveBtn, rejectItem),
      '"Approve" (primary) must appear before "Reject" in DOM order',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-regression: all existing terminal / adminBreakGlass behaviors still hold
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 non-regression: terminal + adminBreakGlass states unaffected', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('non-regression: Paid state shows no transition buttons anywhere on the page', () => {
    detailState.data = { ...paidBase };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /record payment/i })).toBeNull();
  });

  it('non-regression: the line-items section still renders at Requested state', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('items');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
  });

  it('non-regression: the vendor-quotes section (VendorQuotesTab) still renders at Requested state', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('quotes');
    // VendorQuotesTab (Slice 3) replaced QuotationsSection — testid is now vendor-quotes.
    expect(screen.getByTestId('vendor-quotes')).toBeInTheDocument();
  });

  it('non-regression: Approve is still a primary blue (no regression from W5-1b)', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const approveBtn = headerActions().getByRole('button', { name: /^approve$/i });
    expect(approveBtn.className).toContain('bg-primary');
  });

  it('non-regression: Reject is never a loud destructive fill (a quiet menu item)', async () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const header = await openMoreActions();
    const rejectItem = header.getByRole('menuitem', { name: /^reject$/i });
    expect(rejectItem.className).not.toContain('bg-destructive');
    expect(rejectItem.className).not.toContain('bg-primary');
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
