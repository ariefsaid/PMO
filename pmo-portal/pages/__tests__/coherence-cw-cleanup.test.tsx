/**
 * Coherence wave — CW cleanup residuals
 *
 * CW-DEAL-1: "No deals in <stage>" → "No projects in <stage>"
 *   The SalesKanbanBoard empty-column copy must say "No projects in <stage>",
 *   not "No deals in <stage>". Same noun as the rest of the app post-CW-1.
 *
 * AC-S20-001: one decision area follows request evidence
 *   The restructured ProcurementDetails (#1404) puts the one approval verb in the RecordHeader
 *   actions slot (the page's single canonical action area); there is no mirrored second Approve.
 *
 * CW-EDIT-1: Procurement RecordHeader exposes Edit in the action area (record-scoped gate)
 *   Edit is reachable from the RecordHeader's "More procurement actions" menu when the
 *   procurement is editable: status Draft or Rejected, AND the user is the requester or an
 *   Admin. Edit must NOT be offered on terminal/non-editable states or for non-requester
 *   non-Admin roles. RLS remains the enforcement authority.
 */

// ── Fix 1: "No deals" → "No projects" in SalesKanbanBoard ─────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// SalesKanbanBoard test ──────────────────────────────────────────────────────
import SalesKanbanBoard from '@/components/SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';

const emptyProjects: PipelineProject[] = [
  // One deal in Quotation so Leads column is empty — triggers the empty message
  {
    id: 'q1',
    name: 'Alpha Deal',
    short_name: null,
    client_name: 'Acme',
    tax_treatment: 'exclusive',
    status: 'Quotation Submitted',
    contract_value: 100_000,
    currency: 'USD',
    win_probability: 0.5,
  },
];

describe('CW-DEAL-1: SalesKanbanBoard empty column uses "No projects" noun', () => {
  it('CW-DEAL-1: empty Leads column shows "No projects in Leads", not "No deals"', () => {
    render(<SalesKanbanBoard projects={emptyProjects} onOpen={vi.fn()} />);
    expect(screen.getByText('No projects in Leads')).toBeInTheDocument();
    expect(screen.queryByText('No deals in Leads')).toBeNull();
  });

  it('CW-DEAL-1: empty Negotiation column shows "No projects in Negotiation"', () => {
    render(<SalesKanbanBoard projects={emptyProjects} onOpen={vi.fn()} />);
    expect(screen.getByText('No projects in Negotiation')).toBeInTheDocument();
  });

  it('CW-DEAL-1: no "No deals in" strings remain in the board', () => {
    render(<SalesKanbanBoard projects={[]} onOpen={vi.fn()} />);
    // With all columns empty, none should show the old "No deals in <stage>" copy
    expect(screen.queryAllByText(/No deals in /)).toHaveLength(0);
  });
});

// ── Fix 2 & 3: ProcurementDetails sticky decision card + RecordHeader Edit ──
import { MemoryRouter, Route, Routes } from 'react-router';

// ---------------------------------------------------------------------------
// Hook mocks — minimal, matching the established pattern in sibling test files
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
// The page resolves the project's manager (PM scope) via useProject; the current PM manages proj-1.
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: () => ({ data: { project_manager_id: 'u-pm' }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpOrphans: () => ({ data: [], isError: false, isPending: false }) }));
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
    transition: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false, error: null },
    createQuotation: { mutateAsync: vi.fn().mockResolvedValue({ id: 'q-new' }), isPending: false, error: null },
    createReceipt: { mutateAsync: vi.fn().mockResolvedValue({ id: 'r-new' }), isPending: false, error: null },
    createInvoice: { mutateAsync: vi.fn().mockResolvedValue({ id: 'i-new' }), isPending: false, error: null },
    captureVendorInvoice: { mutateAsync: vi.fn().mockResolvedValue({ id: 'vi-new' }), isPending: false, error: null },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useProcurementCrudMutations: () => ({
    updateHeader: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    createItem: { mutateAsync: vi.fn().mockResolvedValue({ id: 'it-new' }), isPending: false },
    updateItem: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    deleteItem: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    selectQuote: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    createDocument: { mutateAsync: vi.fn().mockResolvedValue({ id: 'd-new' }), isPending: false },
    deleteDocument: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [{ value: 'v1', label: 'Apex Supply', sub: 'Vendor' }] }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

let mockEffectiveRole = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: mockEffectiveRole, realRole: mockEffectiveRole }),
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
  useProjectBudget: () => ({ data: 1_000_000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

// useIsDesktop — controlled per describe block
let mockIsDesktop = true; // default: desktop for Fix 2 tests
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => mockIsDesktop,
}));

vi.mock('@/src/hooks/useVendorWithholdingSlips', () => ({
  useVendorWithholdingCoverage: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useVendorWithholdingRegister: () => ({ data: { pages: [] }, isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(), fetchNextPage: vi.fn() }),
  useVendorWithholdingSlipMutations: () => ({ record: { mutateAsync: vi.fn(), isPending: false }, correct: { mutateAsync: vi.fn(), isPending: false }, void: { mutateAsync: vi.fn(), isPending: false } }),
}));

import ProcurementDetails from '../ProcurementDetails';

