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
 *   - At Vendor Invoiced (recovery): "Create Vendor Invoice" trigger is also ghost/link
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
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

let mockRole = 'Project Manager';
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
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
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
  title: 'Server Rack Install',
  status: 'Requested' as const,
  total_value: 45000,
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
// D9 — Full-word lifecycle labels (AC-IXD-PROC-W5-C3-D9)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3-D9: stepper nodes show full-word stage names', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('D9-1: the "Purchase Request" node label is visible as text (not just a tooltip)', () => {
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    // The full-word text must be visible in the DOM
    expect(within(stepper).getByText('Purchase Request')).toBeInTheDocument();
  });

  it('D9-2: the "Vendor Quote" node label is visible as text', () => {
    detailState.data = { ...base, status: 'Vendor Quoted' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    const texts = items.map((li) => li.textContent ?? '');
    expect(texts.some((t) => t.includes('Vendor Quote'))).toBe(true);
  });

  it('D9-3: the "Purchase Order" node label is visible as text', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    const texts = items.map((li) => li.textContent ?? '');
    expect(texts.some((t) => t.includes('Purchase Order'))).toBe(true);
  });

  it('D9-4: the "Goods Receipt" node label is visible as text', () => {
    detailState.data = { ...base, status: 'Received', receipts: [] };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    const texts = items.map((li) => li.textContent ?? '');
    expect(texts.some((t) => t.includes('Goods Receipt'))).toBe(true);
  });

  it('D9-5: the "Vendor Invoice" node label is visible as text', () => {
    detailState.data = { ...vendorInvoicedFixture, invoices: [] };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    const texts = items.map((li) => li.textContent ?? '');
    expect(texts.some((t) => t.includes('Vendor Invoice'))).toBe(true);
  });

  it('D9-6: the "Payment" (Paid) node label is visible as text', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    const texts = items.map((li) => li.textContent ?? '');
    expect(texts.some((t) => t.includes('Payment'))).toBe(true);
  });

  it('D9-7: each stepper node aria-label carries the full stage name (not just the acronym)', () => {
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    // Every aria-label should start with a meaningful word (not "PR", "VQ", "PO", etc.)
    const ariaLabels = items.map((el) => el.getAttribute('aria-label') ?? '');
    // The first node (current for Requested) should start with "Purchase Request"
    expect(ariaLabels[0]).toMatch(/^Purchase Request/i);
  });

  it('D9-8: approval is a gate — an Approved PR advances PR→done + Vendor Quote→current, with NO standalone "Approved" node', () => {
    // Owner directive 2026-06-21: approval is a gate, not a stage. Approving moves
    // the bar to the Vendor-Quote node (the next action); there is no Approved node.
    detailState.data = { ...base, status: 'Approved', approved_by_id: 'u-fin' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    const ariaLabels = items.map((el) => el.getAttribute('aria-label') ?? '');
    // No node is labelled "Approved" — it is not a stage.
    expect(ariaLabels.some((l) => l.startsWith('Approved:'))).toBe(false);
    // The PR node is done (the bar advanced on approval) …
    expect(ariaLabels[0]).toBe('Purchase Request: done');
    // … and the Vendor-Quote node is the current step (the next action).
    expect(ariaLabels[1]).toBe('Vendor Quote: current');
  });

  it('D9-9: the mono pr_number ref renders under the Purchase Request node when a PR record exists (I1)', () => {
    // I1 (design-review): the stepper now derives the PR ref from the actual
    // purchase_request record, not the denormalized pr_number header column.
    // A PR# only appears in the stepper when a purchase_request record exists.
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
          procurement_id: 'proc-001',
          org_id: 'org-1',
          created_at: '2026-06-10T00:00:00Z',
        },
      ],
    };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    expect(within(stepper).getByText('PR-2606100001')).toBeInTheDocument();
  });

  it('D9-10: the stepper contains all six node labels (all full-word)', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    // Six stages: PR · VQ · PO · GR · VI · Paid (approval is a gate, not a node)
    expect(items).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// D17 — GR/VI affordances demoted to quiet links (AC-IXD-PROC-W5-C3-D17)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3-D17: GR/VI create triggers are quiet links, not competing blues', () => {
  beforeEach(() => {
    mockRole = 'Project Manager';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('D17-1: at Ordered stage, the GR create trigger is NOT a primary (solid blue) button', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    // The trigger must exist (canShowGRForm is true for PM as requester)
    const grTrigger = screen.getByTestId('btn-create-gr');
    // It must NOT have the primary fill class at rest
    expect(grTrigger.className).not.toContain('bg-primary');
  });

  it('D17-2: at Ordered stage, the GR trigger sits inside the decision-card (not a separate card)', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const decisionCard = screen.getByTestId('decision-card');
    const grTrigger = within(decisionCard).getByTestId('btn-create-gr');
    expect(grTrigger).toBeInTheDocument();
  });

  it('D17-3: at Ordered stage, the primary CTA ("Confirm Receipt") is the ONLY solid-blue button', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const decisionCard = screen.getByTestId('decision-card');
    const allButtons = within(decisionCard).getAllByRole('button');
    const primaryButtons = allButtons.filter((btn) => btn.className.includes('bg-primary'));
    // Exactly one primary (Confirm Receipt)
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]).toHaveAccessibleName(/confirm receipt/i);
  });

  it('D17-4: the GR trigger uses ghost or link styling (transparent bg, foreground text)', () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const grTrigger = screen.getByTestId('btn-create-gr');
    // Ghost variant: no solid fill, has transparent or ghost styling
    // The button must not have bg-primary, bg-success, bg-destructive
    expect(grTrigger.className).not.toContain('bg-primary');
    expect(grTrigger.className).not.toContain('bg-success');
    expect(grTrigger.className).not.toContain('bg-destructive');
  });

  it('D17-5: after expanding the GR form, its submit button IS the only primary blue', async () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const grTrigger = screen.getByTestId('btn-create-gr');
    await userEvent.click(grTrigger);
    // Now the form is open
    const form = screen.getByTestId('form-create-gr');
    const saveBtn = within(form).getByTestId('btn-save-gr');
    // The save button should be primary or success (it's the only action when form is open)
    const isBlueAction = saveBtn.className.includes('bg-primary') || saveBtn.className.includes('bg-success');
    expect(isBlueAction).toBe(true);
  });

  it('D17-6: at Vendor Invoiced (recovery), the VI create trigger is NOT a primary button', () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture };
    renderPage();
    const viTrigger = screen.getByTestId('btn-create-vi');
    expect(viTrigger.className).not.toContain('bg-primary');
  });

  it('D17-7: at Vendor Invoiced (recovery), the VI trigger is inside the decision-card', () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture };
    renderPage();
    const decisionCard = screen.getByTestId('decision-card');
    const viTrigger = within(decisionCard).getByTestId('btn-create-vi');
    expect(viTrigger).toBeInTheDocument();
  });

  it('D17-8: after expanding the VI form, its submit button IS a blue action', async () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture };
    renderPage();
    const viTrigger = screen.getByTestId('btn-create-vi');
    await userEvent.click(viTrigger);
    const form = screen.getByTestId('form-create-vi');
    const saveBtn = within(form).getByTestId('btn-save-vi');
    const isBlueAction = saveBtn.className.includes('bg-primary') || saveBtn.className.includes('bg-success');
    expect(isBlueAction).toBe(true);
  });

  it('D17-9: canShowGRForm gating is UNCHANGED — PM (as requester) can see the GR trigger at Ordered', () => {
    mockRole = 'Project Manager';
    detailState.data = { ...orderedFixture, requested_by_id: 'u-pm' }; // PM is requester
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('D17-10: canShowVIForm gating is UNCHANGED — Finance sees VI trigger at Vendor Invoiced with no invoice', () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture, invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-vi')).toBeInTheDocument();
  });

  it('D17-11: GR trigger disappears at Paid (stage-passed, gating unchanged)', () => {
    mockRole = 'Project Manager';
    detailState.data = { ...paidFixture };
    renderPage();
    expect(screen.queryByTestId('btn-create-gr')).toBeNull();
  });

  it('D17-12: VI trigger disappears when an invoice already exists (canShowVIForm = false)', () => {
    mockRole = 'Finance';
    detailState.data = {
      ...vendorInvoicedFixture,
      invoices: [
        {
          id: 'i-1',
          procurement_id: 'proc-001',
          vi_number: 'VI-001',
          status: 'Received',
          invoice_date: '2026-06-10',
          org_id: 'org-1',
          created_at: '2026-06-10T00:00:00Z',
        },
      ],
    };
    renderPage();
    expect(screen.queryByTestId('btn-create-vi')).toBeNull();
  });

  it('D17-13: Engineer (non-receipt-role, not requester) does NOT see the GR trigger (gating unchanged)', () => {
    mockRole = 'Engineer';
    // Engineer is NOT the requester (u-other) → canShowGRForm = false
    detailState.data = { ...orderedFixture, requested_by_id: 'u-other' };
    renderPage();
    expect(screen.queryByTestId('btn-create-gr')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Non-regression: existing DecisionCard behaviors must not regress
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3 non-regression: existing DecisionCard behaviors unchanged', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('non-regression: Approve is still a primary blue at Requested stage', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const approveBtn = screen.getByRole('button', { name: /^approve$/i });
    expect(approveBtn.className).toContain('bg-primary');
  });

  it('non-regression: Reject is still a quiet outline at rest', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    const rejectBtn = screen.getByRole('button', { name: /^reject$/i });
    expect(rejectBtn.className).not.toContain('bg-destructive');
    expect(rejectBtn.className).toContain('border-input');
  });

  it('IxD Change 1: the decision strip precedes the line-items evidence in DOM order (above the tabs)', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    // Owner IxD reversal: the decision strip is now a compact, non-sticky strip placed
    // directly under the stepper and ABOVE the tabs, so it precedes the active tab's
    // evidence in DOM order.
    renderPage('items');
    const decisionCard = screen.getByTestId('decision-card');
    const lineItems = screen.getByTestId('line-items-section');
    const position = decisionCard.compareDocumentPosition(lineItems);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('non-regression: Paid state has no action buttons', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });

  it('non-regression: stepper still has 6 nodes regardless of status', () => {
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    const stepper = screen.getByRole('list', { name: /procurement lifecycle/i });
    const items = within(stepper).getAllByRole('listitem');
    expect(items).toHaveLength(6);
  });
});
