import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
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
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
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

// The mixed queue renders procurement evidence for the selected request. Mock its
// detail/mutation hooks so the inbox stays hermetic (no real QueryClientProvider needed).
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({
    data: {
      id: 'pr1',
      title: 'Steel beams',
      project_id: 'pA',
      status: 'Requested',
      total_value: 48000,
      currency: 'USD',
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
vi.mock('@/pages/approvals/SalesInvoiceApprovalSection', () => ({
  SalesInvoiceApprovalSection: ({ selectedInvoiceId }: { selectedInvoiceId?: string }) => selectedInvoiceId
    ? <div data-testid="selected-invoice">Invoice evidence · {selectedInvoiceId}</div>
    : null,
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({ useInvoicesAwaitingViewer: () => invoiceState }));
import ApprovalsPage from '../Approvals';

const renderAs = (realRole: Role, initialPath = '/approvals') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <ImpersonationProvider realRole={realRole}>
        <ToastProvider>
          <ApprovalsPage />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location-probe" data-search={location.search} />;
};

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
    const button = screen.getByRole('button', { name: new RegExp(title), pressed: true });
    const identity = within(button).getByText(title);
    expect(identity.parentElement).toContainElement(within(button).getByText('Requested'));
    expect(button).toHaveAccessibleName(/Cable supply.*PR-001/);
    expect(button).not.toHaveTextContent('Sam Vendor');
    expect(button).not.toHaveTextContent('$48,000');
    await userEvent.tab();
    await userEvent.click(button);
    expect(within(screen.getByRole('region', { name: /Approval preview/i })).getByRole('button', { name: /Approve/i })).toBeVisible();
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it('CW-6: the page title is "Approvals" (matches the rail label), with the "My decisions" scope', () => {
    renderAs('Project Manager');
    // The H1 reconciles with the rail's "Approvals" nav item — one canonical name.
    expect(screen.getByRole('heading', { level: 1, name: /^Approvals$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/^My decisions$/i)).toBeInTheDocument();
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

  it('AC-UXS-005: kind counts remain available and All pending shows each eligible item', async () => {
    expenseState.data = [{ claim: { id: 'ex1', created_at: '2026-06-03', status: 'Submitted', claimant_id: 'other', claim_number: 'EXP-1', title: 'Travel', amount: 250, currency: 'USD', claimant: { full_name: 'Colleague' } }, route: { route: 'project', approvers: [{ id: 'me' }] } }];
    invoiceState.rows = [{ id: 'si1', created_at: '2026-06-04' }];
    renderAs('Admin');

    expect(screen.getByRole('tab', { name: /All pending/i })).toHaveTextContent('4');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    expect(within(queue).getByRole('button', { name: /Steel beams/i })).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: /Anita Rao/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Purchase requests/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Expense claims/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Customer invoices/i })).toHaveTextContent('1');
    expect(within(queue).queryByText('4', { exact: true })).toBeNull();
    expect(within(queue).getByTestId('approval-item-expense-ex1')).toBeInTheDocument();
    expect(within(queue).getByTestId('approval-item-expense-ex1')).toHaveTextContent(/\$250\b/);
    expect(within(queue).getByTestId('approval-item-expense-ex1')).not.toHaveTextContent(/\.00\b/);
    expect(within(queue).getByTestId('approval-item-invoice-si1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Expense claims/i }));
    expect(screen.getByRole('link', { name: 'EXP-1' })).toHaveAttribute('href', '/expenses/ex1');
    expect(screen.getByRole('tab', { name: /Expense claims/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(queue).queryByText('1', { exact: true })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /Customer invoices/i }));
    expect(screen.getByTestId('selected-invoice')).toHaveTextContent('si1');
  });

  it('R-019: an empty Timesheets scope stays compact and returns to the populated mixed queue', async () => {
    tsState.data = [];
    renderAs('Project Manager');

    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    expect(within(queue).getByRole('button', { name: /Steel beams/i })).toBeInTheDocument();
    expect(within(queue).queryByText(/No timesheets awaiting your decision/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Timesheets/i }));

    const empty = within(queue).getByTestId('approval-scope-empty');
    expect(empty).toHaveTextContent('No timesheets awaiting your decision');
    expect(empty.className).not.toContain('border-dashed');
    await userEvent.click(within(empty).getByRole('button', { name: 'Show all pending' }));
    expect(screen.getByRole('tab', { name: /All pending/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(queue).getByRole('button', { name: /Steel beams/i })).toBeInTheDocument();
  });

  it('Finance All pending excludes ineligible timesheets from its selectable queue', () => {
    procState.data = [];
    expenseState.data = [{ claim: { id: 'ex1', created_at: '2026-06-03', status: 'Submitted', claimant_id: 'other', claim_number: 'EXP-1', title: 'Travel', amount: 250, currency: 'USD', claimant: { full_name: 'Colleague' } }, route: { route: 'project', approvers: [{ id: 'me' }] } }];
    renderAs('Finance');

    expect(screen.getByRole('tab', { name: /All pending/i })).toHaveTextContent('1');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    expect(within(queue).queryByText('1', { exact: true })).toBeNull();
    expect(within(queue).queryByRole('button', { name: /Anita Rao/i })).not.toBeInTheDocument();
    expect(within(queue).queryByText('Timesheets')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Approval preview/i })).toHaveTextContent(/EXP-1/);
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

  it('AC-MOBILE-OVERFLOW-001: all queue scopes remain operable and switch the visible population', async () => {
    renderAs('Project Manager');
    const scope = screen.getByRole('tab', { name: /Purchase requests/i });
    await userEvent.click(scope);
    expect(scope).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: /Approvals queue/i })).toHaveTextContent('Steel beams');
    expect(screen.getByRole('region', { name: /Approvals queue/i })).not.toHaveTextContent('Anita Rao');
  });

  it('L3-APPROVALS: desktop defaults to the unified triage queue with the first pending item selected', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('region', { name: /Approvals queue/i })).toBeInTheDocument();
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(screen.getByRole('tab', { name: /All/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByRole('heading', { name: /Steel beams/i })).toBeInTheDocument();
  });

  it('R-028/029: groups queue kinds and avoids a redundant queue title/helper', () => {
    renderAs('Project Manager');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    expect(within(queue).getByRole('heading', { name: /Purchase requests/i })).toBeInTheDocument();
    expect(within(queue).getByRole('heading', { name: /Timesheets · hours/i })).toBeInTheDocument();
    expect(within(queue).queryByRole('heading', { name: 'Pending work' })).not.toBeInTheDocument();
    expect(within(queue).queryByText(/Select an item to preview/i)).not.toBeInTheDocument();
    expect(within(queue).getAllByRole('heading', { name: /Purchase requests/i })).toHaveLength(1);
  });

  it('AC-IXD-APP-01: the mixed queue places the oldest waiting request first across kinds', () => {
    tsState.data = [{
      id: 's-old', status: 'Submitted', week_start_date: '2026-05-25',
      owner: { full_name: 'Anita Rao' },
      entries: [{ project_id: 'pA', entry_date: '2026-05-25', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } }],
    }];
    renderAs('Project Manager');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    const olderTimesheet = within(queue).getByRole('button', { name: /Anita Rao/i });
    const newerPurchase = within(queue).getByRole('button', { name: /Steel beams/i });
    expect(Boolean(olderTimesheet.compareDocumentPosition(newerPurchase) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('AC-IXD-APP-02: selecting a mixed-queue item is reflected in the URL and restored on entry', async () => {
    const user = userEvent.setup();
    const first = renderAs('Project Manager');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    await user.click(within(queue).getByRole('button', { name: /Anita Rao/i }));
    expect(new URLSearchParams(screen.getByTestId('location-probe').getAttribute('data-search') ?? '').get('selected')).toBe('timesheets:s1');

    first.unmount();
    renderAs('Project Manager', '/approvals?scope=all&selected=timesheets%3As1');
    const restored = within(screen.getByRole('region', { name: /Approvals queue/i })).getByRole('button', { name: /Anita Rao/i });
    expect(restored).toHaveAttribute('aria-pressed', 'true');
  });

  it('AC-IXD-APP-03: phone selection replaces the queue with evidence and Back to queue restores it', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    renderAs('Project Manager');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    await userEvent.click(within(queue).getByRole('button', { name: /Steel beams/i }));
    expect(screen.queryByRole('region', { name: /Approvals queue/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to queue/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Approval preview/i })).toHaveTextContent(/Steel beams/i);
    await userEvent.click(screen.getByRole('button', { name: /Back to queue/i }));
    expect(screen.getByRole('region', { name: /Approvals queue/i })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('L3-APPROVALS: clicking the Timesheets filter deep-links straight to that queue and preview', async () => {
    renderAs('Project Manager');
    await userEvent.click(screen.getByRole('tab', { name: /Timesheets/i }));
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByText(/Anita Rao/i)).toBeInTheDocument();
    expect(screen.queryByText(/Steel beams/i)).not.toBeInTheDocument();
  });

  it('R-030: timesheet queue opens without standing policy guidance', () => {
    renderAs('Project Manager', '/approvals?scope=timesheets');
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByText(/Anita Rao/i)).toBeInTheDocument();
    expect(within(preview).queryByText(/Policy: a different person approves each timesheet/i)).not.toBeInTheDocument();
    expect(within(preview).getAllByText('Hours')).toHaveLength(1);
    expect(within(preview).queryByText('8.0 h')).not.toBeInTheDocument();
    expect(within(preview).getByTestId('tsgrid-grand-total').className).toContain('text-xl');
    expect(screen.queryByText(/Steel beams/i)).not.toBeInTheDocument();
  });

  it('H-01–H-03: gives a queued timesheet one type-and-unit heading and a bare total', () => {
    renderAs('Project Manager');
    const queue = screen.getByRole('region', { name: /Approvals queue/i });
    const sheet = within(queue).getByRole('button', { name: /Anita Rao/i });
    expect(within(queue).getByRole('heading', { name: 'Timesheets · hours' })).toBeInTheDocument();
    expect(within(sheet).getByText('8')).toBeInTheDocument();
    expect(within(sheet).queryByText(/8(?:\.0)? h\b/i)).not.toBeInTheDocument();
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
    const queueRow = screen.getByRole('button', { name: /Steel beams/i, pressed: true });
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
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
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
