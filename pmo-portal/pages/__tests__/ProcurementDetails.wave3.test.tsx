/**
 * Wave-3 procurement-detail flow correctness tests.
 *
 * AC-W3-N1 — VI form must NOT offer "Paid" as a status option; Mark as Paid
 *             remains the sole authority for the PR→Paid transition.
 * AC-W3-D10 — Draft PR with no line items blocks Submit Request + shows a gate.
 * AC-W3-O3  — "Mark Vendor Invoiced" opens an inline capture that performs the
 *             transition + VI-create together; cancel leaves status unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Shared mutable hook state
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

const mockTransition = vi.fn().mockResolvedValue(undefined);
const mockCreateInvoice = vi.fn().mockResolvedValue({ id: 'i-new', vi_number: 'VI-001' });
const mockCaptureVendorInvoice = vi.fn().mockResolvedValue({ id: 'vi-new', vi_number: 'VI-001' });
const mockCreateReceipt = vi.fn().mockResolvedValue({ id: 'r-new' });
const mockCreateQuotation = vi.fn().mockResolvedValue({ id: 'q-new' });

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
    transition: { mutateAsync: mockTransition, isPending: false, error: null },
    createQuotation: { mutateAsync: mockCreateQuotation, isPending: false, error: null },
    createReceipt: { mutateAsync: mockCreateReceipt, isPending: false, error: null },
    createInvoice: { mutateAsync: mockCreateInvoice, isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: mockCaptureVendorInvoice, isPending: false, error: null },
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
  useAuth: () => ({ currentUser: { id: 'u-finance', org_id: 'org-1' }, role: 'Finance' }),
}));

let mockEffectiveRole = 'Finance';
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
// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel now mounts in ProcurementDetails.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
// N8 (AC-IXD-PROC-W5-2): DecisionSupportPanel also reads committed spend.
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const baseProcurement = {
  id: 'proc-w3',
  code: 'PROC-2026-W3',
  title: 'Network Switches',
  status: 'Draft' as const,
  total_value: 0,
  pr_number: 'PR-2606090001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-eng',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-09T00:00:00Z',
  updated_at: '2026-06-09T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Eng User' },
  approved_by: null,
  items: [],
  quotations: [],
  receipts: [],
  invoices: [],
};

/** A Received PR ready for "Mark Vendor Invoiced" with a different user as approver (not u-finance). */
const receivedProcurement = {
  ...baseProcurement,
  status: 'Received' as const,
  total_value: 50000,
  approved_by_id: 'u-pm',
  approved_by: { full_name: 'PM User' },
  receipts: [
    {
      id: 'r-1',
      procurement_id: 'proc-w3',
      gr_number: 'GR-2606090001',
      status: 'Complete' as const,
      receipt_date: '2026-06-09',
      org_id: 'org-1',
      created_at: '2026-06-09T00:00:00Z',
    },
  ],
};

/** A Vendor Invoiced PR (after transition, for VI form tests). */
const vendorInvoicedProcurement = {
  ...baseProcurement,
  status: 'Vendor Invoiced' as const,
  total_value: 50000,
  approved_by_id: 'u-pm',
  approved_by: { full_name: 'PM User' },
};

