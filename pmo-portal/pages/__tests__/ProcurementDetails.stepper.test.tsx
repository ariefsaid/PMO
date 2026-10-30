import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

/**
 * AC-IXD-PROC-002 — approval is a GATE, not a stage (owner directive 2026-06-21,
 * reversing the prior "Approved is its own node" decision). Approval must still be
 * VISIBLE: approving ADVANCES the bar — the PR node becomes `done` and the
 * Vendor-Quote node becomes `current` (the next action), so an Approved PR sits at
 * a LATER stepper node than a Requested PR. There is NO standalone "Approved" node.
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
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/hooks/useProcurementItemEligibility', () => ({ useProcurementItemEligibility: () => ({ data: true, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }) }));

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
vi.mock('react-router', async (orig) => {
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

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));

vi.mock('@/src/hooks/useProjects', () => import('@/pages/__tests__/helpers/projectScopeMock'));
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
import ProcurementDetails from '../ProcurementDetails';

const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 85000, currency: 'USD',
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
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/procurement/proc-001']}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

/** The tracker's stages, in order, each with its label and whether it is the current step. */
function stages(): Array<{ label: string; current: boolean }> {
  const tracker = screen.getByTestId('procurement-stage-tracker');
  return within(tracker).getAllByRole('listitem').map((el) => ({
    label: el.querySelector('span')?.textContent ?? '',
    current: el.getAttribute('aria-current') === 'step',
  }));
}
const headerActions = () => within(screen.getByTestId('record-header-actions'));

beforeEach(() => {
  detailState.isPending = false;
  detailState.isError = false;
  detailState.error = null;
});

// The six-node PR→Vendor Quote→PO→GR→VI→Payment stepper became a four-stage tracker (Request / Order /
// Receive / Pay) in the procurement record restructure (#1404). Approval is a gate INSIDE the Request
// stage, so approving no longer moves the tracker; the case visibly moves on through the status and the
// one primary action (Approve is replaced by the next step). The tracker still advances at Ordered.
describe('AC-IXD-PROC-002: the lifecycle tracker advances as the purchase progresses', () => {
  it('AC-IXD-PROC-002: an Ordered purchase sits at a LATER stage than a Requested one', () => {
    detailState.data = { ...base, status: 'Requested' };
    const { unmount } = renderPage();
    const requestedIdx = stages().findIndex((stage) => stage.current);
    unmount();

    detailState.data = { ...base, status: 'Ordered', approved_by_id: 'u-fin' };
    renderPage();
    const orderedIdx = stages().findIndex((stage) => stage.current);

    expect(requestedIdx).toBeGreaterThanOrEqual(0);
    expect(orderedIdx).toBeGreaterThan(requestedIdx);
  });

  it('AC-IXD-PROC-002: approving moves the case on, with NO standalone "Approved" stage', () => {
    detailState.data = { ...base, status: 'Requested' };
    const { unmount } = renderPage();
    expect(headerActions().getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    unmount();

    detailState.data = { ...base, status: 'Approved', approved_by_id: 'u-fin' };
    renderPage();
    // Approval is a gate, not a stage — the four stages are Request / Order / Receive / Pay.
    expect(stages().map((stage) => stage.label)).toEqual(['Request', 'Order', 'Receive', 'Pay']);
    // The request stage is still the current one, but Approve is gone: the next step took its place.
    expect(stages()[0]).toEqual({ label: 'Request', current: true });
    expect(headerActions().queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByTestId('procurement-status-badge')).not.toHaveTextContent(/waiting for approval/i);
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
