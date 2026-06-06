import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mutable hook state (mutable so each test can set it via beforeEach)
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
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

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
}));

// Default role — overridden in specific tests
let mockEffectiveRole = 'Finance';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole }),
}));

// Shell + toast: the IA-3 detail page lives in the workspace shell and emits a
// success toast on transition. Mock them so the page renders without providers.
const openModule = vi.fn();
const openRecord = vi.fn();
const toast = vi.fn();
vi.mock('@/src/components/shell', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useWorkspaceTabs: () => ({ openModule, openRecord, setDirty: vi.fn() }) };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }) };
});

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
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Alice Manager' },
  approved_by: null,
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
    detailState.refetch = vi.fn();
    mockEffectiveRole = 'Finance';
  });

  it('AC-804: renders procurement-loading skeleton while pending', () => {
    detailState.isPending = true;
    renderPage();
    expect(screen.getByTestId('procurement-loading')).toBeInTheDocument();
  });

  it('AC-804: renders procurement-empty when query resolves with no data', () => {
    detailState.isPending = false;
    detailState.data = undefined;
    renderPage();
    expect(screen.getByTestId('procurement-empty')).toBeInTheDocument();
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

  it('AC-805: clicking Approve calls transition mutation with Approved', async () => {
    // Finance user, not the requester → allowed
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Approved' })
    ));
  });

  it('AC-805: clicking Submit calls transition mutation with Requested', async () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Draft' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));
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

  it('AC-805: entering notes + Approve calls transition mutation with the notes argument', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.type(screen.getByTestId('procurement-notes-input'), 'Within budget — approved.');
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'Approved', notes: 'Within budget — approved.' })
      )
    );
  });

  it('AC-805: entering notes + Reject calls transition mutation with the notes argument', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.type(screen.getByTestId('procurement-notes-input'), 'Over budget.');
    await userEvent.click(screen.getByRole('button', { name: /reject/i }));
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
    expect(screen.getByText('$50,000')).toBeInTheDocument();
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

  it('Vendor Invoiced status shows Mark as Paid for Finance', () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other' };
    renderPage();
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
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

  it('AC-806: shows RPC error message when transition mutation fails', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    mockTransition.mockRejectedValueOnce(new Error('not authorized (42501)'));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument()
    );
    mockTransition.mockResolvedValue(undefined);
  });
});

// ---------------------------------------------------------------------------
// D3 — GR creation panel (AC-816 UI support)
// ---------------------------------------------------------------------------
describe('GR creation panel (D3, AC-816 UI support)', () => {
  beforeEach(() => {
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
    mockCreateReceipt.mockClear();
    mockCreateReceipt.mockResolvedValue({ id: 'r-new' });
  });

  it('shows Create Goods Receipt button for Finance on Received status', () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('shows Create Goods Receipt button for Finance on Ordered status', () => {
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('does NOT show Create GR button for Engineer', () => {
    mockEffectiveRole = 'Engineer';
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
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

  it('submitting GR form calls createReceipt mutation', async () => {
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-gr'));
    await userEvent.click(screen.getByTestId('btn-save-gr'));
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

  it('submitting VI form calls createInvoice mutation', async () => {
    detailState.data = { ...baseProcurement, status: 'Vendor Invoiced', requested_by_id: 'u-other', receipts: [], invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    await userEvent.click(screen.getByTestId('btn-save-vi'));
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
