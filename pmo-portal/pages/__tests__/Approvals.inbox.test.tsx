import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * AC-IXD-PROC-W5-3 — the promoted `/approvals` two-section role-aware inbox (N6).
 *   Procurement section: PRs in Requested the role may approve + not-self (SoD-a).
 *     Rows PREVIEW IN PLACE (expand) with adjacent Approve/Reject — no drill-in
 *     (intent-fix-wave IF-A / AC-IFW-PROC-01, replacing the CW-6 route-away).
 *   Timesheet section: the enhanced ApprovalsQueue.
 *   Role-awareness: Finance → procurement only; PM/Exec/Admin → both; Engineer → no-access.
 */
const navigateMock = vi.fn();
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateMock };
});

// MemoryRouter `initialEntries` carries the ?scope= deep-link; the page reads it via
// useSearchParams (real, not mocked) to select the active section tab.

const procRows = [
  { id: 'pr1', title: 'Steel beams', code: 'PR-001', status: 'Requested', requested_by_id: 'other-1', total_value: 48000, currency: 'USD', created_at: '2026-06-01T00:00:00Z', project: { name: 'Apollo', code: 'PRJ-014' }, requested_by: { full_name: 'Sam Vendor' } },
  { id: 'pr2', title: 'Crane rental', code: 'PR-002', status: 'Requested', requested_by_id: 'me', total_value: 12000, currency: 'USD', created_at: '2026-06-02T00:00:00Z', project: { name: 'Apollo', code: 'PRJ-014' }, requested_by: { full_name: 'Me' } }, // own → excluded
  { id: 'pr3', title: 'Already approved', code: 'PR-003', status: 'Approved', requested_by_id: 'other-2', total_value: 9000, currency: 'USD', created_at: '2026-06-03T00:00:00Z', project: null, requested_by: { full_name: 'Other' } }, // not Requested → excluded
];

const procState = { data: procRows as unknown[], isPending: false, isError: false };
const tsState = { data: [{ id: 's1', status: 'Submitted', week_start_date: '2026-06-01', owner: { full_name: 'Anita Rao' }, entries: [{ project_id: 'pA', entry_date: '2026-06-01', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } }] }] as unknown[], isPending: false, isError: false };
const expenseState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const invoiceState = { rows: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const reopenableState = { data: [] as unknown[], isPending: false, isError: false };

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ ...procState, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useReopenableApprovedTimesheets: () => reopenableState,
  useTimesheetsAwaitingApproval: () => ({ ...tsState, refetch: vi.fn() }),
  useTimesheetMutations: () => ({
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
    reopenApproved: { mutate: vi.fn(), isPending: false },
    attestNoErpDocument: { mutate: vi.fn(), isPending: false },
  }),
  // P3b: `PushAttentionSection` renders inside Approvals, so this mock must carry the hook it calls
  // or the whole page throws on render. Empty + settled = the section renders nothing, which keeps
  // these role-aware-section assertions about the queues themselves, exactly as they were written.
  usePushesNeedingAttention: () => ({
    data: [],
    isPending: false,
    isError: false,
    retry: { mutate: vi.fn(), isPending: false },
  }),
  useEmployeeLinkConfirm: () => ({
    links: { data: [], isPending: false, isError: false },
    confirm: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' }, role: 'Project Manager' }),
}));

