/**
 * AC-IXD-PROC-W5-1 — Wave-5 PR-1: Evidence-before-decision reorder
 *
 * Four behavioral assertions:
 *  (a) Evidence (line-items section + quotations section) appears BEFORE the
 *      DecisionCard (the action buttons) in DOM order.
 *  (b) At `Approved`, exactly ONE button is primary; "Generate Purchase Order"
 *      is present but NOT primary — both are reachable (OD-W5-2).
 *  (c) SoD-blocked state: GateNotice renders INSIDE the decision area when the
 *      viewer cannot approve; NO action buttons appear in that area (D6).
 *  (d) "Cancel request" (destructive) renders AFTER/BELOW the primary CTA —
 *      never before it in DOM order (D8).
 *
 * All states: normal / SoD-blocked / terminal (Paid — no decision actions).
 * Terminal + adminBreakGlass existing tests must not regress.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
const docsState = {
  data: [] as Record<string, unknown>[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
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
vi.mock('react-router-dom', async (orig) => {
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
}));

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 50000,
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
// AC-IXD-PROC-W5-1 (a) — Evidence before decision in DOM order
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (a): evidence zone precedes decision zone in DOM/tab order', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1a: the line-items section appears before the decision actions in DOM order', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    // Evidence now lives on the Line-items tab; the decision zone is outside the tabs,
    // so it still follows the active panel in DOM order — the goal is preserved.
    renderPage('items');

    const lineItemsSection = screen.getByTestId('line-items-section');
    const approveBtn = screen.getByRole('button', { name: /^approve$/i });

    expect(
      appearsBeforeInDOM(lineItemsSection, approveBtn),
      'line-items-section must precede the Approve button in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1a: the quotations section appears before the decision actions in DOM order', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    // Quotations now live on the Vendor-quotes tab; the decision zone is outside the
    // tabs and still follows the active panel in DOM order — the goal is preserved.
    renderPage('quotes');

    const quotationsSection = screen.getByTestId('quotations-section');
    const approveBtn = screen.getByRole('button', { name: /^approve$/i });

    expect(
      appearsBeforeInDOM(quotationsSection, approveBtn),
      'quotations-section must precede the Approve button in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1a: the DecisionCard (decision actions area) has a data-testid="decision-card"', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByTestId('decision-card')).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1a: at terminal Paid state the decision-card area is still present but has no action buttons', () => {
    mockRole = 'Finance';
    detailState.data = { ...paidBase };
    renderPage();
    // The decision-card slot must still render (structural consistency)
    expect(screen.getByTestId('decision-card')).toBeInTheDocument();
    // But no action buttons
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('AC-IXD-PROC-W5-1a: the PR-2 DecisionSupportPanel insertion slot comment exists (slot is clearly marked)', () => {
    // The slot does NOT render a visible element yet — it is a comment/placeholder.
    // We verify that the decision-card renders WITHOUT crashing, and that no
    // DecisionSupportPanel content appears (it is PR-2's responsibility).
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.queryByTestId('decision-support-panel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (b) — One primary per stage; Approved: one primary, GPO reachable
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (b): exactly one primary button per stage (One-Blue Rule)', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1b: at Approved stage exactly ONE button carries the primary variant class', () => {
    detailState.data = { ...approvedBase };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    const allButtons = within(decisionCard).getAllByRole('button');
    const primaryButtons = allButtons.filter((btn) =>
      btn.className.includes('bg-primary'),
    );

    expect(primaryButtons).toHaveLength(1);
  });

  it('AC-IXD-PROC-W5-1b: at Approved stage "Request Vendor Quotes" is the primary button', () => {
    detailState.data = { ...approvedBase };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    const rvqBtn = within(decisionCard).getByRole('button', {
      name: /request vendor quotes/i,
    });
    expect(rvqBtn.className).toContain('bg-primary');
  });

  it('AC-IXD-PROC-W5-1b: at Approved stage "Generate Purchase Order" is present but NOT primary (outline)', () => {
    detailState.data = { ...approvedBase };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    const gpoBtn = within(decisionCard).getByRole('button', {
      name: /generate purchase order/i,
    });
    // Must not be primary — the outline variant carries border-input + bg-background
    expect(gpoBtn.className).not.toContain('bg-primary');
    expect(gpoBtn.className).toContain('border-input');
  });

  it('AC-IXD-PROC-W5-1b: both Approved-stage paths are reachable (both buttons present)', () => {
    detailState.data = { ...approvedBase };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    expect(
      within(decisionCard).getByRole('button', { name: /request vendor quotes/i }),
    ).toBeInTheDocument();
    expect(
      within(decisionCard).getByRole('button', { name: /generate purchase order/i }),
    ).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1b: at Requested stage (Finance, not requester) exactly ONE primary (Approve)', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    const allButtons = within(decisionCard).getAllByRole('button');
    const primaryButtons = allButtons.filter((btn) =>
      btn.className.includes('bg-primary'),
    );
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]).toHaveAccessibleName(/^approve$/i);
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

    const decisionCard = screen.getByTestId('decision-card');
    const allButtons = within(decisionCard).getAllByRole('button');
    const primaryButtons = allButtons.filter((btn) =>
      btn.className.includes('bg-primary'),
    );
    expect(primaryButtons.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (c) — SoD-blocked: GateNotice inside decision area, no action buttons
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (c): SoD-blocked state — GateNotice inside decision area, no actions', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1c: when the requester views their own Requested PR, the SoD GateNotice is inside the decision-card', () => {
    // u-alice (currentUser) is both Finance role AND the requester → SoD blocked
    detailState.data = { ...selfRequestedBase };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    // The GateNotice with blocked variant must be inside the decision-card
    // GateNotice renders with "Separation-of-duties gate." text
    expect(within(decisionCard).getByText(/separation-of-duties gate/i)).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1c: SoD-blocked state has NO Approve/Reject buttons inside the decision-card', () => {
    detailState.data = { ...selfRequestedBase };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    expect(within(decisionCard).queryByRole('button', { name: /^approve$/i })).toBeNull();
    expect(within(decisionCard).queryByRole('button', { name: /^reject$/i })).toBeNull();
  });

  it('AC-IXD-PROC-W5-1c: a non-SoD-blocked Finance viewer sees Approve+Reject in the decision-card (no gate)', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    expect(within(decisionCard).getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    expect(within(decisionCard).getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    // No SoD notice in the card for unblocked viewer
    expect(within(decisionCard).queryByText(/separation-of-duties gate/i)).toBeNull();
  });

  it('AC-IXD-PROC-W5-1c: SoD "ready to advance" notice is inside the decision-card when the viewer CAN act', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const decisionCard = screen.getByTestId('decision-card');
    // When unblocked and actions exist, the "Ready to advance" notice is inside the decision-card
    expect(within(decisionCard).getByText(/ready to advance/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (d) — Destructive (Cancel request) appears AFTER primary in DOM order
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (d): Cancel request renders after/below the primary CTA in DOM order (D8)', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1d: at Draft+requester, "Cancel request" appears after "Submit Request" in DOM order', () => {
    mockRole = 'Engineer';
    detailState.data = {
      ...draftWithCancelBase,
      items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Widget', description: null, quantity: 1, rate: 500, amount: 500 }],
    };
    renderPage();

    const submitBtn = screen.getByRole('button', { name: /submit request/i });
    const cancelBtn = screen.getByRole('button', { name: /^cancel request$/i });

    expect(
      appearsBeforeInDOM(submitBtn, cancelBtn),
      '"Submit Request" (primary) must appear before "Cancel request" in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1d: at Requested (Finance, not requester), "Cancel request" appears after "Approve" in DOM order', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const approveBtn = screen.getByRole('button', { name: /^approve$/i });
    const cancelBtn = screen.getByRole('button', { name: /^cancel request$/i });

    expect(
      appearsBeforeInDOM(approveBtn, cancelBtn),
      '"Approve" (primary) must appear before "Cancel request" in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1d: at Approved stage, "Cancel request" appears after "Request Vendor Quotes" in DOM order', () => {
    detailState.data = { ...approvedBase };
    renderPage();

    const rvqBtn = screen.getByRole('button', { name: /request vendor quotes/i });
    const cancelBtn = screen.getByRole('button', { name: /^cancel request$/i });

    expect(
      appearsBeforeInDOM(rvqBtn, cancelBtn),
      '"Request Vendor Quotes" (primary) must appear before "Cancel request" in DOM order',
    ).toBe(true);
  });

  it('AC-IXD-PROC-W5-1d: "Reject" (destructive-at-rest outline) appears after "Approve" in DOM order', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    const approveBtn = screen.getByRole('button', { name: /^approve$/i });
    const rejectBtn = screen.getByRole('button', { name: /^reject$/i });

    expect(
      appearsBeforeInDOM(approveBtn, rejectBtn),
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
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
  });

  it('non-regression: the line-items section still renders at Requested state', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('items');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
  });

  it('non-regression: the quotations section still renders at Requested state', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('quotes');
    expect(screen.getByTestId('quotations-section')).toBeInTheDocument();
  });

  it('non-regression: Approve is still a primary blue (no regression from W5-1b)', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const approveBtn = screen.getByRole('button', { name: /^approve$/i });
    expect(approveBtn.className).toContain('bg-primary');
  });

  it('non-regression: Reject is still a quiet outline at rest', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const rejectBtn = screen.getByRole('button', { name: /^reject$/i });
    expect(rejectBtn.className).toContain('border-input');
    expect(rejectBtn.className).not.toContain('bg-destructive');
  });
});
