import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AC-IXD-PROC-A8 — Admin break-glass HEADER edit while Draft/Rejected.
 * AC-IXD-PROC-B3 — Admin break-glass TRANSITIONS in the FE, SoD preserved.
 *
 * The realRole + currentUser identity are driven by the mocks below; each test
 * re-points them via the mutable `auth` object before rendering.
 */

const auth = {
  currentUserId: 'u-admin',
  realRole: 'Admin' as string,
};

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
    captureVendorInvoice: { mutateAsync: vi.fn(), isPending: false, error: null },
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
  useAuth: () => ({ currentUser: { id: auth.currentUserId, org_id: 'org-1' }, role: auth.realRole }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: auth.realRole, realRole: auth.realRole }),
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
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import ProcurementDetails from '../ProcurementDetails';

const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Draft' as const,
  total_value: 48000,
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  // requester is NOT the signed-in admin (break-glass case)
  requested_by_id: 'u-requester',
  approved_by_id: null,
  vendor_id: 'v-apex',
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: { name: 'Apex Supply' },
  requested_by: { full_name: 'Reggie Requester' },
  approved_by: null,
  items: [{ id: 'li-1', name: 'Desk', quantity: 1, unit_cost: 100 }],
  quotations: [],
  receipts: [],
  invoices: [],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/procurement/proc-001']}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
  auth.currentUserId = 'u-admin';
  auth.realRole = 'Admin';
});

// ─────────────────────────────────────────────────────────────────────────────
// A8 — Admin break-glass header edit while Draft / Rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-IXD-PROC-A8: Admin break-glass header edit', () => {
  it('AC-IXD-PROC-A8: an Admin who is NOT the requester sees Edit-header on a Draft PR', () => {
    auth.realRole = 'Admin';
    auth.currentUserId = 'u-admin';
    detailState.data = { ...base, status: 'Draft' };
    renderPage();
    expect(screen.getByTestId('edit-header')).toBeInTheDocument();
  });

  it('AC-IXD-PROC-A8: an Admin who is NOT the requester sees Edit-header on a Rejected PR', () => {
    auth.realRole = 'Admin';
    auth.currentUserId = 'u-admin';
    detailState.data = { ...base, status: 'Rejected' };
    renderPage();
    expect(screen.getByTestId('edit-header')).toBeInTheDocument();
  });

  it('AC-IXD-PROC-A8: a non-Admin, non-requester (Finance) does NOT see Edit-header on a Draft PR', () => {
    // Record-scoped gate: Edit visible only to requester or Admin while Draft/Rejected.
    // Finance is neither the requester nor an Admin, so Edit must be hidden.
    auth.realRole = 'Finance';
    auth.currentUserId = 'u-finance';
    detailState.data = { ...base, status: 'Draft' };
    renderPage();
    expect(screen.queryByTestId('edit-header')).toBeNull();
  });

  it('AC-IXD-PROC-A8: the requester still sees Edit-header (no regression)', () => {
    auth.realRole = 'Engineer';
    auth.currentUserId = 'u-requester';
    detailState.data = { ...base, status: 'Draft', requested_by_id: 'u-requester' };
    renderPage();
    expect(screen.getByTestId('edit-header')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — Admin break-glass transitions, SoD preserved (characterization)
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-IXD-PROC-B3: Admin break-glass transitions with SoD preserved', () => {
  it('AC-IXD-PROC-B3: Admin who is NOT the requester sees Approve + Reject on a Requested PR', () => {
    auth.realRole = 'Admin';
    auth.currentUserId = 'u-admin';
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-requester' };
    renderPage();
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/ })).toBeInTheDocument();
  });

  it('AC-IXD-PROC-B3: Admin who IS the requester does NOT see Approve/Reject on a Requested PR (SoD-a)', () => {
    auth.realRole = 'Admin';
    auth.currentUserId = 'u-admin';
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-admin' };
    renderPage();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject$/ })).toBeNull();
  });

  it('AC-IXD-PROC-B3: Admin (not the approver) sees Mark as Paid on a Vendor Invoiced PR', () => {
    auth.realRole = 'Admin';
    auth.currentUserId = 'u-admin';
    detailState.data = {
      ...base,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-requester',
      approved_by_id: 'u-someone-else',
      invoices: [
        { id: 'i-1', procurement_id: 'proc-001', vi_number: 'VI-1', status: 'Received', invoice_date: '2026-06-06', org_id: 'org-1', created_at: '2026-06-06T00:00:00Z' },
      ],
    };
    renderPage();
    expect(screen.getByRole('button', { name: /Mark as Paid/i })).toBeInTheDocument();
  });

  it('AC-IXD-PROC-B3: Admin who APPROVED the PR does NOT see Mark as Paid (SoD-b)', () => {
    auth.realRole = 'Admin';
    auth.currentUserId = 'u-admin';
    detailState.data = {
      ...base,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-requester',
      approved_by_id: 'u-admin', // signed-in admin approved → cannot self-pay
      invoices: [
        { id: 'i-1', procurement_id: 'proc-001', vi_number: 'VI-1', status: 'Received', invoice_date: '2026-06-06', org_id: 'org-1', created_at: '2026-06-06T00:00:00Z' },
      ],
    };
    renderPage();
    expect(screen.queryByRole('button', { name: /Mark as Paid/i })).toBeNull();
  });
});