// IF-A: the procurement section now renders <ProcurementApprovalRow>, which expands
// in place (react-query detail) instead of routing away. Mock its hooks like the row's
// own unit test, so the page test stays hermetic (no real QueryClientProvider needed).
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({
    data: {
      id: 'pr1',
      title: 'Steel beams',
      project: { name: 'Apollo', code: 'PRJ-014' },
      vendor: null,
      items: [{ id: 'li1', name: 'Beam', quantity: 1, rate: 48000, amount: 48000, description: null }],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useProcurementMutations: () => ({ transition: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock('@/pages/procurement/DecisionSupportPanel', () => ({
  DecisionSupportPanel: ({ projectName }: { projectName?: string | null }) => (
    <div data-testid="decision-support">Budget · {projectName}</div>
  ),
}));

vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => expenseState }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalSection', () => ({ SalesInvoiceApprovalSection: () => null }));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => invoiceState }));
import ApprovalsPage from '../Approvals';

const renderAs = (realRole: Role, initialPath = '/approvals') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ImpersonationProvider realRole={realRole}>
        <ToastProvider>
          <ApprovalsPage />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  navigateMock.mockReset();
  procState.data = procRows;
  procState.isPending = false;
  procState.isError = false;
  tsState.data = [{ id: 's1', status: 'Submitted', week_start_date: '2026-06-01', owner: { full_name: 'Anita Rao' }, entries: [{ project_id: 'pA', entry_date: '2026-06-01', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } }] }];
  tsState.isPending = false;
  tsState.isError = false;
  expenseState.data = [];
  expenseState.isPending = false;
  expenseState.isError = false;
  invoiceState.rows = [];
  invoiceState.isPending = false;
  invoiceState.isError = false;
  reopenableState.data = [];
});

describe('AC-IXD-PROC-W5-3: Approvals inbox — role-aware sections', () => {
  it('UIP-008: desktop queue reserves two lines for request identity ahead of status and metadata', async () => {
    const title = 'Cable supply for extended commissioning — northern distribution boards';
    procState.data = [{ ...procRows[0], title }];
    renderAs('Finance');
    const button = screen.getByRole('button', { name: new RegExp(title) });
    const identity = within(button).getByText(title);
    expect(identity.className).toContain('line-clamp-2');
    expect(identity.className).not.toContain('truncate');
    expect(identity.parentElement).toContainElement(within(button).getByText('Requested'));
    expect(button).toHaveAccessibleName(/Cable supply.*Apollo/);
    await userEvent.tab();
    await userEvent.click(button);
    expect(within(screen.getByRole('region', { name: /Approval preview/i })).getByRole('button', { name: /Approve/i })).toBeVisible();
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it('CW-6: the page title is "Approvals" (matches the rail label), with the "Needs my approval" subtitle', () => {
    renderAs('Project Manager');
    // The H1 reconciles with the rail's "Approvals" nav item — one canonical name.
    expect(screen.getByRole('heading', { level: 1, name: /^Approvals$/i })).toBeInTheDocument();
    // "Needs my approval" survives as the subtitle (clarifies whose queue this is).
    expect(screen.getByText(/Needs my approval/i)).toBeInTheDocument();
  });

  it('UXS-025: pending work precedes collapsed approved correction history', () => {
    reopenableState.data = [{
      id: 'approved-week', user_id: 'other', week_start_date: '2026-05-25', status: 'Approved',
      owner: { full_name: 'Reviewer' }, entries: [], mirror: null, pushCommandState: null,
    }];
    renderAs('Project Manager');

    const queue = screen.getByRole('heading', { name: /Approvals queue/i });
    const history = screen.getByText('Approved history and corrections');
    expect(queue.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history.closest('details')).not.toHaveAttribute('open');
    expect(history).toHaveTextContent('last 90 days');
  });

  it('AC-UXS-005: All pending counts every eligible kind once and each kind filter uses the same population', async () => {
    expenseState.data = [{ claim: { id: 'ex1', created_at: '2026-06-03', status: 'Submitted', claimant_id: 'other', claim_number: 'EXP-1', title: 'Travel', amount: 250, currency: 'USD', claimant: { full_name: 'Colleague' } }, route: { route: 'project', approvers: [{ id: 'me' }] } }];
    invoiceState.rows = [{ id: 'si1', created_at: '2026-06-04' }];
    renderAs('Project Manager');

    expect(screen.getByRole('tab', { name: /All pending/i })).toHaveTextContent('4');
    // The two-row queue contains procurement + timesheets; expenses and invoices render below it.
    expect(within(screen.getByRole('region', { name: /Approvals queue/i })).getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Purchase requests/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Expense claims/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Customer invoices/i })).toHaveTextContent('1');

    await userEvent.click(screen.getByRole('tab', { name: /Expense claims/i }));
    expect(screen.getByRole('link', { name: 'EXP-1' })).toHaveAttribute('href', '/expenses/ex1');
    expect(screen.getByRole('tab', { name: /Expense claims/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('Finance All pending excludes hook-returned timesheets from its count and selectable queue', () => {
    procState.data = [];
    expenseState.data = [{ claim: { id: 'ex1', created_at: '2026-06-03', status: 'Submitted', claimant_id: 'other', claim_number: 'EXP-1', title: 'Travel', amount: 250, currency: 'USD', claimant: { full_name: 'Colleague' } }, route: { route: 'project', approvers: [{ id: 'me' }] } }];
    renderAs('Finance');

    expect(screen.getByRole('tab', { name: /All pending/i })).toHaveTextContent('1');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    expect(within(queue).queryByRole('button', { name: /Anita Rao/i })).not.toBeInTheDocument();
    expect(within(queue).queryByText('Timesheets')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Approval preview/i })).toHaveTextContent(/Select an approval item/i);
  });

  it('keeps the desktop preview loading while an eligible expense read is pending', () => {
    procState.data = [];
    tsState.data = [];
    expenseState.isPending = true;
    renderAs('Project Manager');

    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Select an approval item/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No requests awaiting your decision/i)).not.toBeInTheDocument();
  });

  it('L3-APPROVALS: a PM (sees both modules) gets queue filters for All, Procurement, and Timesheets', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('tab', { name: /All/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Purchase requests/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toBeInTheDocument();
  });

  it('AC-MOBILE-OVERFLOW-001: the scope filter strip lives inside a dedicated horizontal scroller', () => {
    renderAs('Project Manager');
    const scroll = screen.getByTestId('approvals-scope-scroll');
    expect(scroll.className).toContain('min-w-0');
    expect(scroll.className).toContain('overflow-x-auto');
    expect(scroll.className).toContain('scroll-fade-x');
  });

  it('L3-APPROVALS: desktop defaults to the unified triage queue with the first pending item selected', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('region', { name: /Approvals queue/i })).toBeInTheDocument();
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(screen.getByRole('tab', { name: /All/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByRole('heading', { name: /Steel beams/i })).toBeInTheDocument();
  });

  it('L3-APPROVALS: clicking the Timesheets filter deep-links straight to that queue and preview', async () => {
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('tab', { name: /Timesheets/i }));
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByText(/Anita Rao/i)).toBeInTheDocument();
    expect(screen.queryByText(/Steel beams/i)).not.toBeInTheDocument();
  });

  it('L3-APPROVALS: ?scope=timesheets deep-links straight to the timesheets queue with neutral policy guidance', () => {
    renderAs('Project Manager', '/approvals?scope=timesheets');
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByText(/Anita Rao/i)).toBeInTheDocument();
    expect(within(preview).getByText('Policy: a different person approves each timesheet.')).toBeInTheDocument();
    expect(screen.queryByText(/Steel beams/i)).not.toBeInTheDocument();
  });

  it('procurement queue counts only Requested + not-self (SoD): 1 of 3', () => {
    renderAs('Project Manager', '/approvals?scope=procurement');
    // PR-001 (other, Requested) shows; PR-002 (mine) and PR-003 (Approved) excluded.
    expect(screen.getAllByText('Steel beams').length).toBeGreaterThan(0);
    expect(screen.queryByText('Crane rental')).not.toBeInTheDocument();
    expect(screen.queryByText('Already approved')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Purchase requests/i })).toHaveTextContent('1');
  });

  it('a queue selection moves the preview pane + keeps approve/reject there — no navigation', async () => {
    renderAs('Project Manager', '/approvals?scope=procurement');
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    const queueRow = screen.getByRole('button', { name: /Steel beams/i });
    await userEvent.click(queueRow);
    expect(within(preview).getByRole('button', { name: /Approve/i })).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: /Reject/i })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('Finance sees ONLY the procurement queue group (no timesheet approval, no extra filters)', () => {
    renderAs('Finance');
    expect(screen.getByRole('region', { name: /Approvals queue/i })).toBeInTheDocument();
    // A single-module role gets no tab-switcher (nothing to switch to).
    expect(screen.queryByRole('tab', { name: /Timesheets/i })).not.toBeInTheDocument();
  });

  it('Engineer (cannot approve anything) gets the no-access surface', () => {
    renderAs('Engineer');
    expect(screen.queryByText(/Purchase requests awaiting you/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Timesheets awaiting you/i)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /don't have access/i })).toBeInTheDocument();
  });

  it('both-empty → a single caught-up page-level empty state', () => {
    procState.data = [];
    tsState.data = [];
    renderAs('Project Manager');
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('procurement query error shows a per-section retry (procurement scope active)', () => {
    procState.isError = true;
    procState.data = [];
    renderAs('Project Manager', '/approvals?scope=procurement');
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});
