import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { getDashboardHarness, renderCompanyDashboard, resetCompanyDashboardHarness } from '@/test/companyDashboardHarness';

const dashboardHarness = getDashboardHarness();

beforeEach(() => {
  resetCompanyDashboardHarness();
  dashboardHarness.today = [{ id: 'contract-on-hand', label: 'Kontrak berjalan', value: '$1.000', href: '/projects?filter=Ongoing' }];
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
});
afterEach(resetActiveLocale);

describe('redesigned mobile dashboard accessible names in Bahasa', () => {
  it('keeps the contract-book name, risk doorway, figure help and spend labels in Bahasa', () => {
    dashboardHarness.areaItems = [{ id: 'at-risk', count: 1, label: 'proyek berisiko', href: '/projects?filter=at-risk', tone: 'warn' }];
    dashboardHarness.dashboard!.top_projects = [
      { id: 'alpha', name: 'Alpha', contract_value: 3_000, currency: 'USD', spent: 1_500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
    ];
    renderCompanyDashboard('id');

    expect(screen.getByRole('link', { name: 'Buka catatan terkait untuk Kontrak berjalan.' })).toHaveAttribute('href', '/projects?filter=Ongoing');
    const risk = screen.getByRole('link', { name: /1 dari 7 proyek pekerjaan aktif berisiko/ });
    expect(risk).toHaveAttribute('href', '/projects?filter=at-risk');
    const help = screen.getByRole('button', { name: /Bantuan: Kontrak berjalan/ });
    fireEvent.focus(help);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/nilai kontrak/i);

    expect(screen.getByRole('heading', { name: 'Perlu perhatian' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentang Perlu perhatian' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Rencana vs realisasi per proyek' })).toBeInTheDocument();
  });

  it('formats the chart figures for screen readers with the configured number locale rather than the UI language', () => {
    dashboardHarness.dashboard!.top_projects = [
      { id: 'locale', name: 'Locale', contract_value: 3_000, currency: 'USD', spent: 1_500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
    ];
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    renderCompanyDashboard('id');
    const table = screen.getByRole('table', { name: 'Rencana vs realisasi per proyek' });
    expect(within(table).getByText('US$1.500')).toBeInTheDocument();
    expect(within(table).queryByText('US$1,500')).not.toBeInTheDocument();
  });
});
