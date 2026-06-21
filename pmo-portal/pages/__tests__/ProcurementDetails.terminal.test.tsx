import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * AC-IXD-PROC-005 — at the terminal Paid state there are no persistent
 * "Create Goods Receipt" / "Create Vendor Invoice" primary buttons (their stages
 * have passed); any GR/VI already created shows as a quiet read-only summary
 * (IxD #14 carry-in / SP-3). The GR form is gated to Ordered | Received, the VI
 * form to Vendor Invoiced only.
 */

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
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Finance', realRole: 'Finance' }),
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
  status: 'Paid' as const,
  total_value: 48000,
  pr_number: 'PR-2606040001',
  po_number: 'PO-2606040001',
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: 'u-fin',
  vendor_id: 'v-apex',
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: { name: 'Apex Supply' },
  requested_by: { full_name: 'Alice Manager' },
  approved_by: { full_name: 'Fin Ance' },
  items: [],
  quotations: [],
  receipts: [
    { id: 'r-1', procurement_id: 'proc-001', gr_number: 'GR-2606050001', status: 'Complete', receipt_date: '2026-06-05', org_id: 'org-1', created_at: '2026-06-05T00:00:00Z' },
  ],
  invoices: [
    { id: 'i-1', procurement_id: 'proc-001', vi_number: 'VI-2606060001', status: 'Paid', invoice_date: '2026-06-06', org_id: 'org-1', created_at: '2026-06-06T00:00:00Z' },
  ],
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
});

describe('AC-IXD-PROC-005: terminal Paid has no persistent GR/VI create buttons', () => {
  it('AC-IXD-PROC-005: a Paid PR offers neither "Create Goods Receipt" nor "Create Vendor Invoice"', () => {
    detailState.data = { ...base, status: 'Paid' };
    renderPage();
    expect(screen.queryByTestId('btn-create-gr')).toBeNull();
    expect(screen.queryByTestId('btn-create-vi')).toBeNull();
    expect(screen.queryByRole('button', { name: /create goods receipt/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create vendor invoice/i })).toBeNull();
  });

  it('AC-IXD-PROC-005: the already-created GR/VI render as a quiet read-only summary at Paid', () => {
    detailState.data = { ...base, status: 'Paid' };
    renderPage();
    // the GR/VI numbers are still legible (read-only) even though the create
    // affordances are gone — the document trail carries them.
    expect(screen.getAllByText('GR-2606050001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('VI-2606060001').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-IXD-PROC-005: the GR create form IS offered while Ordered (its stage is active)', () => {
    // Migration 0018 / OD-PROC-8: GR creation is requester-OR-PM (Finance dropped). The signed-in
    // user here is Finance, so make them the REQUESTER (requester may capture the GR regardless of
    // role) — the goal is unchanged: an authorized creator IS offered the GR form while Ordered.
    detailState.data = { ...base, status: 'Ordered', requested_by_id: 'u-alice', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
    // VI is NOT yet appropriate at Ordered
    expect(screen.queryByTestId('btn-create-vi')).toBeNull();
  });

  it('AC-IXD-PROC-005: the GR create form IS offered while Received', () => {
    detailState.data = { ...base, status: 'Received', requested_by_id: 'u-alice', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-gr')).toBeInTheDocument();
  });

  it('AC-IXD-PROC-005: the VI create form IS offered while Vendor Invoiced, the GR form is NOT', () => {
    detailState.data = { ...base, status: 'Vendor Invoiced', receipts: [], invoices: [] };
    renderPage();
    expect(screen.getByTestId('btn-create-vi')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-create-gr')).toBeNull();
  });
});
