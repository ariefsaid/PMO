/**
 * AC-IXD-PROC-W5-C3 — Wave-5 Cluster-3 PR-1: Procurement detail legibility
 *
 * Capture affordances remain available only for eligible roles and record states.
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
  // Activity references come from related procurement records. Base has none.
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
// GR/VI capture affordances retain their role and record-state gates.
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-C3: eligible users can capture receipts and invoices', () => {
  beforeEach(() => {
    mockRole = 'Project Manager';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('D17: an eligible requester can open the goods receipt form', async () => {
    detailState.data = { ...orderedFixture };
    renderPage();
    const grTrigger = screen.getByTestId('btn-create-gr');
    await userEvent.click(grTrigger);
    // Now the form is open
    const form = screen.getByTestId('form-create-gr');
    const saveBtn = within(form).getByTestId('btn-save-gr');
    expect(saveBtn).toBeInTheDocument();
  });

  it('D17: Finance can open the vendor invoice capture form during recovery', async () => {
    mockRole = 'Finance';
    detailState.data = { ...vendorInvoicedFixture };
    renderPage();
    const viTrigger = screen.getByTestId('btn-create-vi');
    await userEvent.click(viTrigger);
    const form = screen.getByTestId('form-create-vi');
    const saveBtn = within(form).getByTestId('btn-save-vi');
    expect(saveBtn).toBeInTheDocument();
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
describe('AC-IXD-PROC-W5-C3 non-regression: role-gated decision actions remain available', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('non-regression: Paid state has no action buttons', () => {
    detailState.data = { ...paidFixture };
    renderPage();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
