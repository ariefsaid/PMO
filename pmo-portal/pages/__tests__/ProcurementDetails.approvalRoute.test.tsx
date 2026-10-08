/**
 * AC-APR-031 — #803 approval routing on the request page. UX only (ADR-0016): who is offered
 * Approve/Reject on a Requested request, and the one-line note naming who decides and why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Hook mocks (minimal — we care only about the GateNotice copy rendering)
// ---------------------------------------------------------------------------
const detailState = {
  data: undefined as Record<string, unknown> | undefined,
  isPending: false,
  isError: false,
  error: null as (Error & { code?: string }) | null,
  refetch: vi.fn(),
};

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
  useProcurementDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));

// currentUser = u-finance by default; override per describe block as needed
let mockUserId = 'u-finance';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: mockUserId, org_id: 'org-1' } }),
}));

let mockRole = 'Finance';
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

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Base fixture
// ---------------------------------------------------------------------------
const base = {
  id: 'proc-sod-001',
  code: 'PROC-SOD-001',
  title: 'Office Furniture',
  total_value: 25000, currency: 'USD',
  pr_number: 'PR-2606200001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-pm',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-20T00:00:00Z',
  updated_at: '2026-06-20T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Pat PM' },
  approved_by: null,
  items: [
    { id: 'it-1', name: 'Desk', description: null, quantity: 1, rate: 25000,
      procurement_id: 'proc-sod-001', org_id: 'org-1', created_at: '2026-06-20T00:00:00Z' },
  ],
  quotations: [],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

const renderPage = (path = '/procurement/proc-sod-001') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
        <Route path="/procurement/:procurementId/:tab" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  detailState.data = undefined;
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
  mockRole = 'Finance';
  mockUserId = 'u-finance';
});

const routedTo = (id: string, fullName: string) => ({
  procurementId: 'proc-sod-001',
  route: 'project' as const,
  reason: 'within_budget' as const,
  approvers: [{ id, fullName }],
  requestAmount: 25000,
  lineBudget: 100000,
  lineUsed: 0,
});

describe('AC-APR-031 approval routing on the request page', () => {
  it('AC-APR-031: a Finance viewer the request is not routed to sees the note and no Approve/Reject', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = { ...base, status: 'Requested', budget_category: 'Materials', approvalRoute: routedTo('u-pm2', 'Pia Approver') };
    renderPage();
    expect(screen.getByTestId('approval-route-note').textContent).toBe(
      "Approval for this request is routed to Pia Approver: it is within the project's Materials budget.",
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('AC-APR-031: the named approver is offered Approve and sees no note', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = { ...base, status: 'Requested', budget_category: 'Materials', approvalRoute: routedTo('u-finance', 'Fay Finance') };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByTestId('approval-route-note')).not.toBeInTheDocument();
  });

  it('AC-APR-031: with no route the role matrix decides (fallback, FR-APR-035)', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = { ...base, status: 'Requested' };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('AC-APR-031: an Admin who is not named keeps break-glass', () => {
    mockRole = 'Admin';
    mockUserId = 'u-admin';
    detailState.data = { ...base, status: 'Requested', budget_category: 'Materials', approvalRoute: routedTo('u-pm2', 'Pia Approver') };
    renderPage();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});
