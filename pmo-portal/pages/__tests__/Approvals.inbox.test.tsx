import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// MemoryRouter `initialEntries` carries the ?scope= deep-link; the page reads it via
// useSearchParams (real, not mocked) to select the active section tab.

const procRows = [
  { id: 'pr1', title: 'Steel beams', code: 'PR-001', status: 'Requested', requested_by_id: 'other-1', total_value: 48000, created_at: '2026-06-01T00:00:00Z', project: { name: 'Apollo', code: 'PRJ-014' }, requested_by: { full_name: 'Sam Vendor' } },
  { id: 'pr2', title: 'Crane rental', code: 'PR-002', status: 'Requested', requested_by_id: 'me', total_value: 12000, created_at: '2026-06-02T00:00:00Z', project: { name: 'Apollo', code: 'PRJ-014' }, requested_by: { full_name: 'Me' } }, // own → excluded
  { id: 'pr3', title: 'Already approved', code: 'PR-003', status: 'Approved', requested_by_id: 'other-2', total_value: 9000, created_at: '2026-06-03T00:00:00Z', project: null, requested_by: { full_name: 'Other' } }, // not Requested → excluded
];

const procState = { data: procRows as unknown[], isPending: false, isError: false };
const tsState = { data: [{ id: 's1', status: 'Submitted', week_start_date: '2026-06-01', owner: { full_name: 'Anita Rao' }, entries: [{ project_id: 'pA', entry_date: '2026-06-01', hours: 8, project: { name: 'Apollo', code: 'PRJ-014' } }] }] as unknown[], isPending: false, isError: false };

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ ...procState, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ ...tsState, refetch: vi.fn() }),
  useTimesheetMutations: () => ({
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
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
  tsState.isPending = false;
  tsState.isError = false;
});

describe('AC-IXD-PROC-W5-3: Approvals inbox — role-aware sections', () => {
  it('CW-6: the page title is "Approvals" (matches the rail label), with the "Needs my approval" subtitle', () => {
    renderAs('Project Manager');
    // The H1 reconciles with the rail's "Approvals" nav item — one canonical name.
    expect(screen.getByRole('heading', { level: 1, name: /^Approvals$/i })).toBeInTheDocument();
    // "Needs my approval" survives as the subtitle (clarifies whose queue this is).
    expect(screen.getByText(/Needs my approval/i)).toBeInTheDocument();
  });

  it('CW-6: a PM (sees both modules) gets deep-linkable scope tabs', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('tab', { name: /Procurement/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toBeInTheDocument();
  });

  it('CW-6: clicking the Timesheets tab switches the active section (and updates the deep-link)', async () => {
    renderAs('Project Manager'); // defaults to procurement
    expect(screen.getByText(/Purchase requests awaiting you/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Timesheets/i }));
    // The timesheet section is now the active panel; procurement is hidden.
    expect(screen.getByText(/Timesheets awaiting you/i)).toBeInTheDocument();
    expect(screen.queryByText(/Purchase requests awaiting you/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('CW-6: ?scope=timesheets deep-links straight to the timesheets section', () => {
    renderAs('Project Manager', '/approvals?scope=timesheets');
    expect(screen.getByText(/Timesheets awaiting you/i)).toBeInTheDocument();
    // Procurement section is not the active panel.
    expect(screen.queryByText(/Purchase requests awaiting you/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Timesheets/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('CW-6: default scope (no param) shows the procurement section for a PM', () => {
    renderAs('Project Manager');
    expect(screen.getByText(/Purchase requests awaiting you/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Procurement/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('procurement section counts only Requested + not-self (SoD): 1 of 3', () => {
    renderAs('Project Manager', '/approvals?scope=procurement');
    // PR-001 (other, Requested) shows; PR-002 (mine) and PR-003 (Approved) excluded.
    expect(screen.getByText('Steel beams')).toBeInTheDocument();
    expect(screen.queryByText('Crane rental')).not.toBeInTheDocument();
    expect(screen.queryByText('Already approved')).not.toBeInTheDocument();
    expect(screen.getByText(/Purchase requests awaiting you \(1\)/i)).toBeInTheDocument();
  });

  it('a PR row previews in place + approves inline — no navigation (AC-IFW-PROC-01)', async () => {
    // IF-A: replaces the CW-6 route-away. The row expands to a budget preview with
    // Approve/Reject adjacent, so the PM clears the queue without leaving the inbox.
    renderAs('Project Manager', '/approvals?scope=procurement');
    const disclosure = screen.getByRole('button', { name: /Show budget impact for Steel beams/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    // Approve/Reject are now adjacent, in the inbox — and the row never routed away.
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('Finance sees ONLY the procurement section (no timesheet approval, no tabs)', () => {
    renderAs('Finance');
    expect(screen.getByText(/Purchase requests awaiting you/i)).toBeInTheDocument();
    expect(screen.queryByText(/Timesheets awaiting you/i)).not.toBeInTheDocument();
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
