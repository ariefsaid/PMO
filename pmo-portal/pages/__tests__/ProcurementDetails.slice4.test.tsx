/**
 * Slice 4 — Per-stage action zone + capture wiring + edge cases
 *
 * AC-PR-S4-001: Per-stage action verbs appear correctly in the action zone for
 *               each procurement status (the allowedActions/sortActions logic
 *               renders correctly in the new tabbed shell).
 * AC-PR-S4-002: SoD gate messaging per stage (requester self-approve, payer=approver).
 * AC-PR-S4-003: nextExpectedType maps each status to the correct capture pre-select.
 * AC-PR-S4-004 (edge case): PO-less path — Payment capture available with no PO row.
 * AC-PR-S4-005 (edge case): Multiple records per phase — capture stays available
 *               after one GR/Invoice/Payment exists (partial delivery scenario).
 * AC-PR-S4-006 (edge case): Impersonation — capture/advance affordances gate on
 *               the REAL JWT role, not the impersonated role.
 * AC-PR-S4-007 (edge case): Terminal/Rejected — no capture, terminal message shown.
 * AC-PR-S4-008: Confirm-before-write on consequential transitions (Approve/Reject/Cancel/Pay).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mutable hook state
// ---------------------------------------------------------------------------

const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

const mockTransition = vi.fn().mockResolvedValue(undefined);

// Real-role state — mirrors how impersonation works (realRole != effectiveRole)
const roleState = vi.hoisted(() => ({
  realRole: 'Finance' as string,
  effectiveRole: 'Finance' as string,
}));

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

// LedgerFileCell calls useProcurementFiles — stub so no QueryClient needed.
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
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn(), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn(), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
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
  useProcurementDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));

// useAuth currentUser id used for isRequester / isApprover checks.
const authState = vi.hoisted(() => ({ userId: 'u-alice' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' } }),
}));

// ADR-0016: write affordances gate on the REAL JWT role.
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleState.effectiveRole, realRole: roleState.realRole }),
}));

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
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

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  total_value: 50000,
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',   // not the current user (u-alice)
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Other User' },
  approved_by: null,
  items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Desk', description: null, quantity: 2, rate: 100, amount: 200 }],
  quotations: [],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

// Render at the Overview tab (default) so action zone is visible without tab nav
const renderPage = (id = 'proc-001', tab = 'overview') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}/${tab}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  roleState.realRole = 'Finance';
  roleState.effectiveRole = 'Finance';
  authState.userId = 'u-alice';
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
  mockTransition.mockClear();
});

// ---------------------------------------------------------------------------
// AC-PR-S4-001: Per-stage action verbs in the action zone
// ---------------------------------------------------------------------------

describe('AC-PR-S4-001: per-stage action verbs appear in the action zone', () => {
  it('Draft (requester=self): shows Submit Request', () => {
    authState.userId = 'u-other'; // requester is the current user
    detailState.data = { ...BASE, status: 'Draft', requested_by_id: 'u-other', items: BASE.items };
    renderPage();
    expect(screen.getByRole('button', { name: /submit request/i })).toBeInTheDocument();
  });

  it('Requested (PM role, non-requester): shows Approve (primary) and Reject', () => {
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    // u-alice is NOT the requester
    detailState.data = { ...BASE, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
  });

  it('Approved: shows Request Vendor Quotes (primary) and Generate Purchase Order (secondary)', () => {
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    detailState.data = { ...BASE, status: 'Approved' };
    renderPage();
    expect(screen.getByRole('button', { name: /request vendor quotes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate purchase order/i })).toBeInTheDocument();
  });

  it('Vendor Quoted: shows Select Quote (primary)', () => {
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    detailState.data = { ...BASE, status: 'Vendor Quoted' };
    renderPage();
    expect(screen.getByRole('button', { name: /select quote/i })).toBeInTheDocument();
  });

  it('Quote Selected: shows Generate Purchase Order (primary)', () => {
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    detailState.data = { ...BASE, status: 'Quote Selected' };
    renderPage();
    expect(screen.getByRole('button', { name: /generate purchase order/i })).toBeInTheDocument();
  });

  it('Ordered (PM role, non-requester): shows Confirm Receipt (primary)', () => {
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    detailState.data = { ...BASE, status: 'Ordered', po_number: 'PO-001' };
    renderPage();
    expect(screen.getByRole('button', { name: /confirm receipt/i })).toBeInTheDocument();
  });

  it('Received (Finance role): shows Mark Vendor Invoiced (primary)', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Received' };
    renderPage();
    expect(screen.getByRole('button', { name: /mark vendor invoiced/i })).toBeInTheDocument();
  });

  it('Vendor Invoiced (Finance, not-approver): shows Mark as Paid (success)', () => {
    // u-alice (Finance) is NOT the approver (approved_by_id is u-other)
    authState.userId = 'u-alice';
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Vendor Invoiced', approved_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
  });

  it('Paid: NO advance verbs — shows terminal message', () => {
    authState.userId = 'u-alice';
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Paid', approved_by_id: 'u-other' };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
    expect(screen.getByText(/no further lifecycle actions/i)).toBeInTheDocument();
  });

  it('Cancelled: no advance verbs — shows terminal message', () => {
    detailState.data = { ...BASE, status: 'Cancelled' };
    renderPage();
    expect(screen.getByText(/no further lifecycle actions/i)).toBeInTheDocument();
  });

  it('Rejected (requester=self): shows Rework (Back to Draft)', () => {
    authState.userId = 'u-other'; // requester
    detailState.data = { ...BASE, status: 'Rejected', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /rework.*back to draft/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-002: SoD gate messaging
// ---------------------------------------------------------------------------

describe('AC-PR-S4-002: SoD gate messaging shows correctly', () => {
  it('Requested status + requester = self: shows the self-approve blocked notice', () => {
    authState.userId = 'u-alice'; // u-alice IS the requester
    detailState.data = { ...BASE, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    // The GateNotice blocked message appears
    expect(screen.getByText(/the requester cannot self-approve/i)).toBeInTheDocument();
    // No Approve button offered to the requester
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('Vendor Invoiced (Finance=approver): Mark as Paid is hidden (SoD-b)', () => {
    // u-alice is Finance AND the approver of this procurement
    authState.userId = 'u-alice';
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Vendor Invoiced', approved_by_id: 'u-alice' };
    renderPage();
    // SoD-b: the approver cannot also be the payer
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
  });

  it('Admin who is also the approver: Mark as Paid still hidden (OD-PROC-8 — SoD beats break-glass)', () => {
    authState.userId = 'u-alice';
    roleState.realRole = 'Admin';
    roleState.effectiveRole = 'Admin';
    // u-alice (Admin) is also the approver
    detailState.data = { ...BASE, status: 'Vendor Invoiced', approved_by_id: 'u-alice' };
    renderPage();
    // OD-PROC-8: Admin break-glass cannot override SoD-b
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
  });

  it('Ordered (Engineer role, non-requester): shows the receipt gate message, no Confirm Receipt button', () => {
    roleState.realRole = 'Engineer';
    roleState.effectiveRole = 'Engineer';
    // u-alice is NOT the requester
    detailState.data = { ...BASE, status: 'Ordered', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByText(/requester or a Project-Manager must confirm receipt/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm receipt/i })).toBeNull();
  });

  it('Draft + requester=self: shows the self-approve pre-announce (author side)', () => {
    authState.userId = 'u-other'; // requester
    detailState.data = { ...BASE, status: 'Draft', requested_by_id: 'u-other', items: BASE.items };
    renderPage();
    expect(screen.getByTestId('sod-pre-announce')).toBeInTheDocument();
    expect(screen.getByTestId('sod-pre-announce').textContent).toMatch(/you can't approve your own request/i);
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-003: nextExpectedType / LedgerCaptureRow pre-select per status
// (tested via the Documents tab's LedgerCaptureRow; canWrite=true requires Finance role)
// ---------------------------------------------------------------------------

describe('AC-PR-S4-003: LedgerCaptureRow pre-selects the correct next type', () => {
  beforeEach(() => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    authState.userId = 'u-alice';
  });

  // Helper: get the capture-row element and check its text contains the label.
  function assertCaptureRowLabel(label: string) {
    const row = screen.getByTestId('ledger-capture-row');
    expect(row).toBeInTheDocument();
    // The row contains the label in a <span> and in a <button> — check the row itself.
    expect(row.textContent).toContain(label);
  }

  it('Draft: capture row pre-selects Purchase Request', () => {
    detailState.data = { ...BASE, status: 'Draft' };
    renderPage('proc-001', 'documents');
    assertCaptureRowLabel('Purchase Request');
  });

  it('Requested + PR already captured: NO capture row (over-prompt fix — await approval)', () => {
    // The realistic Requested case: a PR record already exists in the ledger
    // (status Submitted). Data-driven gating must NOT re-offer "Capture Purchase
    // Request" — the only valid forward move is the approval decision.
    detailState.data = {
      ...BASE,
      status: 'Requested',
      purchase_requests: [
        { id: 'pr-1', procurement_id: 'proc-001', pr_number: 'PR-2606040001', status: 'Submitted', date: '2026-06-04', org_id: 'org-1', created_at: '2026-06-04T00:00:00Z', reference_number: null, amount: 50000 },
      ],
    };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Requested with NO PR row yet (degenerate): capture row still offers Purchase Request', () => {
    // Without a captured PR the case spine is missing, so the row legitimately
    // offers Purchase Request even at Requested.
    detailState.data = { ...BASE, status: 'Requested', purchase_requests: [] };
    renderPage('proc-001', 'documents');
    assertCaptureRowLabel('Purchase Request');
  });

  it('Approved: capture row pre-selects RFQ', () => {
    detailState.data = { ...BASE, status: 'Approved' };
    renderPage('proc-001', 'documents');
    assertCaptureRowLabel('RFQ');
  });

  it('Vendor Quoted: capture row pre-selects RFQ', () => {
    detailState.data = { ...BASE, status: 'Vendor Quoted' };
    renderPage('proc-001', 'documents');
    assertCaptureRowLabel('RFQ');
  });

  it('Quote Selected: capture row pre-selects Purchase Order', () => {
    detailState.data = { ...BASE, status: 'Quote Selected' };
    renderPage('proc-001', 'documents');
    assertCaptureRowLabel('Purchase Order');
  });

  it('Vendor Invoiced: capture row pre-selects Payment', () => {
    detailState.data = { ...BASE, status: 'Vendor Invoiced' };
    renderPage('proc-001', 'documents');
    assertCaptureRowLabel('Payment');
  });

  it('Paid (terminal): capture row is hidden', () => {
    detailState.data = { ...BASE, status: 'Paid', approved_by_id: 'u-other' };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Cancelled (terminal): capture row is hidden', () => {
    detailState.data = { ...BASE, status: 'Cancelled' };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Rejected (terminal for capture): capture row is hidden', () => {
    // Requester can rework but cannot capture new records while Rejected
    detailState.data = { ...BASE, status: 'Rejected' };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-004 (edge case): PO-less path — Invoice + Payment exist with no PO
// The capture affordance must NOT block or require a PO row.
// ---------------------------------------------------------------------------

describe('AC-PR-S4-004 (edge case): PO-less path', () => {
  it('a Vendor Invoiced case with no PO row still offers the Payment capture row', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    // Direct path: has invoice but no PO
    detailState.data = {
      ...BASE,
      status: 'Vendor Invoiced',
      po_number: null,
      purchase_orders: [],  // explicitly no PO
      invoices: [
        { id: 'vi-1', procurement_id: 'proc-001', vi_number: 'VI-001', status: 'Received', invoice_date: '2026-06-04', org_id: 'org-1', created_at: '2026-06-04T00:00:00Z', po_id: null, reference_number: null, amount: null },
      ],
    };
    renderPage('proc-001', 'documents');
    // The capture row is present and pre-selects Payment
    const captureRow = screen.getByTestId('ledger-capture-row');
    expect(captureRow).toBeInTheDocument();
    expect(captureRow.textContent).toContain('Payment');
  });

  it('Mark as Paid action is available even when no PO exists (non-approver Finance)', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    authState.userId = 'u-alice';
    // No PO, approved by someone else
    detailState.data = {
      ...BASE,
      status: 'Vendor Invoiced',
      po_number: null,
      purchase_orders: [],
      approved_by_id: 'u-other',
      invoices: [
        { id: 'vi-1', procurement_id: 'proc-001', vi_number: 'VI-001', status: 'Received', invoice_date: '2026-06-04', org_id: 'org-1', created_at: '2026-06-04T00:00:00Z', po_id: null, reference_number: null, amount: null },
      ],
    };
    renderPage();
    // The Mark as Paid action is present in the action zone — not blocked by missing PO
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-005 (edge case): Multiple records per phase
// After one GR/Invoice/Payment exists, the capture affordance stays available.
// ---------------------------------------------------------------------------

describe('AC-PR-S4-005 (edge case): multiple records per phase', () => {
  it('M4 (design-review): capture row is HIDDEN at Received (GR already captured; VI is action-zone)', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    // M4 fix: Received → nextExpectedType returns null → ledger capture row hidden.
    // GR/VI are captured via the action-zone inline forms, not the ledger capture row.
    // This prevents the ledger from mis-prompting "Capture Purchase Order" at Received.
    detailState.data = {
      ...BASE,
      status: 'Received',
      invoices: [
        { id: 'vi-1', procurement_id: 'proc-001', vi_number: 'VI-001', status: 'Received', invoice_date: '2026-06-04', org_id: 'org-1', created_at: '2026-06-04T00:00:00Z', po_id: null, reference_number: null, amount: null },
      ],
    };
    renderPage('proc-001', 'documents');
    // The ledger capture row is now hidden at Received (M4 fix — action zone owns this stage)
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Vendor Invoiced + Payment already captured: NO capture row (data-driven "if absent")', () => {
    // IxD Change 2 (deliberate behavior change): the capture offer is now data-
    // driven — "payment IF ABSENT". Once a payment exists in the ledger, the row
    // no longer re-offers it, eliminating the over-prompt. (Domain note: this
    // also removes ledger-row capture of additional progress payments once one
    // payment is recorded — surfaced to the owner as a tradeoff of the "if absent"
    // rule. The action/record flow remains the path for further payments.)
    detailState.data = {
      ...BASE,
      status: 'Vendor Invoiced',
      payments: [
        { id: 'pay-1', procurement_id: 'proc-001', pay_number: 'PAY-001', status: 'Processed', date: '2026-06-05', org_id: 'org-1', created_at: '2026-06-05T00:00:00Z', invoice_id: null, reference_number: null, amount: null },
      ],
    };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Vendor Invoiced with NO payment yet: capture row offers Payment', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Vendor Invoiced', payments: [] };
    renderPage('proc-001', 'documents');
    const captureRow = screen.getByTestId('ledger-capture-row');
    expect(captureRow).toBeInTheDocument();
    expect(captureRow.textContent).toContain('Payment');
  });

  it('ledger shows ALL multiple invoices (both rows visible at once)', () => {
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    // Vendor Invoiced with two invoices (partial invoicing scenario)
    detailState.data = {
      ...BASE,
      status: 'Vendor Invoiced',
      invoices: [
        { id: 'vi-1', procurement_id: 'proc-001', vi_number: 'VI-2026-0001', status: 'Received', invoice_date: '2026-06-04', org_id: 'org-1', created_at: '2026-06-04T00:00:00Z', po_id: null, reference_number: 'INV-001', amount: 20000 },
        { id: 'vi-2', procurement_id: 'proc-001', vi_number: 'VI-2026-0002', status: 'Received', invoice_date: '2026-06-10', org_id: 'org-1', created_at: '2026-06-10T00:00:00Z', po_id: null, reference_number: 'INV-002', amount: 30000 },
      ],
    };
    renderPage('proc-001', 'documents');
    // Both invoice system numbers appear in the ledger (DataTable renders them in table AND card;
    // at least one instance of each must be present).
    expect(screen.getAllByText('VI-2026-0001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VI-2026-0002').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-006 (edge case): Impersonation — affordances gate on REAL JWT role
// ---------------------------------------------------------------------------

describe('AC-PR-S4-006 (edge case): impersonation — gates on real JWT role', () => {
  it('AC-PR-018 AC-PR-S4-006: Engineer impersonating Finance cannot Approve (real role gates, not impersonated)', () => {
    // Real role is Engineer; effectiveRole (display) is Finance. The gate uses realRole.
    roleState.realRole = 'Engineer';
    roleState.effectiveRole = 'Finance'; // impersonating Finance
    authState.userId = 'u-alice';       // not the requester
    detailState.data = { ...BASE, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    // An Engineer real role cannot approve — even if impersonating Finance.
    // The policy.ts can() uses realRole; Engineers cannot transition procurements.
    // The Approve button should NOT appear.
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('AC-PR-018 AC-PR-S4-006: Finance impersonating Engineer: capture row still shows (canWrite gates on REAL role — Finance can write)', () => {
    // Real role = Finance (can create procFile); effectiveRole = Engineer (display-only).
    // The write affordance uses usePermission() → realRole, so the capture row IS shown.
    // This is the ADR-0016 "FE gates on real role" contract — impersonation is view-only.
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Engineer'; // display-only impersonation
    authState.userId = 'u-alice';
    detailState.data = { ...BASE, status: 'Approved' };
    renderPage('proc-001', 'documents');
    // Finance's real role CAN create procFile → capture row appears regardless of impersonation.
    expect(screen.getByTestId('ledger-capture-row')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-007 (edge case): Terminal and Rejected states
// ---------------------------------------------------------------------------

describe('AC-PR-S4-007 (edge case): terminal/rejected states', () => {
  it('Paid: terminal message present, no capture row, no advance buttons', () => {
    authState.userId = 'u-alice';
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Paid', approved_by_id: 'u-other' };
    // Check both the action zone and the documents tab
    renderPage('proc-001', 'overview');
    expect(screen.getByText(/no further lifecycle actions/i)).toBeInTheDocument();
    // No advance buttons at all
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /confirm receipt/i })).toBeNull();
  });

  it('Paid: the Documents tab has no capture row', () => {
    authState.userId = 'u-alice';
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = { ...BASE, status: 'Paid', approved_by_id: 'u-other' };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Cancelled: the Documents tab has no capture row', () => {
    detailState.data = { ...BASE, status: 'Cancelled' };
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('Cancelled: the action zone shows the terminal message', () => {
    detailState.data = { ...BASE, status: 'Cancelled' };
    renderPage('proc-001', 'overview');
    expect(screen.getByText(/no further lifecycle actions/i)).toBeInTheDocument();
  });

  it('Rejected: requester rework path shown; capture row hidden', () => {
    authState.userId = 'u-other'; // the requester
    roleState.realRole = 'Engineer'; // requester's role
    roleState.effectiveRole = 'Engineer';
    detailState.data = { ...BASE, status: 'Rejected', requested_by_id: 'u-other', rejection_notes: 'Out of budget.' };
    renderPage('proc-001', 'overview');
    // Requester sees the Rework action
    expect(screen.getByRole('button', { name: /rework.*back to draft/i })).toBeInTheDocument();
    // Capture is hidden while Rejected (no new records until reworked)
    renderPage('proc-001', 'documents');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-PR-S4-008: Confirm-before-write on consequential transitions
// (Approve / Reject / Cancel / Mark as Paid require a ConfirmDialog)
// ---------------------------------------------------------------------------

describe('AC-PR-S4-008: confirm-before-write on consequential transitions', () => {
  it('Approve opens a ConfirmDialog (not direct commit)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    authState.userId = 'u-alice';
    detailState.data = { ...BASE, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    // A dialog must appear (role=dialog or role=alertdialog)
    const dialog = screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    // Transition must NOT have been called yet
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('Reject opens a ConfirmDialog (destructive)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    roleState.realRole = 'Project Manager';
    roleState.effectiveRole = 'Project Manager';
    authState.userId = 'u-alice';
    detailState.data = { ...BASE, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    const dialog = screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('Cancel Request opens a ConfirmDialog with "Keep request" dismiss label', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    // Requester can cancel at Draft
    authState.userId = 'u-other';
    roleState.realRole = 'Engineer';
    roleState.effectiveRole = 'Engineer';
    detailState.data = { ...BASE, status: 'Draft', requested_by_id: 'u-other', items: BASE.items };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /cancel request/i }));
    const dialog = screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    // The dismiss says "Keep request" (not plain "Cancel") to avoid the 3-Cancel confusion
    expect(screen.getByRole('button', { name: /keep request/i })).toBeInTheDocument();
  });

  it('Mark as Paid opens a ConfirmDialog with money-restate copy', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    authState.userId = 'u-alice';
    roleState.realRole = 'Finance';
    roleState.effectiveRole = 'Finance';
    detailState.data = {
      ...BASE,
      status: 'Vendor Invoiced',
      approved_by_id: 'u-other', // not the payer — SoD OK
      total_value: 50000,
      project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /mark as paid/i }));
    const dialog = screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    // Dialog body restates the money context (confirm against the money — OD-UX-1)
    expect(dialog!.textContent).toMatch(/mark.*paid.*cannot be undone/i);
  });

  it('Submit Request (routine) commits directly — no ConfirmDialog', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    authState.userId = 'u-other'; // the requester
    roleState.realRole = 'Engineer';
    roleState.effectiveRole = 'Engineer';
    mockTransition.mockResolvedValueOnce(undefined);
    detailState.data = { ...BASE, status: 'Draft', requested_by_id: 'u-other', items: BASE.items };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
    // No dialog — direct commit
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mockTransition).toHaveBeenCalledOnce();
  });
});
