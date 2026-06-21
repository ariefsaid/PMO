/**
 * AC-SOD-COPY — SoD-aware gate copy per lifecycle status (Fix I5).
 *
 * The "Ready to advance" GateNotice must carry per-status SoD teaching
 * rather than generic copy. Assertions:
 *
 * (a) Draft → Requested (author viewing): GateNotice "ready" mentions SoD
 *     (requester≠approver). The existing `sod-pre-announce` paragraph also
 *     remains; this test focuses on the GateNotice variant="ready" copy.
 *
 * (b) Requested (approver viewing, non-requester Finance role): the GateNotice
 *     "ready" copy mentions the SoD note — the approver sees why they can act.
 *
 * (c) Vendor Invoiced → Paid (Finance, non-approver): GateNotice "ready"
 *     mentions "approver can't also pay" / separation of duties teaching.
 *
 * (d) Ordered (PM viewing, who is the requester): GateNotice "ready" copy
 *     for a non-SoD stage is concise + does NOT still say the generic
 *     "You may move this request to its next lifecycle stage below."
 *
 * These are display-only copy changes; no enforcement logic is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

vi.mock('react-router-dom', async (orig) => {
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

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Base fixture
// ---------------------------------------------------------------------------
const base = {
  id: 'proc-sod-001',
  code: 'PROC-SOD-001',
  title: 'Office Furniture',
  total_value: 25000,
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

// ---------------------------------------------------------------------------
// (a) Draft author: the GateNotice "ready" variant carries SoD teaching
// ---------------------------------------------------------------------------
describe('AC-SOD-COPY (a): Draft author GateNotice "ready" mentions SoD (requester≠approver)', () => {
  it('AC-SOD-COPY-a: Draft author sees a GateNotice ready that references the approval hand-off', () => {
    mockRole = 'Engineer';
    mockUserId = 'u-pm'; // u-pm IS the requester
    detailState.data = {
      ...base,
      status: 'Draft',
      requested_by_id: 'u-pm',
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    // The GateNotice "ready" must reference passing to an approver / not self-approving
    const cardText = card.textContent ?? '';
    expect(cardText).toMatch(/approver|hands this|can.?t approve your own/i);
  });

  it('AC-SOD-COPY-a: Draft author gate does NOT use the old generic "You may move this request" copy', () => {
    mockRole = 'Engineer';
    mockUserId = 'u-pm';
    detailState.data = {
      ...base,
      status: 'Draft',
      requested_by_id: 'u-pm',
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    // The generic "You may move this request to its next lifecycle stage below." must be gone
    expect(card.textContent).not.toMatch(/You may move this request to its next lifecycle stage below/i);
  });
});

// ---------------------------------------------------------------------------
// (b) Requested (approver viewing): ready GateNotice should mention SoD
// ---------------------------------------------------------------------------
describe('AC-SOD-COPY (b): Requested + Finance-approver sees SoD-aware ready copy', () => {
  it('AC-SOD-COPY-b: the GateNotice at Requested (approver view) mentions separation of duties', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance'; // not the requester (u-pm)
    detailState.data = {
      ...base,
      status: 'Requested',
      requested_by_id: 'u-pm',
      approved_by_id: null,
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    const cardText = card.textContent ?? '';
    // Should mention requester cannot self-approve / SoD context
    expect(cardText).toMatch(/requester|cannot self.?approv|separation.of.duties|you may approve|SoD/i);
  });

  it('AC-SOD-COPY-b: Requested approver-view gate does NOT say the old generic copy verbatim', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = {
      ...base,
      status: 'Requested',
      requested_by_id: 'u-pm',
      approved_by_id: null,
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    expect(card.textContent).not.toMatch(/You may move this request to its next lifecycle stage below/i);
  });
});

// ---------------------------------------------------------------------------
// (c) Vendor Invoiced → Paid: SoD-b payer≠approver teaching in ready copy
// ---------------------------------------------------------------------------
describe('AC-SOD-COPY (c): Vendor Invoiced + payer sees SoD-b teaching (approver cannot pay)', () => {
  it('AC-SOD-COPY-c: the GateNotice at Vendor Invoiced (Finance non-approver) mentions payer≠approver', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance'; // NOT the approver
    detailState.data = {
      ...base,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-pm',
      approved_by_id: 'u-exec', // someone else approved — u-finance can pay
      po_number: 'PO-001',
      invoices: [
        { id: 'vi-1', vi_number: 'VI-001', status: 'Received', invoice_date: '2026-06-18',
          reference_number: null, amount: 25000, procurement_id: 'proc-sod-001',
          org_id: 'org-1', created_at: '2026-06-18T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-1', po_number: 'PO-001', reference_number: null, status: 'Issued',
          date: '2026-06-15', amount: 25000, procurement_id: 'proc-sod-001',
          org_id: 'org-1', created_at: '2026-06-15T00:00:00Z' },
      ],
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    const cardText = card.textContent ?? '';
    // Must mention that the approver cannot also pay / SoD-b teaching
    expect(cardText).toMatch(/approver.{0,40}(pay|payment)|separation.of.duties|payer.{0,20}approver/i);
  });

  it('AC-SOD-COPY-c: Vendor Invoiced gate does NOT say the old generic copy verbatim', () => {
    mockRole = 'Finance';
    mockUserId = 'u-finance';
    detailState.data = {
      ...base,
      status: 'Vendor Invoiced',
      requested_by_id: 'u-pm',
      approved_by_id: 'u-exec',
      po_number: 'PO-001',
      invoices: [
        { id: 'vi-1', vi_number: 'VI-001', status: 'Received', invoice_date: '2026-06-18',
          reference_number: null, amount: 25000, procurement_id: 'proc-sod-001',
          org_id: 'org-1', created_at: '2026-06-18T00:00:00Z' },
      ],
      purchase_orders: [
        { id: 'po-1', po_number: 'PO-001', reference_number: null, status: 'Issued',
          date: '2026-06-15', amount: 25000, procurement_id: 'proc-sod-001',
          org_id: 'org-1', created_at: '2026-06-15T00:00:00Z' },
      ],
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    expect(card.textContent).not.toMatch(/You may move this request to its next lifecycle stage below/i);
  });
});

// ---------------------------------------------------------------------------
// (d) Non-SoD stage (Approved → PM can request quotes): concise ready copy
// ---------------------------------------------------------------------------
describe('AC-SOD-COPY (d): non-SoD stage (Approved) ready copy is concise — no old generic copy', () => {
  it('AC-SOD-COPY-d: Approved + PM viewer sees a ready GateNotice without the old generic verbatim', () => {
    mockRole = 'Project Manager';
    mockUserId = 'u-pm-viewer';
    detailState.data = {
      ...base,
      status: 'Approved',
      requested_by_id: 'u-other',
      approved_by_id: 'u-exec',
    };
    renderPage();
    const card = screen.getByTestId('decision-card');
    // New copy: anything other than the old generic verbatim is fine
    expect(card.textContent).not.toMatch(/You may move this request to its next lifecycle stage below/i);
  });
});
