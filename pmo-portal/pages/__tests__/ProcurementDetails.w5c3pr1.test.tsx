/**
 * AC-IXD-PROC-W5-C3 — Wave-5 Cluster-3 PR-1: Procurement detail legibility
 *
 * D9: Full-word lifecycle labels on the stepper nodes
 *   - Each node shows the full stage name as visible text (not just a tooltip)
 *   - The mono acronym ref (PR-xxxx, etc.) stays as the ref sub-text
 *   - Each node aria-label carries "FullName: state" for screen readers
 *   - Title attribute on each node carries the full name
 *
 * D17: GR/VI create affordances demoted to quiet links
 *   - At Ordered/Received: "Create Goods Receipt" trigger is a ghost/link style
 *     (NOT a solid primary blue), sits inside the DecisionCard below the primary CTA
 *   - At Vendor Invoiced (recovery): "create supplier invoice" trigger is also ghost/link
 *   - The stage's primary CTA remains the single blue button (One-Blue Rule)
 *   - The separate Card wrappers for GR/VI triggers are removed (the triggers slot
 *     inside the DecisionCard)
 *   - When the GR form is expanded, its submit remains primary (the only blue)
 *   - When the VI form is expanded, its submit remains primary (the only blue)
 *   - The canShowGRForm / canShowVIForm gating logic is UNCHANGED (roles/states)
 *
 * RED → run `npm test -- ProcurementDetails.w5c3pr1` to see failures first.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// OD-TAX-1 (#548): the money forms now PRE-SELECT the org's `default_tax_treatment`, which is a
// live org read (`useOrgTaxDefault` → react-query + AuthContext). Only the READ is stubbed here —
// `useTaxTreatmentPreselect` stays the real implementation, so this suite renders the shipped
// seeding behaviour without needing a QueryClientProvider/AuthProvider it otherwise has no use for.
// The pre-selection rule itself is owned by src/hooks/useOrgTaxDefault.test.tsx.
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Shared mock state
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
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

let mockRole = 'Project Manager';
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
import { headerActions, openMoreActions, recordFromMenu } from '@/pages/__tests__/helpers/procurementHeader';
import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Server Rack Install',
  status: 'Requested' as const,
  total_value: 45000, currency: 'USD',
  pr_number: 'PR-2606100001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-10T00:00:00Z',
  updated_at: '2026-06-10T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Bob Requester' },
  approved_by: null,
  items: [],
  quotations: [],
  receipts: [],
  invoices: [],
  // I1 (design-review): stepper refs now come from record arrays. Base has none.
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

const orderedFixture = {
  ...base,
  status: 'Ordered' as const,
  po_number: 'PO-2606100001',
  approved_by_id: 'u-finance',
  approved_by: { full_name: 'Finance User' },
  requested_by_id: 'u-pm', // PM is requester → canShowGRForm via isRequester
  quotations: [
    {
      id: 'q-1',
      procurement_id: 'proc-001',
      vendor_id: 'v-1',
      total_amount: 43000,
      currency: 'USD',
      vq_number: 'VQ-2606100001',
      is_selected: true,
      reference: 'REF-001',
      received_date: '2026-06-08',
      file_url: null,
      org_id: 'org-1',
      created_at: '2026-06-08T00:00:00Z',
    },
  ],
  receipts: [],
  invoices: [],
};

const vendorInvoicedFixture = {
  ...base,
  status: 'Vendor Invoiced' as const,
  approved_by_id: 'u-approver-other',
  approved_by: { full_name: 'Approver Person' },
  invoices: [], // no invoice yet → canShowVIForm = true for Finance
};

const paidFixture = {
  ...base,
  status: 'Paid' as const,
  approved_by_id: 'u-approver-other',
  receipts: [
    {
      id: 'r-1',
      procurement_id: 'proc-001',
      gr_number: 'GR-2606100001',
      status: 'Complete' as const,
      receipt_date: '2026-06-10',
      org_id: 'org-1',
      created_at: '2026-06-10T00:00:00Z',
    },
  ],
  invoices: [
    {
      id: 'i-1',
      procurement_id: 'proc-001',
      vi_number: 'VI-2606100001',
      status: 'Paid' as const,
      invoice_date: '2026-06-10',
      org_id: 'org-1',
      created_at: '2026-06-10T00:00:00Z',
    },
  ],
};

// Tabbed shell (`/procurement/:id/:tab?`, default Overview). `tab` deep-links the
// panel that owns the asserted content (line items live on the Line-items tab).
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
// The six-node stepper became a four-stage tracker (Request · Order · Receive · Pay) and the GR/VI ghost links
// in the sticky decision card became the header's one primary action plus its "Record another document" menu
// (#1404). The D9 / D17 goals — full-word labels, no competing blue, gating unchanged — are asserted below
// against that structure.
// ---------------------------------------------------------------------------
const trackerStages = () => {
  const tracker = screen.getByTestId('procurement-stage-tracker');
  return within(tracker).getAllByRole('listitem');
};
const stageLabels = () => trackerStages().map((li) => li.querySelector('span')?.textContent ?? '');
const stageItem = (label: string) => trackerStages().find((li) => li.querySelector('span')?.textContent === label)!;

// ---------------------------------------------------------------------------
// D9 — Full-word lifecycle labels (AC-IXD-PROC-W5-C3-D9)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3-D9: tracker stages show full-word names', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('D9-1: the "Request" stage label is visible as text (not just a tooltip)', () => {
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    expect(within(screen.getByTestId('procurement-stage-tracker')).getByText('Request')).toBeInTheDocument();
  });

  it('D9-3: the "Order" stage label is visible as text', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    expect(stageLabels()).toContain('Order');
  });

  it('D9-4: the "Receive" stage label is visible as text', () => {
    detailState.data = { ...base, status: 'Received', receipts: [] };
    renderPage();
    expect(stageLabels()).toContain('Receive');
  });

  it('D9-5: the "Pay" stage label is visible as text while a vendor invoice is awaiting payment', () => {
    detailState.data = { ...vendorInvoicedFixture, invoices: [] };
    renderPage();
    expect(stageLabels()).toContain('Pay');
    expect(stageItem('Pay')).toHaveAttribute('aria-current', 'step');
  });

  it('D9-6: the "Pay" stage label is visible as text on a Paid purchase', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    expect(stageLabels()).toContain('Pay');
  });

  it('D9-7: the tracker is a labelled group and its stages are full words, not acronyms', () => {
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    expect(screen.getByTestId('procurement-stage-tracker')).toHaveAccessibleName(/procurement stages/i);
    // The first stage (current for Requested) is announced as the current step
    expect(stageItem('Request')).toHaveAttribute('aria-current', 'step');
    stageLabels().forEach((label) => expect(label).not.toMatch(/^(PR|VQ|PO|GR|VI)$/));
  });

  it('D9-8: approval is a gate — an Approved PR is still in the Request stage, with NO standalone "Approved" stage', () => {
    // Owner directive 2026-06-21: approval is a gate, not a stage; the next action takes Approve's place.
    detailState.data = { ...base, status: 'Approved', approved_by_id: 'u-fin' };
    renderPage();
    expect(stageLabels()).not.toContain('Approved');
    expect(stageItem('Request')).toHaveAttribute('aria-current', 'step');
    expect(headerActions().queryByRole('button', { name: /^approve$/i })).toBeNull();
  });

  it('D9-9: the PR ref is counted under the Request stage only when a PR record exists, and shows in the timeline (I1)', () => {
    // I1 (design-review): derived from the actual purchase_request record, not the pr_number header column.
    detailState.data = {
      ...base,
      status: 'Requested',
      pr_number: 'PR-2606100001',
      purchase_requests: [
        {
          id: 'pr-rec-1',
          pr_number: 'PR-2606100001',
          status: 'Submitted',
          date: '2026-06-10',
          reference_number: null,
          amount: 45000,
          currency: 'USD',
          procurement_id: 'proc-001',
          org_id: 'org-1',
          created_at: '2026-06-10T00:00:00Z',
        },
      ],
    };
    renderPage();
    expect(stageItem('Request')).toHaveTextContent(/1 purchase request/i);
    expect(screen.getAllByText('PR-2606100001').length).toBeGreaterThanOrEqual(1);
  });

  it('D9-10: every tracker stage label is a full word, and the Paid purchase ends on Pay', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    // The tracker always lists the four stages; a purchase that skipped one reads "Not recorded" (ADR-0093).
    expect(stageLabels()).toEqual(['Request', 'Order', 'Receive', 'Pay']);
    expect(stageLabels()[stageLabels().length - 1]).toBe('Pay');
  });
});

// ---------------------------------------------------------------------------
// D17 — GR/VI affordances stay quiet (AC-IXD-PROC-W5-C3-D17)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3-D17: receipt / vendor-invoice recording stays quiet, never a competing blue', () => {
  beforeEach(() => {
    mockRole = 'Project Manager';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('D17-1: at Ordered stage, "Record another document" is NOT a primary (solid blue) button', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const trigger = headerActions().getByRole('button', { name: 'Record another document' });
    expect(trigger.className).not.toContain('bg-primary');
  });

  it('D17-3: at Ordered stage, the primary CTA ("Record receipt") is the ONLY solid-blue header button', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const primaryButtons = headerActions().getAllByRole('button').filter((btn) => btn.className.includes('bg-primary'));
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]).toHaveAccessibleName(/record receipt/i);
  });

  it('D17-4: the receipt option in the document menu is a quiet menu item (no solid fill)', async () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    await userEvent.click(headerActions().getByRole('button', { name: 'Record another document' }));
    const item = headerActions().getByRole('menuitem', { name: 'Receipt' });
    expect(item.className).not.toContain('bg-primary');
    expect(item.className).not.toContain('bg-success');
    expect(item.className).not.toContain('bg-destructive');
  });

  it('D17-5: after opening the receipt form, its submit button IS the only primary blue', async () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    await userEvent.click(headerActions().getByRole('button', { name: 'Record receipt' }));
    // Now the form is open
    const form = screen.getByTestId('form-create-gr');
    const saveBtn = within(form).getByTestId('btn-save-gr');
    // The save button should be primary or success (it's the only action when form is open)
    const isBlueAction = saveBtn.className.includes('bg-primary') || saveBtn.className.includes('bg-success');
    expect(isBlueAction).toBe(true);
  });

  it('D17-6: at Vendor Invoiced (recovery), the supplier-invoice option is a quiet menu item, not a primary', async () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture };
    renderPage();
    await userEvent.click(headerActions().getByRole('button', { name: 'Record another document' }));
    const item = headerActions().getByRole('menuitem', { name: 'Supplier invoice' });
    expect(item.className).not.toContain('bg-primary');
  });

  it('D17-8: after opening the supplier-invoice form, its submit button IS a blue action', async () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture };
    renderPage();
    await recordFromMenu('Supplier invoice');
    const form = screen.getByTestId('form-create-vi');
    const saveBtn = within(form).getByTestId('btn-save-vi');
    const isBlueAction = saveBtn.className.includes('bg-primary') || saveBtn.className.includes('bg-success');
    expect(isBlueAction).toBe(true);
  });

  it('D17-9: canShowGRForm gating is UNCHANGED — PM (as requester) is offered Record receipt at Ordered', () => {
    mockRole = 'Project Manager';
    detailState.data = { ...orderedFixture, requested_by_id: 'u-pm' }; // PM is requester
    renderPage();
    expect(headerActions().getByRole('button', { name: 'Record receipt' })).toBeInTheDocument();
  });

  it('D17-10: canShowVIForm gating is UNCHANGED — Finance can record a supplier invoice at Vendor Invoiced with no invoice', async () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture, invoices: [] };
    renderPage();
    await userEvent.click(headerActions().getByRole('button', { name: 'Record another document' }));
    expect(headerActions().getByRole('menuitem', { name: 'Supplier invoice' })).toBeInTheDocument();
  });

  it('D17-11: the receipt record action disappears at Paid (stage-passed)', () => {
    mockRole = 'Project Manager';
    detailState.data = { ...paidFixture };
    renderPage();
    expect(screen.queryByTestId('btn-create-gr')).toBeNull();
    expect(screen.queryByRole('button', { name: /record receipt/i })).toBeNull();
  });

  it('D17-13: Engineer (non-receipt-role, not requester) is NOT offered Record receipt (gating unchanged)', () => {
    mockRole = 'Engineer';
    // Engineer is NOT the requester (u-other) → no receipt authority
    detailState.data = { ...orderedFixture, requested_by_id: 'u-other' };
    renderPage();
    expect(screen.queryByRole('button', { name: /record receipt/i })).toBeNull();
  });

  // D17-2 / D17-7 (the trigger sits INSIDE the decision-card) and D17-12 (the VI trigger vanishes once an
  // invoice exists) pinned the removed decision card and the single-bill rule; recording several supplier
  // bills per case is deliberate now (#1404), and the "invoice present → header moves on to payment" half is
  // asserted in ProcurementDetails.wave3.test.tsx.
});

// ---------------------------------------------------------------------------
// Non-regression: existing action-area behaviors must not regress
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3 non-regression: existing action-area behaviors unchanged', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('non-regression: Approve is still a primary blue at Requested stage', () => {
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

  it('non-regression: Paid state has no action buttons', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    expect(screen.queryByRole('button', { name: /record payment/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('ADR-0093: for a Requested purchase the tracker marks Request current and the later stages "Not recorded"', () => {
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    expect(stageItem('Request')).toHaveAttribute('aria-current', 'step');
    for (const later of ['Order', 'Receive', 'Pay']) {
      expect(stageItem(later)).toHaveTextContent(/not recorded/i);
      expect(stageItem(later)).not.toHaveAttribute('aria-current');
    }
  });
  // "AC-S20-001: the line-items evidence precedes the decision area in DOM order" is dropped here: the
  // restructure puts the one action in the header ahead of the evidence by design (see w5pr1 for the rule that
  // still holds — policy context follows the financial evidence).
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
