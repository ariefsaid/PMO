import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui/Toast';

/**
 * W2-4f — ExecutiveDashboard mobile approval count shows "—" on contributing-query error.
 * AC-W2-4-06: when useProcurements or useTimesheetsAwaitingApproval errors,
 *              mobile approval band shows "—" not fabricated 0.
 *
 * The mobile dashboard renders when useIsDesktop() returns false.
 */

const populated = {
  active_projects: 2,
  total_contract_value: 5000000,
  on_hand_margin: 0.8,
  on_hand_value: 4000000,
  pipeline_weighted_value: 500000,
  pipeline_projected_margin: 0.2,
  pipeline_total_value: 1000000,
  projects_at_risk: 0,
  projects_by_status: [{ status: 'Ongoing Project', count: 2 }],
  procurements_by_status: [{ status: 'Requested', count: 1 }],
  top_projects: [
    {
      id: 'p1', name: 'Alpha Project', client_name: 'ACME',
      contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project',
    },
  ],
};

const { procState, tsState } = vi.hoisted(() => ({
  procState: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: true,
  },
  tsState: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
  },
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({ data: populated, isPending: false, isError: false, refetch: vi.fn() }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
  useSalesPipeline: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => tsState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
// Force mobile rendering
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => false,
}));

import ExecutiveDashboard from '../ExecutiveDashboard';

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ExecutiveDashboard />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  procState.data = undefined;
  procState.isPending = false;
  procState.isError = true;
  tsState.data = undefined;
  tsState.isPending = false;
  tsState.isError = false;
});

describe('ExecutiveDashboard — mobile approval count on error (AC-W2-4-06)', () => {
  it('AC-W2-4-06: mobile approvals band shows "—" when procurements fetch errors (not 0)', () => {
    procState.isError = true;
    renderPage();

    const band = screen.getByTestId('mobile-approvals-band');
    // Should show em-dash, not 0
    expect(band).toHaveTextContent('—');
    expect(band).not.toHaveTextContent('0');
  });

  it('AC-W2-4-06: mobile approvals band shows "—" when timesheets fetch errors (not 0)', () => {
    procState.isError = false;
    procState.data = [];
    tsState.isError = true;
    renderPage();

    const band = screen.getByTestId('mobile-approvals-band');
    expect(band).toHaveTextContent('—');
    expect(band).not.toHaveTextContent('0');
  });

  it('shows numeric count when no error', () => {
    procState.isError = false;
    procState.data = [];
    tsState.isError = false;
    tsState.data = [];
    renderPage();

    const band = screen.getByTestId('mobile-approvals-band');
    // With no procurements or timesheets, shows "0" not "—"
    expect(band).toHaveTextContent('0');
    expect(band).not.toHaveTextContent('—');
  });
});