const renderPage = (id = 'proc-w3') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// AC-W3-N1 — VI form status options: Received + Scheduled, NOT Paid
// ---------------------------------------------------------------------------
describe('AC-W3-N1: VI form does not offer "Paid" status; Mark as Paid is the sole PR→Paid authority', () => {
  beforeEach(() => {
    mockEffectiveRole = 'Finance';
    mockTransition.mockClear();
    mockCreateInvoice.mockClear();
    toast.mockClear();
  });

  it('AC-W3-N1: the VI capture (now inline on Mark Vendor Invoiced) offers Received and Scheduled but NOT Paid', async () => {
    detailState.data = { ...receivedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    // Open the inline capture by clicking "Mark Vendor Invoiced"
    await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));

    // The inline capture form should be visible
    const viStatusSelect = screen.getByTestId('vi-status-select');
    const options = within(viStatusSelect).getAllByRole('option');
    const optionValues = options.map((o) => (o as HTMLOptionElement).value);

    expect(optionValues).toContain('Received');
    expect(optionValues).toContain('Scheduled');
    // Paid must NOT appear — Mark as Paid is the sole PR→Paid authority
    expect(optionValues).not.toContain('Paid');
  });

  it('AC-W3-N1: "Mark as Paid" action button is still present for Finance on Vendor Invoiced (the sole PR→Paid path)', () => {
    detailState.data = {
      ...vendorInvoicedProcurement,
      approved_by_id: 'u-pm', // not u-finance — no SoD-b block
    };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-W3-D10 — Draft with no line items blocks Submit Request
// ---------------------------------------------------------------------------
describe('AC-W3-D10: Draft PR with zero line items gates Submit Request', () => {
  beforeEach(() => {
    mockEffectiveRole = 'Engineer';
    mockTransition.mockClear();
    toast.mockClear();
  });

  it('AC-W3-D10: a Draft PR with NO line items shows the add-line-items gate message and no enabled Submit Request button', () => {
    detailState.data = { ...baseProcurement, items: [], total_value: 0 };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    // No enabled "Submit Request" button
    const submitBtn = screen.queryByRole('button', { name: /submit request/i });
    // Either not present, or present but disabled
    if (submitBtn) {
      expect(submitBtn).toBeDisabled();
    }

    // Gate message indicating user must add line items
    expect(screen.getByText(/add at least one line item before submitting/i)).toBeInTheDocument();
  });

  it('AC-W3-D10: a Draft PR with ≥1 line item (total > 0) shows an enabled Submit Request', () => {
    detailState.data = {
      ...baseProcurement,
      total_value: 500,
      items: [
        {
          id: 'it1',
          org_id: 'org-1',
          procurement_id: 'proc-w3',
          name: 'Network switch',
          description: null,
          quantity: 5,
          rate: 100,
          amount: 500,
        },
      ],
    };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    // The "Submit Request" action must be enabled (not disabled)
    const submitBtn = screen.getByRole('button', { name: /submit request/i });
    expect(submitBtn).not.toBeDisabled();

    // Gate message must NOT appear
    expect(screen.queryByText(/add at least one line item before submitting/i)).toBeNull();
  });

  it('AC-W3-D10: the gate keys on line-item PRESENCE, not a non-zero total — a single zero-rate line enables Submit', () => {
    // Pins the semantics: a legitimate zero-rate line (amount 0, total_value 0) should NOT be
    // blocked — the gate is `items.length === 0`, not `total_value > 0`.
    detailState.data = {
      ...baseProcurement,
      total_value: 0,
      items: [
        { id: 'it0', org_id: 'org-1', procurement_id: 'proc-w3', name: 'No-charge sample',
          description: null, quantity: 1, rate: 0, amount: 0 },
      ],
    };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();
    expect(screen.getByRole('button', { name: /submit request/i })).not.toBeDisabled();
    expect(screen.queryByText(/add at least one line item before submitting/i)).toBeNull();
  });

  it('AC-W3-D10: the empty-items gate does NOT block non-Draft statuses (e.g. Requested)', () => {
    // A Requested PR with no items (shouldn't happen in practice but must not regress)
    detailState.data = {
      ...baseProcurement,
      status: 'Requested' as const,
      items: [],
      total_value: 0,
    };
    detailState.isPending = false;
    detailState.isError = false;
    mockEffectiveRole = 'Finance';
    renderPage();

    // No "add line items" gate at Requested
    expect(screen.queryByText(/add at least one line item before submitting/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-W3-O3 — "Mark Vendor Invoiced" opens inline capture; submit fires both
//             transition + createInvoice; cancel leaves status unchanged.
// ---------------------------------------------------------------------------
describe('AC-W3-O3: Mark Vendor Invoiced opens inline capture and performs transition + VI-create together', () => {
  beforeEach(() => {
    mockEffectiveRole = 'Finance';
    mockTransition.mockClear().mockResolvedValue(undefined);
    mockCreateInvoice.mockClear().mockResolvedValue({ id: 'i-new', vi_number: 'VI-001' });
    // harden #2: the capture now goes through the ONE atomic RPC (transition + invoice + event).
    mockCaptureVendorInvoice.mockClear().mockResolvedValue({ id: 'vi-new', vi_number: 'VI-001' });
    toast.mockClear();
  });

  it('AC-W3-O3: clicking "Mark Vendor Invoiced" opens the inline capture form (ref + date + status)', async () => {
    detailState.data = { ...receivedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));

    // The inline capture should appear with invoice fields
    expect(screen.getByTestId('vi-inline-capture')).toBeInTheDocument();
    expect(screen.getByTestId('vi-status-select')).toBeInTheDocument();
    expect(screen.getByTestId('vi-date-input')).toBeInTheDocument();
  });

  it('AC-W3-O3: submitting the inline capture fires the atomic capture (transition + VI-create) with the captured values', async () => {
    detailState.data = { ...receivedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));

    // Select a status and set the date in the inline form
    const statusSelect = screen.getByTestId('vi-status-select');
    await userEvent.selectOptions(statusSelect, 'Scheduled');

    // Submit the inline capture
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));

    // harden #2: the transition + VI-create happen atomically through the ONE RPC, carrying the
    // captured status. The two separate FE writes are no longer used.
    await waitFor(() => {
      expect(mockCaptureVendorInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Scheduled' }),
      );
    });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('AC-W3-O3: cancelling the inline capture leaves the status unchanged (no transition, no VI-create)', async () => {
    detailState.data = { ...receivedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));

    expect(screen.getByTestId('vi-inline-capture')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('btn-cancel-vi-capture'));

    // The form should close
    expect(screen.queryByTestId('vi-inline-capture')).not.toBeInTheDocument();

    // Neither mutation should have fired
    expect(mockCaptureVendorInvoice).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('AC-W3-O3: the inline capture appears where "Mark Vendor Invoiced" was (the action panel), not in a separate VI form card', async () => {
    detailState.data = { ...receivedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    renderPage();

    // Before clicking: "Mark Vendor Invoiced" button is in the action bar
    const markBtn = screen.getByRole('button', { name: /mark vendor invoiced/i });
    expect(markBtn).toBeInTheDocument();

    // After clicking: the inline capture replaces the button in the action panel
    await userEvent.click(markBtn);
    expect(screen.queryByRole('button', { name: /mark vendor invoiced/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('vi-inline-capture')).toBeInTheDocument();
  });

  it('AC-W3-O3 (harden #2): a capture failure warns and leaves the panel OPEN for retry — the atomic RPC rolled everything back (no partial state)', async () => {
    detailState.data = { ...receivedProcurement };
    detailState.isPending = false;
    detailState.isError = false;
    // The single atomic RPC fails → both the transition and the invoice are rolled back server-side.
    mockCaptureVendorInvoice.mockClear().mockRejectedValueOnce(
      Object.assign(new Error('invoice insert failed'), { code: '23503' }),
    );
    toast.mockClear();
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));

    // Exactly one atomic call was made; the two legacy writes are never used.
    await waitFor(() => expect(mockCaptureVendorInvoice).toHaveBeenCalledTimes(1));
    expect(mockTransition).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    // Deliberate UX change: the inline panel STAYS OPEN so the user can correct + retry, and a
    // warning toast surfaces. (Previously the panel closed on a partial failure.)
    expect(screen.getByTestId('vi-inline-capture')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'warning');
  });

  it('AC-W3-O3 (review): the after-form is the RECOVERY surface — shown at Vendor Invoiced with NO invoice, hidden once one exists (no redundant second-create)', () => {
    // No invoice yet (e.g. after a partial failure): the "Create Vendor Invoice" recovery form shows.
    detailState.data = { ...vendorInvoicedProcurement, invoices: [] };
    detailState.isPending = false;
    detailState.isError = false;
    const { unmount } = renderPage();
    expect(screen.getByTestId('btn-create-vi')).toBeInTheDocument();
    unmount();

    // An invoice already exists (happy path): the after-form is HIDDEN — no duplicate-create path.
    detailState.data = {
      ...vendorInvoicedProcurement,
      invoices: [
        { id: 'i-1', procurement_id: 'proc-w3', vi_number: 'VI-001', status: 'Scheduled',
          invoice_date: '2026-06-09', org_id: 'org-1', created_at: '2026-06-09T00:00:00Z' },
      ],
    };
    renderPage();
    expect(screen.queryByTestId('btn-create-vi')).toBeNull();
  });
});
