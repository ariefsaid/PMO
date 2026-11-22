import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { IssueClosingTimeReportRow, IssueClosingReportSettings } from '@/src/lib/db/issueClosingReport';

const { reportState, settingsState, queryArgs } = vi.hoisted(() => ({
  reportState: {
    data: [] as IssueClosingTimeReportRow[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  settingsState: {
    data: { org_id: 'org1', enabled: true, grouping_mode: 'type', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', updated_by: null } as IssueClosingReportSettings | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  queryArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/src/hooks/useIssueClosingReport', () => ({
  useIssueClosingReportSettings: () => settingsState,
  useIssueClosingReport: (args: Record<string, unknown>, opts?: { enabled?: boolean }) => {
    queryArgs.push({ ...args, ...opts });
    return reportState;
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let mockPermission = true;
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => mockPermission,
}));

import ClosingTimeReport from './ClosingTimeReport';

const renderComponent = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ClosingTimeReport />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('ClosingTimeReport (AC-CTR-001 - AC-CTR-009)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermission = true;
    queryArgs.length = 0;
    settingsState.data = { org_id: 'org1', enabled: true, grouping_mode: 'type', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', updated_by: null };
    settingsState.isPending = false;
    settingsState.isError = false;
    reportState.data = [
      {
        department: 'Civil Works',
        total_issues: 10,
        closed_issues: 8,
        open_issues: 2,
        overdue_issues: 1,
        avg_closing_hours: 48.5,
        median_closing_hours: 36.0,
      },
      {
        department: 'Electrical',
        total_issues: 5,
        closed_issues: 5,
        open_issues: 0,
        overdue_issues: 0,
        avg_closing_hours: 12.0,
        median_closing_hours: 10.0,
      },
    ];
    reportState.isPending = false;
    reportState.isError = false;
  });

  it('renders loading state when settings query is pending', () => {
    settingsState.isPending = true;
    renderComponent();
    expect(screen.getByTestId('closing-report-loading')).toBeInTheDocument();
  });

  it('renders disabled notice when feature is turned off (AC-CTR-001)', () => {
    settingsState.data = { org_id: 'org1', enabled: false, grouping_mode: 'type', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', updated_by: null };
    renderComponent();
    expect(screen.getByTestId('closing-report-disabled')).toBeInTheDocument();
    expect(
      screen.getByText(/The closing-time report is not enabled for this organisation/i),
    ).toBeInTheDocument();

    const backBtn = screen.getAllByRole('button', { name: /Back to register/i })[0];
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/incidents');
  });

  it('renders title, KPI cards, and data table when enabled (AC-CTR-002, AC-CTR-003, AC-CTR-004)', () => {
    renderComponent();
    expect(screen.getByTestId('closing-time-report')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Issue closing-time report/i })).toBeInTheDocument();

    // KPI cards
    const kpiSection = screen.getByTestId('closing-report-kpis');
    expect(kpiSection).toHaveTextContent('15'); // Total issues (10 + 5)
    expect(kpiSection).toHaveTextContent('13'); // Closed issues (8 + 5)
    expect(kpiSection).toHaveTextContent('1'); // Stalled issues

    // Table rows
    expect(screen.getByText('Civil Works')).toBeInTheDocument();
    expect(screen.getByText('Electrical')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 days/i)).toBeInTheDocument(); // 48.5h formatted as 2.0 days
    expect(screen.getByText(/12 hrs/i)).toBeInTheDocument(); // 12.0h formatted as 12 hrs
  });

  it('allows switching date range presets (AC-CTR-005)', async () => {
    renderComponent();
    const btn90d = screen.getByTestId('preset-90d');
    await userEvent.click(btn90d);

    // Query args should have updated with 90d date window
    expect(queryArgs.length).toBeGreaterThan(1);
    const lastCall = queryArgs[queryArgs.length - 1];
    expect(lastCall.dateFrom).toBeDefined();
    expect(lastCall.dateTo).toBeDefined();
  });

  it('displays custom date inputs when custom preset is chosen (AC-CTR-005)', async () => {
    renderComponent();
    const btnCustom = screen.getByTestId('preset-custom');
    await userEvent.click(btnCustom);

    expect(screen.getByLabelText(/^From$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^To$/i)).toBeInTheDocument();
  });

  it('allows switching department grouping mode (AC-CTR-006)', async () => {
    renderComponent();
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, 'department_groups');

    const lastCall = queryArgs[queryArgs.length - 1];
    expect(lastCall.groupingMode).toBe('department_groups');
  });

  it('renders empty state when there are no issues in the period', () => {
    reportState.data = [];
    renderComponent();
    expect(screen.getByText(/No issue data in this period/i)).toBeInTheDocument();
  });

  it('renders error state and refetches on retry', async () => {
    reportState.isError = true;
    reportState.data = [];
    renderComponent();
    expect(screen.getByText(/Couldn't load report/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(retryBtn);
    expect(reportState.refetch).toHaveBeenCalled();
  });
});
