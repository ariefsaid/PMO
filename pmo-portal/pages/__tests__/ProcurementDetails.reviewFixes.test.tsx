/**
 * Design-review fix tests — I1/I2/I3/I4/I6/M3/M4.
 *
 * I3  — Draft Overview must be sparse: only tiles with real values render.
 * I2  — Honest tiles on terminal/early states: no "awaiting delivery" on a Paid case.
 * I1  — Stepper doc ref from actual records, not denormalized header columns.
 * I4  — Budget label: "After this request" sub must say "headroom remaining", not "% of budget".
 * I6  — Mobile stat tiles: 2-col grid, no horizontal carousel (no snap/overflow-x).
 * M3  — Timeline column: aside must NOT force min-height/stretch (size to content).
 * M4  — nextExpectedType: Ordered/Received → null (defer to action zone, no mis-prompt PO).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Shared mutable hook state (mirrors existing test harnesses)
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

vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: vi.fn(() => ({
    list: { data: [], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(async () => 'https://signed/url'),
    progress: null,
    uploadError: null,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
  })),
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

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-finance', org_id: 'org-1' } }),
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

// Budget hooks — used by DecisionSupportPanel
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 150000, isPending: false, isError: false }),
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

// ---------------------------------------------------------------------------
// Base fixture
// ---------------------------------------------------------------------------

const base = {
  id: 'proc-review-001',
  code: 'PROC-2026-REV',
  title: 'Review Fix Test Procurement',
  total_value: 85000, currency: 'USD',
  pr_number: 'PR-2606040001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-other',
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-rev',
  org_id: 'org-1',
  created_at: '2026-06-04T00:00:00Z',
  updated_at: '2026-06-04T00:00:00Z',
  project: { name: 'Review Project', code: 'REV-001' },
  vendor: null,
  requested_by: { full_name: 'Alice Manager' },
  approved_by: null,
  items: [{ id: 'item-1', name: 'Widget', qty: 1, unit_price: 85000, total: 85000, procurement_id: 'proc-review-001', org_id: 'org-1', created_at: '2026-06-04T00:00:00Z' }],
  quotations: [],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

const renderPage = (path = '/procurement/proc-review-001') =>
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
});

// ---------------------------------------------------------------------------
// I3 — Draft is sparse: only tiles with real values appear
// ---------------------------------------------------------------------------

// The Overview "stat tiles" strip became the procurement money summary (#1404): it always lists its
// figures and says "None recorded" for an absent one. The goal — no misleading placeholder such as
// "Pending", "None yet", "no PO yet" or "awaiting delivery" — holds. The "fewer than 4 tiles" test pinned
// the old sparse layout (the five-figure summary is deliberate), so it is dropped.
const MISLEADING = ['Pending', 'None yet', 'no PO yet', 'awaiting delivery'];
const moneyText = () => screen.getByTestId('procurement-money-summary').textContent ?? '';

describe('I3: Draft money summary has no misleading placeholder', () => {
  it('I3: a Draft case shows the requested value and no Pending/None-yet placeholders', () => {
    detailState.data = {
      ...base,
      status: 'Draft',
      // no PO, no quotes, no receipts
      po_number: null,
      quotations: [],
      receipts: [],
    };
    renderPage();

    const text = moneyText();
    // Must contain the request value
    expect(text).toContain('85,000');
    // Must NOT contain a placeholder that reads as a state
    expect(MISLEADING.some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I2 — Honest tiles on terminal states: no "awaiting delivery" on Paid
// ---------------------------------------------------------------------------

describe('I2: Paid case shows honest tiles — no "awaiting delivery"', () => {
  it('I2: a Paid case with a receipt does NOT show "awaiting delivery" in the money summary', () => {
    detailState.data = {
      ...base,
      status: 'Paid',
      po_number: 'PO-2606040001',
      approved_by_id: 'u-other-approver',
      quotations: [
        {
          id: 'vq-1',
          vq_number: 'VQ-2606040001',
          vendor_id: 'v-1',
          total_amount: 85000,
          currency: 'USD',
          received_date: '2026-06-04',
          is_selected: true,
          reference: null,
          procurement_id: 'proc-review-001',
          org_id: 'org-1',
          created_at: '2026-06-04T00:00:00Z',
        },
      ],
      receipts: [
        {
          id: 'gr-1',
          gr_number: 'GR-2606040001',
          status: 'Complete',
          receipt_date: '2026-06-05',
          reference_number: null,
          procurement_id: 'proc-review-001',
          org_id: 'org-1',
          created_at: '2026-06-05T00:00:00Z',
        },
      ],
      invoices: [
        {
          id: 'vi-1',
          vi_number: 'VI-2606040001',
          status: 'Received',
          invoice_date: '2026-06-06',
          reference_number: null,
          amount: 85000,
          procurement_id: 'proc-review-001',
          org_id: 'org-1',
          created_at: '2026-06-06T00:00:00Z',
        },
      ],
      purchase_requests: [],
      rfqs: [],
      purchase_orders: [],
      payments: [],
    };
    renderPage();

    // "awaiting delivery" must not appear anywhere in the money summary
    expect(moneyText().toLowerCase()).not.toContain('awaiting delivery');
  });

  it('I2: a Paid case with no receipts shows no misleading placeholder in the money summary', () => {
    detailState.data = {
      ...base,
      status: 'Paid',
      po_number: 'PO-2606040001',
      approved_by_id: 'u-other-approver',
      quotations: [],
      receipts: [],
      invoices: [],
      purchase_requests: [],
      rfqs: [],
      purchase_orders: [],
      payments: [],
    };
    renderPage();

    // No "none yet" placeholder when no receipts exist on a terminal case
    expect(moneyText().toLowerCase()).not.toContain('none yet');
  });
});

// ---------------------------------------------------------------------------
// I1 — Stepper refs from actual records, not denormalized header columns
// ---------------------------------------------------------------------------

// The six-node stepper with doc refs became the four-stage tracker (#1404), whose stage lines are
// counted from the actual record rows (never from the denormalized header columns); the document numbers
// live in the Timeline. The goal is unchanged: a header column alone fabricates no record.
const stageLine = (label: string) => {
  const tracker = screen.getByTestId('procurement-stage-tracker');
  const item = within(tracker).getAllByRole('listitem').find((el) => el.querySelector('span')?.textContent === label);
  return item?.textContent ?? '';
};

describe('I1: stage tracker + timeline come from actual record rows, not header columns', () => {
  it('I1: a Requested PR with a denormalized pr_number but NO purchase_request record shows no PR ref or count', () => {
    detailState.data = {
      ...base,
      status: 'Requested',
      pr_number: 'PR-2606040001', // denormalized header column
      purchase_requests: [],       // but NO actual PR record
    };
    renderPage();

    // The Request stage must not claim a recorded purchase request, and the fabricated ref is nowhere
    expect(stageLine('Request')).not.toMatch(/purchase request/i);
    expect(screen.getByTestId('procurement-stage-tracker')).not.toHaveTextContent('PR-2606040001');
    expect(screen.queryByText('PR-2606040001')).toBeNull();
  });

  it('I1: when a purchase_request record exists, the Request stage counts it and its pr_number appears', () => {
    detailState.data = {
      ...base,
      status: 'Requested',
      pr_number: 'PR-2606040001',
      purchase_requests: [
        {
          id: 'pr-rec-1',
          pr_number: 'PR-2606040001',
          status: 'Submitted',
          date: '2026-06-04',
          reference_number: null,
          amount: 85000,
          currency: 'USD',
          procurement_id: 'proc-review-001',
          org_id: 'org-1',
          created_at: '2026-06-04T00:00:00Z',
        },
      ],
    };
    renderPage();

    // The PR is counted now (record exists) and its number is legible in the case timeline
    expect(stageLine('Request')).toMatch(/1 purchase request/i);
    expect(screen.getAllByText('PR-2606040001').length).toBeGreaterThanOrEqual(1);
  });

  it('I1: a po_number header with no purchase_order record does NOT show a PO ref or order count', () => {
    detailState.data = {
      ...base,
      status: 'Ordered',
      po_number: 'PO-2606040999', // denormalized header column
      purchase_orders: [],          // but NO actual PO record
      approved_by_id: 'u-approver',
      quotations: [],
      receipts: [],
      invoices: [],
      purchase_requests: [],
      rfqs: [],
      payments: [],
    };
    renderPage();

    // PO-2606040999 must NOT appear — no PO record
    expect(stageLine('Order')).not.toMatch(/\d+ orders?/i);
    expect(screen.queryByText('PO-2606040999')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// I4 — Budget label: "% remaining" / "headroom remaining", not "% of budget"
// ---------------------------------------------------------------------------

describe('I4: budget sub-label reads "headroom remaining", not "% of budget"', () => {
  it('I4: the "After this request" tile sub does not say "% of budget" (misread as utilization)', () => {
    detailState.data = {
      ...base,
      status: 'Requested',
      project_id: 'proj-rev',
    };
    renderPage();

    // The budget panel renders tiles — find the "After this request" tile
    // and assert its sub-label is NOT "X% of budget"
    const allText = document.body.textContent ?? '';
    expect(allText).not.toMatch(/\d+(\.\d+)?% of budget/i);
  });

  it('I4: the "After this request" tile sub says "headroom" or "remaining"', () => {
    detailState.data = {
      ...base,
      status: 'Requested',
      project_id: 'proj-rev',
    };
    renderPage();

    // Look for the sub-label text in the budget tiles
    const allText = document.body.textContent ?? '';
    // Should contain one of: "headroom remaining", "% remaining", "% headroom"
    expect(allText).toMatch(/headroom|% remaining/i);
  });
});

// I6 tests live in StatTiles.test.tsx (imported directly, avoiding the vi.mock above)

// M3 (progression aside sized to content) pinned CSS classes of the removed Overview progression
// aside (#1404 replaced it with the stage tracker + timeline), so it is deleted rather than ported.

// ---------------------------------------------------------------------------
// M4 — nextExpectedType: Ordered → null, Received → null
// ---------------------------------------------------------------------------

describe('M4: LedgerCaptureRow is hidden at Ordered and Received (defer to action zone)', () => {
  it('M4 control: the capture row IS on the Files tab at Draft (so its absence below is meaningful)', () => {
    detailState.data = { ...base, status: 'Draft' };
    renderPage('/procurement/proc-review-001/files');
    expect(screen.getByTestId('ledger-capture-row')).toBeInTheDocument();
  });

  it('M4: Ordered status does NOT show the ledger capture row (would mis-prompt PO)', () => {
    detailState.data = {
      ...base,
      status: 'Ordered',
      po_number: 'PO-2606040001',
      approved_by_id: 'u-approver',
      quotations: [],
      receipts: [],
      invoices: [],
      purchase_requests: [],
      rfqs: [],
      purchase_orders: [],
      payments: [],
    };
    renderPage('/procurement/proc-review-001/files');

    // The ledger lives on the Files tab (#1404); visit it so the absence is not vacuous.
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });

  it('M4: Received status does NOT show the ledger capture row (GR already passed, await VI in action zone)', () => {
    detailState.data = {
      ...base,
      status: 'Received',
      po_number: 'PO-2606040001',
      approved_by_id: 'u-approver',
      quotations: [],
      receipts: [
        {
          id: 'gr-1',
          gr_number: 'GR-2606040001',
          status: 'Complete',
          receipt_date: '2026-06-05',
          reference_number: null,
          procurement_id: 'proc-review-001',
          org_id: 'org-1',
          created_at: '2026-06-05T00:00:00Z',
        },
      ],
      invoices: [],
      purchase_requests: [],
      rfqs: [],
      purchase_orders: [],
      payments: [],
    };
    renderPage('/procurement/proc-review-001/files');
    expect(screen.queryByTestId('ledger-capture-row')).toBeNull();
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
