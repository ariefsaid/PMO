import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';

// ── Mocked data sources ──────────────────────────────────────────────────────
const procState: { data: unknown[] | undefined; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const tsState: { data: unknown[] | undefined; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const roleState: { realRole: string | null } = { realRole: 'Project Manager' };

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ ...procState }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ ...tsState }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: roleState.realRole }),
}));

const renderTile = (includeTimesheets: boolean) =>
  render(
    <MemoryRouter>
      <AwaitingApprovalTile includeTimesheets={includeTimesheets} />
    </MemoryRouter>,
  );

// Three Requested PRs: one raised by me (SoD-excluded), two by others.
const procRows = [
  { id: 'pr1', status: 'Requested', requested_by_id: 'other-1' },
  { id: 'pr2', status: 'Requested', requested_by_id: 'other-2' },
  { id: 'pr3', status: 'Requested', requested_by_id: 'me' }, // own → excluded
  { id: 'pr4', status: 'Approved', requested_by_id: 'other-3' }, // not Requested → excluded
];

beforeEach(() => {
  procState.data = procRows;
  procState.isPending = false;
  procState.isError = false;
  tsState.data = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  tsState.isPending = false;
  tsState.isError = false;
  roleState.realRole = 'Project Manager';
});

describe('AC-IXD-PROC-W5-3: AwaitingApprovalTile honest role-scoped count', () => {
  it('PM combined count = approvable PRs (not-self, Requested) + timesheets', () => {
    renderTile(true);
    // 2 approvable PRs + 3 timesheets = 5
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('5');
  });

  it('Finance count = PRs only (no timesheet approval)', () => {
    roleState.realRole = 'Finance';
    renderTile(false);
    // 2 approvable PRs, timesheets NOT added
    expect(screen.getByRole('link')).toHaveTextContent('2');
  });

  it('excludes my own request from the PR count (SoD)', () => {
    tsState.data = [];
    renderTile(false);
    // 2 (pr1, pr2) — pr3 is mine, pr4 is not Requested
    expect(screen.getByRole('link')).toHaveTextContent('2');
  });

  it('routes to /approvals as a single link and surfaces a visible Review CTA', () => {
    renderTile(true);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/approvals');
    expect(link).toHaveTextContent(/Review/i);
  });

  it('a non-approver role (Engineer) contributes zero PRs even if rows exist', () => {
    roleState.realRole = 'Engineer';
    tsState.data = [];
    renderTile(false);
    // Engineer cannot transition procurement → 0
    expect(screen.getByRole('link')).toHaveTextContent('0');
  });

  it('zero-state shows 0 and "nothing waiting"', () => {
    procState.data = [];
    tsState.data = [];
    renderTile(true);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('0');
    expect(link).toHaveTextContent(/nothing waiting/i);
  });

  it('pluralizes correctly: 1 item (singular), not 1 items', () => {
    procState.data = [{ id: 'pr1', status: 'Requested', requested_by_id: 'other-1' }];
    tsState.data = [];
    renderTile(false);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(/1 item\b/);
    expect(link.textContent).not.toMatch(/1 items/);
  });

  it('loading shows the KPI skeleton', () => {
    procState.isPending = true;
    procState.data = undefined;
    renderTile(true);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
  });
});

describe('AC-B-0-5: AwaitingApprovalTile surfaces error tone on query failure', () => {
  it('AC-B-0-5: procurement error → shows "—" value, not "0"', () => {
    procState.isError = true;
    procState.data = undefined;
    renderTile(false);
    const link = screen.getByRole('link');
    // Must show "—" (em dash), NOT the false-zero "0"
    expect(link).toHaveTextContent('—');
    expect(link.textContent).not.toMatch(/\b0\b/);
  });

  it('AC-B-0-5: procurement error → "unavailable" sub-text (not "nothing waiting")', () => {
    procState.isError = true;
    procState.data = undefined;
    renderTile(false);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(/unavailable/i);
    expect(link.textContent).not.toMatch(/nothing waiting/i);
  });

  it('AC-B-0-5: timesheet error (includeTimesheets=true) → shows "—" value', () => {
    tsState.isError = true;
    tsState.data = undefined;
    renderTile(true);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('—');
    expect(link.textContent).not.toMatch(/\b0\b/);
  });

  it('AC-B-0-5: no error when only timesheets error but includeTimesheets=false', () => {
    tsState.isError = true;
    tsState.data = undefined;
    // Finance role: includeTimesheets=false — timesheet error is irrelevant
    roleState.realRole = 'Finance';
    renderTile(false);
    const link = screen.getByRole('link');
    // Should show the procCount (2) not error dash
    expect(link).toHaveTextContent('2');
  });
});