// ---------------------------------------------------------------------------
// Shared fixture — Requested PR (PM can Approve, is not the requester)
// ---------------------------------------------------------------------------
const requestedPR = {
  id: 'proc-cw-001',
  code: 'PROC-CW-001',
  title: 'CW Cleanup Supplies',
  status: 'Requested' as const,
  total_value: 5_000,
  currency: 'USD',
  pr_number: 'PR-CW001',
  po_number: null,
  vq_number: null,
  approval_notes: null,
  rejection_notes: null,
  requested_by_id: 'u-eng',     // NOT the current user (u-pm)
  approved_by_id: null,
  vendor_id: null,
  project_id: 'proj-1',
  org_id: 'org-1',
  created_at: '2026-06-14T00:00:00Z',
  updated_at: '2026-06-14T00:00:00Z',
  project: { name: 'HQ Fit-Out', code: 'PRJ-001' },
  vendor: null,
  requested_by: { full_name: 'Eng User' },
  approved_by: null,
  items: [{ id: 'it1', org_id: 'org-1', procurement_id: 'proc-cw-001', name: 'Switches', description: null, quantity: 1, rate: 5000, amount: 5000 }],
  quotations: [],
  receipts: [],
  invoices: [],
  purchase_requests: [],
  rfqs: [],
  purchase_orders: [],
  payments: [],
  statusEvents: [],
};

/** Draft PR with the PM as requester — to test Edit affordance on Draft */
const draftByPM = {
  ...requestedPR,
  status: 'Draft' as const,
  requested_by_id: 'u-pm',   // = current user (u-pm)
  requested_by: { full_name: 'PM User' },
};

/** Approved PR — PM is not the requester; check Edit affordance on Approved */
const approvedPR = {
  ...requestedPR,
  status: 'Approved' as const,
  approved_by_id: 'u-exec',
  approved_by: { full_name: 'Exec User' },
};

const renderPage = (id = 'proc-cw-001') =>
  render(
    <MemoryRouter initialEntries={[`/procurement/${id}`]}>
      <Routes>
        <Route path="/procurement/:procurementId" element={<ProcurementDetails />} />
      </Routes>
    </MemoryRouter>,
  );

// ---------------------------------------------------------------------------
// AC-S20-001: the one decision area is single, evidence-first and not mirrored.
// ---------------------------------------------------------------------------
describe('AC-S20-001: one evidence-first decision area', () => {
  beforeEach(() => {
    mockIsDesktop = true;
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...requestedPR };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('AC-S20-001: the approver has exactly one Approve action in the header and no mirrored desktop CTA', () => {
    renderPage();
    // Scoped to the header: the phone-only fixed bar (sm:hidden) carries the same verb in the DOM.
    const actions = screen.getByTestId('record-header-actions');
    expect(within(actions).getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.queryByTestId('mobile-sticky-action')).toBeNull();
  });

  it('AC-S20-001: the decision control lives in the RecordHeader actions slot (placement holds)', () => {
    renderPage();
    const actions = screen.getByTestId('record-header-actions');
    expect(within(actions).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CW-EDIT-1: Procurement RecordHeader Edit affordance for authorized roles
// ---------------------------------------------------------------------------
describe('CW-EDIT-1: Procurement RecordHeader exposes Edit for authorized editable cases', () => {
  beforeEach(() => {
    mockIsDesktop = true;
    mockEffectiveRole = 'Project Manager';
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('CW-EDIT-1: requester (PM) sees Edit in the RecordHeader actions menu on their own Draft PR', async () => {
    // CW-EDIT-1 keeps Edit surfaced inside the RecordHeader action zone (not buried elsewhere).
    // Gate: (isDraft || isRejected) && (isRequester || Admin) — draftByPM has PM as requester.
    detailState.data = { ...draftByPM }; // status=Draft, requested_by_id='u-pm' = current user
    renderPage();
    const headerActions = screen.getByTestId('record-header-actions');
    await userEvent.click(within(headerActions).getByRole('button', { name: /more procurement actions/i }));
    expect(within(headerActions).getByTestId('edit-header')).toBeInTheDocument();
  });

  it('CW-EDIT-1: Edit is hidden on a non-editable state (Approved) — record-scoped gate', async () => {
    // Approved is not Draft or Rejected; Edit must NOT appear even though PM has the policy permission.
    detailState.data = { ...approvedPR }; // status=Approved, PM is not requester
    renderPage();
    // Open the menu first: a closed menu would make the absence assertion vacuous.
    const headerActions = screen.getByTestId('record-header-actions');
    await userEvent.click(within(headerActions).getByRole('button', { name: /more procurement actions/i }));
    expect(within(headerActions).getByRole('menuitem', { name: /history/i })).toBeInTheDocument();
    expect(screen.queryByTestId('edit-header')).toBeNull();
  });

  it('CW-EDIT-1: Edit is hidden for a non-requester non-Admin on a Draft PR', async () => {
    // PM is not the requester here (requested_by_id = u-eng) and not an Admin.
    detailState.data = { ...requestedPR, status: 'Draft' as const }; // Draft, but PM not requester
    renderPage();
    // Open the menu first: a closed menu would make the absence assertion vacuous.
    const headerActions = screen.getByTestId('record-header-actions');
    await userEvent.click(within(headerActions).getByRole('button', { name: /more procurement actions/i }));
    expect(within(headerActions).getByRole('menuitem', { name: /history/i })).toBeInTheDocument();
    expect(screen.queryByTestId('edit-header')).toBeNull();
  });
});

// Case-reference register (#1020) has its own tests; isolate it from the details-page harness.
vi.mock('@/src/hooks/useErpPurchaseLinks', () => import('@/pages/__tests__/helpers/erpPurchaseLinksMock'));
vi.mock('@/src/hooks/useProcurementGates', () => import('@/pages/__tests__/helpers/procurementGatesMock'));
vi.mock('@/src/hooks/useProcurementMicrosoftReferences', () => ({ useProcurementMicrosoftReferences: () => ({ query: { data: [] } }) }));
vi.mock('@/pages/procurement/ProcurementMicrosoftReferences', () => ({ ProcurementMicrosoftReferences: () => null }));
