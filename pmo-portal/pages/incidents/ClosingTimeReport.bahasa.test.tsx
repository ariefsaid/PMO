import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
import type { IssueClosingTimeReportRow, IssueClosingReportSettings } from '@/src/lib/db/issueClosingReport';

const reportData: IssueClosingTimeReportRow[] = [
  {
    department: 'Sipil',
    total_issues: 4,
    closed_issues: 3,
    open_issues: 1,
    overdue_issues: 1,
    avg_closing_hours: 36,
    median_closing_hours: 24,
  },
];

const settingsData: IssueClosingReportSettings = { org_id: 'org1', enabled: true, grouping_mode: 'type', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', updated_by: null };

vi.mock('@/src/hooks/useIssueClosingReport', () => ({
  useIssueClosingReportSettings: () => ({ data: settingsData, isPending: false, isError: false }),
  useIssueClosingReport: () => ({ data: reportData, isPending: false, isError: false }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

import ClosingTimeReport from './ClosingTimeReport';

describe('ClosingTimeReport in Bahasa (#2678)', () => {
  it('renders title, KPI labels, and column headers in Bahasa Indonesia', () => {
    render(
      <BahasaProvider>
        <MemoryRouter>
          <ToastProvider>
            <ClosingTimeReport />
          </ToastProvider>
        </MemoryRouter>
      </BahasaProvider>,
    );

    // Title in Bahasa
    expect(screen.getByRole('heading', { level: 1, name: 'Laporan waktu penyelesaian isu' })).toBeInTheDocument();

    // KPI labels
    expect(screen.getByText('Total isu')).toBeInTheDocument();
    expect(screen.getByText('Isu ditutup')).toBeInTheDocument();
    expect(screen.getByText('Rata-rata waktu penyelesaian')).toBeInTheDocument();
    expect(screen.getByText('Isu terhenti')).toBeInTheDocument();

    // Column headers
    expect(screen.getByRole('columnheader', { name: 'Departemen' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Ditutup' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Terbuka' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Terhenti' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Rata-rata waktu tutup' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Median waktu tutup' })).toBeInTheDocument();
  });
});
