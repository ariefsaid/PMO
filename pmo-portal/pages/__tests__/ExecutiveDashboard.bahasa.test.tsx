import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { BahasaProvider } from '../../test/bahasa';
import { ProjectedMarginBars } from '../../src/components/dashboard/ProjectedMarginBars';
import { getDashboardHarness, renderCompanyDashboard, resetCompanyDashboardHarness } from '../../test/companyDashboardHarness';

const dashboardHarness = getDashboardHarness();

beforeEach(resetCompanyDashboardHarness);

describe('AC-UXA-003 redesigned company dashboard Bahasa coverage', () => {
  it('localizes pipeline loading, error and empty states', () => {
    dashboardHarness.pipelinePending = true;
    const { unmount } = renderCompanyDashboard('id');
    expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
    unmount();

    dashboardHarness.pipelinePending = false;
    dashboardHarness.pipelineError = true;
    const errorRender = renderCompanyDashboard('id');
    expect(screen.getByText('Tidak dapat memuat tahap pipeline')).toBeInTheDocument();
    errorRender.unmount();

    dashboardHarness.pipelineError = false;
    dashboardHarness.pipeline = { stages: [], projects: [] };
    renderCompanyDashboard('id');
    expect(screen.getByText('Belum ada tahap pipeline terbuka')).toBeInTheDocument();
  });

  it('localizes win-rate controls, chart names and risk/approval links', () => {
    dashboardHarness.pipeline = {
      stages: [{ status: 'Leads', count: 1, weighted_value: 500, total_value: 1_000 }],
      projects: [{ status: 'Leads', currency: 'USD', contract_value: 1_000 }],
    };
    dashboardHarness.needsItems = [{ id: 'approvals', count: 2, label: 'Persetujuan menunggu Anda', href: '/approvals', tone: 'warn' }];
    dashboardHarness.areaItems = [{ id: 'at-risk', count: 1, label: 'proyek berisiko', href: '/projects?filter=at-risk', tone: 'warn' }];
    renderCompanyDashboard('id');

    expect(screen.getByRole('button', { name: 'Menurut jumlah' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '12 bulan terakhir' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Nilai pipeline tertimbang per tahap' })).toBeInTheDocument();
    const chart = render(
      <BahasaProvider locale="id">
        <MemoryRouter><ProjectedMarginBars stages={[{ status: 'Leads', count: 1, total_value: 1_000, win_probability: 0.5, weighted_value: 500 }]} currency="USD" /></MemoryRouter>
      </BahasaProvider>,
    );
    expect(within(chart.container).getByRole('progressbar', { name: /Prospek: .* tertimbang/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /1 dari 7 proyek pekerjaan aktif berisiko/ })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.getByRole('link', { name: /2 Persetujuan menunggu Anda/ })).toHaveAttribute('href', '/approvals');
  });
});
