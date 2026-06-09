import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: mockCreateQuotation, isPending: false, error: null },
    createReceipt: { mutateAsync: mockCreateReceipt, isPending: false, error: null },
    createInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
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
vi.mock('react-router-dom', async (orig) => {
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
};

// A PR right after the user selected a quote: status 'Quote Selected', no PO yet,
// the chosen quotation flagged is_selected + the header total/vendor synced by the
// select-quote RPC (PROC-004 re-review fixture).
const quoteSelectedProcurement = {
  ...baseProcurement,
  status: 'Quote Selected' as const,
  total_value: 148000,
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
const renderPage = (id = 'proc-001') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
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

  it('AC-NAV-007: "Back to Procurement" navigates to the Procurement module index (no tab)', async () => {
    navigate.mockClear();
    detailState.isPending = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Back to Procurement/i }));
    expect(navigate).toHaveBeenCalledWith('/procurement');
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

  it('H2: the success render drops the redundant in-page Back bar (top-bar crumb owns wayfinding)', () => {
    renderPage();
    // the record loaded — and there is NO in-page "Back to Procurement" bar
    expect(screen.getByRole('heading', { name: /Workstations for HQ/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to Procurement/i })).toBeNull();
  });

  it('E4: the success render has no disabled "Audit trail" stub action', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /Audit trail/i })).toBeNull();
  });

  it('G5: absent stat values read "Pending" / "None yet", never an em-dash', () => {
    renderPage();
    // baseProcurement: no selected quote + no PO → both "Pending"; no receipts → "None yet"
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2); // Selected quote + PO committed
    expect(screen.getByText('None yet')).toBeInTheDocument(); // Goods received
    // the stat-tile area must carry no bare em-dash placeholder
    expect(screen.getByText('Selected quote').closest('div')?.textContent).not.toContain('—');
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

  it('PROC-004: the selected quotation row carries the "Selected" pill', () => {
    renderPage();
    const section = screen.getByTestId('quotations-section');
    // The chosen $148,000 (VQ-2602050001) row shows "Selected"; the $152,000 one does not.
    expect(within(section).getByText('Selected')).toBeInTheDocument();
    const selectedRow = within(section).getByText('VQ-2602050001').closest('div')!;
    expect(within(selectedRow).getByText('Selected')).toBeInTheDocument();
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

  it('AC-805: no Approve/Reject for Draft status (not a legal transition from Draft)', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...baseProcurement, status: 'Draft' };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('AC-805: Submit (Draft → Requested) offered to Engineer', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Draft' };
    renderPage();
    expect(screen.getByRole('button', { name: /submit request/i })).toBeInTheDocument();
  });

  it('AC-805: Paid status shows no transition actions (terminal)', () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...paidProcurement };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
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

  it('AC-805 / AC-IXD-WP-003: clicking Submit (a routine forward step) fires the transition on a SINGLE click — no confirm (OD-UX-1)', async () => {
    mockEffectiveRole = 'Engineer';
    // AC-W3-D10: Submit is only enabled when ≥1 line item exists; give the fixture an item.
    detailState.data = {
      ...baseProcurement,
      status: 'Draft',
      total_value: 500,
      items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Widget', description: null, quantity: 1, rate: 500, amount: 500 }],
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
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

  it('renders PR number from procurement header', () => {
    detailState.data = { ...baseProcurement, status: 'Requested', pr_number: 'PR-2606040001' };
    renderPage();
    // PR# now appears in both the lifecycle stepper node and the doc-trail row.
    expect(screen.getAllByText('PR-2606040001').length).toBeGreaterThanOrEqual(1);
  });

  it('renders VQ number, PO number, GR number and status from Ordered procurement', () => {
    detailState.data = orderedProcurement;
    renderPage();
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
    detailState.data = { ...baseProcurement, total_value: 50000 };
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
    expect(screen.getByRole('button', { name: /mark vendor invoiced/i })).toBeInTheDocument();
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

  it('P2: a destructive action (Cancel request) opens an alertdialog; only confirm fires the transition', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    // requester (u-alice) may cancel a Requested PR (canCancel early). The page
    // terminal action reads "Cancel request" (double-negative cleanup, polish #2).
    await userEvent.click(screen.getByRole('button', { name: /^Cancel request$/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
    // commit button reads "Cancel request" (disambiguated from the dialog's own dismiss)
    await confirmInDialog(/cancel request/i);
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
        expect.stringContaining('permission denied'),
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
    mockEffectiveRole = 'Finance';
    mockCreateInvoice.mockClear();
    mockCreateInvoice.mockResolvedValue({ id: 'i-new' });
  });

  it('shows Create Vendor Invoice button for Finance on Vendor Invoiced status', () => {
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
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    await confirmInDialog(/save vi/i);
    await waitFor(() =>
      expect(mockCreateInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Received' })
      )
    );
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
    renderPage();
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
    expect(screen.getByTestId('line-item-add-row')).toBeInTheDocument();
    expect(screen.getByText('Welding wire')).toBeInTheDocument();
  });

  it('AC-PROC-003: line items are READ-ONLY once the PR leaves Draft (no add-row)', () => {
    detailState.data = { ...draftByAlice, status: 'Approved' as const };
    renderPage();
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
    expect(screen.queryByTestId('line-item-add-row')).toBeNull();
  });

  it('AC-PROC-002: the Draft-header edit affordance shows for the requester while Draft', () => {
    renderPage();
    expect(screen.getByTestId('edit-header')).toBeInTheDocument();
  });

  it('AC-PROC-002: header-edit is HIDDEN for a non-requester', () => {
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
          total_amount: 2944, vq_number: 'VQ-2', is_selected: false, reference: null,
          received_date: '2026-06-01', file_url: null,
        },
      ],
    };
    renderPage();
    expect(screen.getByRole('button', { name: /select quote vq-2/i })).toBeInTheDocument();
  });

  it('AC-PROC-005: the Documents section renders (over procurement_documents) with an Add affordance for a manager', () => {
    renderPage();
    expect(screen.getByTestId('documents-section')).toBeInTheDocument();
    expect(screen.getByTestId('add-document')).toBeInTheDocument();
  });

  it('AC-PROC-005: Documents Add affordance is HIDDEN for an Engineer (no procDoc create)', () => {
    mockEffectiveRole = 'Engineer';
    // An Engineer requester still sees their own line items (Draft) but cannot manage documents.
    renderPage();
    expect(screen.getByTestId('documents-section')).toBeInTheDocument();
    expect(screen.queryByTestId('add-document')).toBeNull();
  });

  it('AC-PROC-003: an Engineer requester CAN edit their own Draft line items', () => {
    mockEffectiveRole = 'Engineer';
    renderPage();
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

  // Polish #2 — the three "Cancel"s disambiguate: page action = "Cancel request",
  // and the confirm dialog's dismiss = "Keep request" (not "Cancel").
  it('polish#2: the PR cancel confirm dismiss reads "Keep request", not "Cancel"', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel request$/i }));
    const dialog = await screen.findByRole('alertdialog');
    // dismiss is the non-destructive button: "Keep request"
    expect(within(dialog).getByRole('button', { name: /^keep request$/i })).toBeInTheDocument();
    // the dialog must NOT carry a bare "Cancel" dismiss (the double-negative tell)
    expect(within(dialog).queryByRole('button', { name: /^cancel$/i })).toBeNull();
  });

  it('polish#2: "Keep request" dismisses the dialog WITHOUT firing the transition', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel request$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^keep request$/i }));
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
