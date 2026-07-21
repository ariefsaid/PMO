import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * Revenue by Project — the no-fabricated-zero rule (read-model audit BLOCK 2).
 *
 * The KPI tiles were rendered unconditionally off `data ?? []`, so a FAILED query (network blip,
 * RLS denial, 5xx) painted a confident "Total Revenue $0 · Open AR $0 · Total Invoices 0" above a
 * small error card — an exec glancing at the top reads $0 for an org that may bill millions.
 * `AccountingSnapshotsSection` states this exact rule ("never a fabricated $0.00"); these tests
 * hold this page to it.
 */

const hoisted = vi.hoisted(() => ({
  revenueState: {
    data: undefined as
      | Array<{ project_id: string | null; project_name: string | null; total_amount: number; open_ar: number; invoice_count: number }>
      | undefined,
    isPending: false,
    isError: false,
  },
}));
const revenueState = hoisted.revenueState;

vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => revenueState,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-exec', org_id: 'org-1' }, role: 'Executive' }),
}));

import RevenueByProject from '../RevenueByProject';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Executive">
      <MemoryRouter>
        <ToastProvider>
          <RevenueByProject />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  revenueState.data = undefined;
  revenueState.isPending = false;
  revenueState.isError = false;
});

describe('RevenueByProject — never reports a figure it does not have (BLOCK 2)', () => {
  it('shows NO money figure when the revenue query failed — not a confident $0', () => {
    revenueState.isError = true;

    renderPage();

    expect(screen.getByText("Couldn't load revenue data")).toBeInTheDocument();
    // Not one fabricated zero anywhere on the page.
    expect(screen.queryAllByText('$0')).toHaveLength(0);
    expect(screen.queryAllByText('$0.00')).toHaveLength(0);
    // The tiles stay, honestly blank (em-dash), so the layout doesn't jump.
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('shows skeletons, not zeroes, while the revenue query is still loading', () => {
    revenueState.isPending = true;

    renderPage();

    expect(screen.queryAllByText('$0')).toHaveLength(0);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThanOrEqual(3);
  });

  it('reports the real totals once the data has actually loaded', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', total_amount: 4_000_000, open_ar: 250_000, invoice_count: 12 },
      { project_id: null, project_name: null, total_amount: 200_000, open_ar: 0, invoice_count: 3 },
    ];

    renderPage();

    expect(screen.getByText('$4,200,000')).toBeInTheDocument();
    expect(screen.getByText('$250,000')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('reports a genuine zero as $0 when the org truly has no invoices yet', () => {
    revenueState.data = [];

    renderPage();

    expect(screen.getByText('No revenue data yet')).toBeInTheDocument();
    expect(screen.getAllByText('$0').length).toBeGreaterThanOrEqual(2);
  });
});
