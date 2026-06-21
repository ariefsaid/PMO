/**
 * Coherence wave — CW cleanup residuals
 *
 * CW-DEAL-1: "No deals in <stage>" → "No projects in <stage>"
 *   The SalesKanbanBoard empty-column copy must say "No projects in <stage>",
 *   not "No deals in <stage>". Same noun as the rest of the app post-CW-1.
 *
 * CW-STICKY-1: RecordActionZone sticky on desktop
 *   The ProcurementDetails decision card must carry sticky bottom positioning
 *   on desktop (≥920px) so the Approve/Reject/advance zone is never below the fold.
 *   On mobile (≤920px) the existing mobile-sticky-action bar handles it.
 *
 * CW-EDIT-1: Procurement RecordHeader exposes Edit in the action zone (record-scoped gate)
 *   The Edit button must appear inside the RecordHeader action zone (not buried elsewhere)
 *   when the procurement is editable: status Draft or Rejected, AND the user is the
 *   requester or an Admin. Edit must NOT appear on terminal/non-editable states or for
 *   non-requester non-Admin roles. RLS remains the enforcement authority.
 */

// ── Fix 1: "No deals" → "No projects" in SalesKanbanBoard ─────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';

// SalesKanbanBoard test ──────────────────────────────────────────────────────
import SalesKanbanBoard from '@/components/SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';

const emptyProjects: PipelineProject[] = [
  // One deal in Quotation so Leads column is empty — triggers the empty message
  {
    id: 'q1',
    name: 'Alpha Deal',
    client_name: 'Acme',
    status: 'Quotation Submitted',
    contract_value: 100_000,
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
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
  useProcurementDocuments: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
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

vi.mock('react-router-dom', async (orig) => {
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
}));

// useIsDesktop — controlled per describe block
let mockIsDesktop = true; // default: desktop for Fix 2 tests
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => mockIsDesktop,
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
// IxD Change 1: decision strip is NON-STICKY, in normal flow under the stepper.
//
// Supersedes CW-STICKY-1 (which required desktop sticky-bottom). Owner IxD reversal:
// the decision zone is a compact, non-sticky strip placed directly below the stepper
// and above the tabs — no floating sticky bar over page content. It still renders
// through the RecordActionZone (the enforcement contract holds), just without the
// sticky positioning.
// ---------------------------------------------------------------------------
describe('IxD Change 1: decision strip is non-sticky, in normal flow (under the stepper)', () => {
  beforeEach(() => {
    mockIsDesktop = true;
    mockEffectiveRole = 'Project Manager';
    detailState.data = { ...requestedPR };
    detailState.isPending = false;
    detailState.isError = false;
    detailState.error = null;
  });

  it('IxD Change 1: the decision-zone wrapper carries NO sticky/bottom positioning on desktop', () => {
    renderPage();
    const card = screen.getByTestId('decision-card');
    const zone = card.closest('[data-testid="record-action-zone"]');
    expect(zone).not.toBeNull();
    // The strip is in normal flow — no sticky / bottom anchoring on the action zone.
    expect(zone!.className).not.toMatch(/sticky/);
    expect(zone!.className).not.toMatch(/bottom-/);
  });

  it('IxD Change 1: the decision strip still renders through the RecordActionZone (enforcement holds)', () => {
    renderPage();
    const zone = screen.getByTestId('record-action-zone');
    expect(within(zone).getByTestId('decision-card')).toBeInTheDocument();
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

  it('CW-EDIT-1: requester (PM) sees Edit button in RecordHeader actions on their own Draft PR', () => {
    // CW-EDIT-1 keeps Edit surfaced inside the RecordHeader action zone (not buried elsewhere).
    // Gate: (isDraft || isRejected) && (isRequester || Admin) — draftByPM has PM as requester.
    detailState.data = { ...draftByPM }; // status=Draft, requested_by_id='u-pm' = current user
    renderPage();
    const headerActions = screen.getByTestId('record-header-actions');
    expect(within(headerActions).getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('CW-EDIT-1: Edit is hidden on a non-editable state (Approved) — record-scoped gate', () => {
    // Approved is not Draft or Rejected; Edit must NOT appear even though PM has the policy permission.
    detailState.data = { ...approvedPR }; // status=Approved, PM is not requester
    renderPage();
    // record-header-actions is only rendered when canEditHeader is true; on Approved it won't exist.
    expect(screen.queryByTestId('edit-header')).toBeNull();
  });

  it('CW-EDIT-1: Edit is hidden for a non-requester non-Admin on a Draft PR', () => {
    // PM is not the requester here (requested_by_id = u-eng) and not an Admin.
    detailState.data = { ...requestedPR, status: 'Draft' as const }; // Draft, but PM not requester
    renderPage();
    // record-header-actions is only rendered when canEditHeader is true; here it won't exist.
    expect(screen.queryByTestId('edit-header')).toBeNull();
  });
});
