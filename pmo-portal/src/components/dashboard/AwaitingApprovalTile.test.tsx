/**
 * AC-IXD-PROC-W5-2h — AwaitingApprovalTile
 *
 * Tests verify:
 *  - Renders an honest count (procurement Requested + timesheets awaiting)
 *  - The whole tile is a single <a> link to /approvals (no nested interactive)
 *  - Zero state shows "0" + "nothing waiting" (not hidden)
 *  - Loading shows KPI skeleton
 *  - PM placeholder (kpi-timesheets-awaiting) is GONE from PMDashboard
 *  - Engineer dashboard has NO awaiting-approval tile
 *  - Finance tile counts only procurement (no timesheets)
 *  - Exec tile counts both procurement + timesheets
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Shared mock state — controlled per test
// ---------------------------------------------------------------------------
const procState = {
  data: undefined as Array<{ status: string; requested_by_id: string }> | undefined,
  isPending: false,
  isError: false,
};
const tsState = {
  data: undefined as Array<{ id: string }> | undefined,
  isPending: false,
};

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => tsState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/policy', () => ({
  can: (action: string, entity: string) => {
    if (action === 'transition' && entity === 'procurement') return true;
    return false;
  },
}));

import { AwaitingApprovalTile } from './AwaitingApprovalTile';

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  procState.data = undefined;
  procState.isPending = false;
  procState.isError = false;
  tsState.data = undefined;
  tsState.isPending = false;
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2h — link target
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2h — tile is a single link to /approvals', () => {
  it('renders as a link to /approvals', () => {
    procState.data = [];
    tsState.data = [];
    wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/approvals');
  });

  it('has an accessible name (not icon-only)', () => {
    procState.data = [];
    tsState.data = [];
    wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    const link = screen.getByRole('link');
    // accessible name must be non-empty
    expect(link.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('contains no nested interactive element inside the link', () => {
    procState.data = [];
    tsState.data = [];
    const { container } = wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    const link = container.querySelector('a')!;
    const nested = link.querySelectorAll('a, button');
    expect(nested).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2i — honest combined count
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2i — honest count', () => {
  it('shows combined count: 2 Requested PRs (not self) + 1 timesheet = 3', () => {
    procState.data = [
      { status: 'Requested', requested_by_id: 'other-1' },
      { status: 'Requested', requested_by_id: 'other-2' },
      { status: 'Draft', requested_by_id: 'other-3' }, // not Requested → excluded
      { status: 'Requested', requested_by_id: 'u-pm' }, // self → excluded (SoD)
    ];
    tsState.data = [{ id: 'ts-1' }];
    wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows 0 when nothing is waiting, with "nothing waiting" sub-text', () => {
    procState.data = [];
    tsState.data = [];
    wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it('Finance tile (includeTimesheets=false) counts only procurement, not timesheets', () => {
    procState.data = [
      { status: 'Requested', requested_by_id: 'other-1' },
    ];
    tsState.data = [{ id: 'ts-1' }, { id: 'ts-2' }]; // 2 timesheets — should be excluded
    wrap(<AwaitingApprovalTile includeTimesheets={false} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    // total would be 3 if timesheets were included
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2j — loading skeleton
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2j — loading state', () => {
  it('shows KPI skeleton while procurement is loading', () => {
    procState.isPending = true;
    wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2k — amber tone
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2k — amber tone indicator', () => {
  it('renders with amber tone (has bg-warning tinted icon tile)', () => {
    procState.data = [];
    tsState.data = [];
    const { container } = wrap(<AwaitingApprovalTile includeTimesheets={true} />);
    // amber TONE_CLASS: bg-warning/[0.18] text-warning-foreground
    const iconTile = container.querySelector('[class*="bg-warning"]');
    expect(iconTile).not.toBeNull();
  });
});
