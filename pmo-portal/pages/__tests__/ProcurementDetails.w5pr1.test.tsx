/**
 * AC-IXD-PROC-W5-1 — Procurement decision behavior: action eligibility,
 * approved-stage paths, SoD safeguards, and terminal-state truth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Shared mock state (mutable per test)
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
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Finance' }),
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

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const base = {
  id: 'proc-001',
  code: 'PROC-2026-001',
  title: 'Workstations for HQ',
  status: 'Requested' as const,
  total_value: 50000, currency: 'USD',
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
  requested_by: { full_name: 'Alice Requester' },
  approved_by: null,
  items: [
    {
      id: 'it1',
      org_id: 'org-1',
      procurement_id: 'proc-001',
      name: 'Laptop Workstation',
      description: null,
      quantity: 10,
      rate: 5000,
      amount: 50000,
    },
  ],
  quotations: [
    {
      id: 'q-1',
      procurement_id: 'proc-001',
      vendor_id: 'v-1',
      total_amount: 48000,
      currency: 'USD',
      vq_number: 'VQ-001',
      is_selected: false,
      reference: 'REF-001',
      received_date: '2026-06-01',
      file_url: null,
      org_id: 'org-1',
      created_at: '2026-06-01T00:00:00Z',
    },
  ],
  receipts: [],
  invoices: [],
};

const approvedBase = {
  ...base,
  status: 'Approved' as const,
  requested_by_id: 'u-other',
};

const paidBase = {
  ...base,
  status: 'Paid' as const,
  approved_by_id: 'u-fin',
  receipts: [
    {
      id: 'r-1',
      procurement_id: 'proc-001',
      gr_number: 'GR-001',
      status: 'Complete',
      receipt_date: '2026-06-05',
      org_id: 'org-1',
      created_at: '2026-06-05T00:00:00Z',
    },
  ],
  invoices: [
    {
      id: 'i-1',
      procurement_id: 'proc-001',
      vi_number: 'VI-001',
      status: 'Paid',
      invoice_date: '2026-06-06',
      org_id: 'org-1',
      created_at: '2026-06-06T00:00:00Z',
    },
  ],
};

// Requester viewing their own Requested PR — SoD blocks approval
const selfRequestedBase = {
  ...base,
  status: 'Requested' as const,
  requested_by_id: 'u-alice', // u-alice is the currentUser mock
};

// Draft with Cancel available (Draft → Cancelled is valid for requester)
const draftWithCancelBase = {
  ...base,
  status: 'Draft' as const,
  requested_by_id: 'u-alice', // requester = currentUser
  items: [
    {
      id: 'it1',
      org_id: 'org-1',
      procurement_id: 'proc-001',
      name: 'Laptop',
      description: null,
      quantity: 1,
      rate: 1000,
      amount: 1000,
    },
  ],
};

// Named-section route (`/procurement/:id/:section?`); legacy section URLs remain valid.
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
// AC-IXD-PROC-W5-1 (b) — Approved paths remain available
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (b): Approved-stage options remain reachable', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1b: both Approved-stage paths are reachable (both buttons present)', () => {
    detailState.data = { ...approvedBase };
    renderPage();

    expect(screen.getByRole('button', { name: /request vendor quotes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate purchase order/i })).toBeInTheDocument();
  });

});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-1 (c) — SoD-blocked: explain the gate and withhold actions
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 (c): SoD-blocked state — gate explanation and action eligibility', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-IXD-PROC-W5-1c: when the requester views their own Requested PR, the SoD gate is explained', () => {
    // u-alice (currentUser) is both Finance role AND the requester → SoD blocked
    detailState.data = { ...selfRequestedBase };
    renderPage();

    expect(screen.getByText(/separation-of-duties gate/i)).toBeInTheDocument();
  });

  it('AC-IXD-PROC-W5-1c: SoD-blocked state withholds Approve and Reject', () => {
    detailState.data = { ...selfRequestedBase };
    renderPage();

    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^reject$/i })).toBeNull();
  });

  it('AC-IXD-PROC-W5-1c: an eligible Finance viewer can Approve or Reject without a gate', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeInTheDocument();
    expect(screen.queryByText(/separation-of-duties gate/i)).toBeNull();
  });

  it('AC-IXD-PROC-W5-1c: an eligible reviewer receives approver-context guidance', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage();

    // Approver-context guidance remains available to an eligible reviewer.
    expect(screen.getByText(/you may approve or reject|requester cannot self.?approv/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Non-regression: all existing terminal / adminBreakGlass behaviors still hold
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-1 non-regression: terminal states and sections remain available', () => {
  beforeEach(() => {
    mockRole = 'Finance';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('non-regression: Paid state shows no transition buttons anywhere on the page', () => {
    detailState.data = { ...paidBase };
    renderPage();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /mark as paid/i })).toBeNull();
  });

  it('non-regression: the line-items section still renders at Requested state', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('items');
    expect(screen.getByTestId('line-items-section')).toBeInTheDocument();
  });

  it('non-regression: the vendor-quotes section (VendorQuotesTab) still renders at Requested state', () => {
    detailState.data = { ...base, status: 'Requested', requested_by_id: 'u-other' };
    renderPage('quotes');
    // VendorQuotesTab (Slice 3) replaced QuotationsSection — testid is now vendor-quotes.
    expect(screen.getByTestId('vendor-quotes')).toBeInTheDocument();
  });

});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
