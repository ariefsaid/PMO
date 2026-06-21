import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AC-IXD-WP-003 + AC-IXD-WP-002 (write-policy, OD-UX-1; plan tasks 9/10):
 *
 *  AC-IXD-WP-003 — a `ConfirmDialog` opens for the CONSEQUENTIAL set
 *    {Approve, Reject, Cancel, Mark-as-Paid} and does NOT open for the ROUTINE
 *    reversible forward steps {Submit Request, Request Vendor Quotes,
 *    Generate Purchase Order, Confirm Receipt, Mark Vendor Invoiced} — those
 *    commit on a single click + a quiet toast.
 *
 *  AC-IXD-WP-002 (component half) — the kept Approve + Mark-as-Paid confirms
 *    RESTATE the amount + project + requester in the dialog body (confirm
 *    against the money — the contract-value SoD confirm is the template).
 */

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
  }),
}));

const docsState = { data: [] as Record<string, unknown>[], isPending: false, isError: false, refetch: vi.fn() };
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

const baseProcurement = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 85000,
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
  requested_by: { full_name: 'Alice Manager' },
  approved_by: null,
  items: [],
  quotations: [],
  receipts: [],
  invoices: [],
};

const renderPage = (id = 'proc-001') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
  detailState.refetch = vi.fn();
  mockTransition.mockClear().mockResolvedValue(undefined);
  toast.mockClear();
  mockEffectiveRole = 'Finance';
});

// ---------------------------------------------------------------------------
// AC-IXD-WP-003 — routine forward steps are SINGLE-CLICK (no confirm)
// ---------------------------------------------------------------------------
describe('AC-IXD-WP-003: routine forward procurement steps are single-click (no confirm)', () => {
  it('AC-IXD-WP-003: Submit Request (Draft→Requested) commits on a single click — no dialog', async () => {
    mockEffectiveRole = 'Engineer';
    // AC-W3-D10: Submit Request is only enabled when ≥1 line item is present.
    detailState.data = {
      ...baseProcurement,
      status: 'Draft',
      requested_by_id: 'u-alice',
      total_value: 500,
      items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-001', name: 'Widget', description: null, quantity: 1, rate: 500, amount: 500 }],
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Requested' })),
    );
  });

  it('AC-IXD-WP-003: Request Vendor Quotes (Approved→Vendor Quoted) commits on a single click — no dialog', async () => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /request vendor quotes/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Vendor Quoted' })),
    );
  });

  it('AC-IXD-WP-003: Generate Purchase Order (Quote Selected→Ordered) commits on a single click — no dialog', async () => {
    detailState.data = { ...baseProcurement, status: 'Quote Selected', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /generate purchase order/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Ordered' })),
    );
  });

  it('AC-IXD-WP-003: Confirm Receipt (Ordered→Received) commits on a single click — no dialog', async () => {
    // Receipt is offered to the requester or a PM (RECEIPT_ROLES); use a PM non-requester.
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...baseProcurement, status: 'Ordered', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /confirm receipt/i }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Received' })),
    );
  });

  it('AC-IXD-WP-003: Mark Vendor Invoiced (Received→Vendor Invoiced) — O3 deliberate change: opens inline capture (no modal confirm), and transition commits when the inline capture is submitted', async () => {
    // O3 (AC-W3-O3): clicking "Mark Vendor Invoiced" now opens an inline capture panel
    // to co-locate invoice details with the transition (deliberate UX change). There is
    // still no ConfirmDialog modal — the inline panel IS the capture step.
    detailState.data = { ...baseProcurement, status: 'Received', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /mark vendor invoiced/i }));

    // No modal dialog — the inline capture panel takes over (no confirm dialog surface).
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // The inline capture is now visible — submit it to commit the transition.
    expect(screen.getByTestId('vi-inline-capture')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));

    // Goal oracle unchanged: transition to Vendor Invoiced fires (no modal was required).
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Vendor Invoiced' })),
    );
  });

  it('AC-IXD-WP-003: a routine single-click forward step fires a quiet success toast', async () => {
    detailState.data = { ...baseProcurement, status: 'Approved', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /request vendor quotes/i }));
    // AC-IXD-PROC-001: the toast names the CANONICAL state ("Vendor Quote") — the
    // same noun the badge shows — not the raw enum value ("Vendor Quoted"). The
    // quiet-success-toast goal-oracle is unchanged; only the canonical label is asserted.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Request updated', expect.stringContaining('Vendor Quote'), 'success'),
    );
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-WP-003 — consequential set STILL confirms before writing
// ---------------------------------------------------------------------------
describe('AC-IXD-WP-003: consequential procurement actions still confirm', () => {
  it('AC-IXD-WP-003: Approve opens a confirm and does NOT write on the first click', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('AC-IXD-WP-003: Reject opens a destructive confirm and does NOT write on the first click', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('AC-IXD-WP-003: Cancel request opens a destructive confirm and does NOT write on the first click', async () => {
    detailState.data = { ...baseProcurement, status: 'Requested', requested_by_id: 'u-alice' };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^cancel request$/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('AC-IXD-WP-003: Mark as Paid opens a confirm and does NOT write on the first click', async () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-someone-else',
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /mark as paid/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-WP-002 (component half) — Approve / Mark-Paid confirms restate the amount
// ---------------------------------------------------------------------------
describe('AC-IXD-WP-002: kept financial confirms restate the amount + project + requester', () => {
  it('AC-IXD-WP-002: the Approve confirm body names the amount, project, and requester', async () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Requested',
      requested_by_id: 'u-other',
      total_value: 85000,
      project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
      requested_by: { full_name: 'Alice Manager' },
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    const dialog = await screen.findByRole('dialog');
    // confirm against the money: amount + project + requester all restated
    expect(dialog).toHaveTextContent('$85,000');
    expect(dialog).toHaveTextContent('HQ Fit-Out');
    expect(dialog).toHaveTextContent('Alice Manager');
  });

  it('AC-IXD-WP-002: the Mark-as-Paid confirm body names the amount, project, and requester', async () => {
    detailState.data = {
      ...baseProcurement,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-other',
      approved_by_id: 'u-someone-else',
      total_value: 85000,
      project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
      requested_by: { full_name: 'Alice Manager' },
    };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /mark as paid/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('$85,000');
    expect(dialog).toHaveTextContent('HQ Fit-Out');
    expect(dialog).toHaveTextContent('Alice Manager');
    // confirming pays it (SoD-b is server-enforced; here the click commits)
    await userEvent.click(within(dialog).getByRole('button', { name: /mark as paid/i }));
    await waitFor(() =>
      expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'Paid' })),
    );
  });
});
