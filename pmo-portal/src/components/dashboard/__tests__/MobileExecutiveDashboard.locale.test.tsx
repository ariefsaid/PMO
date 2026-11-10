import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { getDashboardHarness, renderCompanyDashboard, resetCompanyDashboardHarness } from '@/test/companyDashboardHarness';

const dashboardHarness = getDashboardHarness();

beforeEach(() => {
  resetCompanyDashboardHarness();
  dashboardHarness.today = [{ id: 'contract-on-hand', label: 'Kontrak berjalan', value: '$1.000', amounts: [{ currency: 'USD', amount: 1_000 }], href: '/projects?filter=Ongoing' }];
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
});
afterEach(resetActiveLocale);

describe('redesigned mobile dashboard accessible names in Bahasa', () => {
  it('keeps the contract figure link, page help, section headings and plan-vs-actual labels in Bahasa', async () => {
    dashboardHarness.dashboard!.top_projects = [
      { id: 'alpha', name: 'Alpha', contract_value: 3_000, currency: 'USD', spent: 1_500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
    ];
    renderCompanyDashboard('id');

    expect(screen.getByRole('link', { name: /Kontrak berjalan/ })).toHaveAttribute('href', '/projects?filter=Ongoing');
    expect(screen.getByRole('heading', { name: 'Proyek menyimpang' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Tentang / })).toHaveLength(1);

    fireEvent.click(screen.getByText('Analisis'));
    expect(await screen.findByRole('img', { name: 'Rencana vs realisasi per proyek' })).toBeInTheDocument();
  });

  it('formats the chart figures for screen readers with the configured number locale rather than the UI language', async () => {
    dashboardHarness.dashboard!.top_projects = [
      { id: 'locale', name: 'Locale', contract_value: 3_000, currency: 'USD', spent: 1_500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
    ];
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    renderCompanyDashboard('id');
    fireEvent.click(screen.getByText('Analisis'));
    const table = await screen.findByRole('table', { name: 'Rencana vs realisasi per proyek' });
    expect(within(table).getByText('US$1.500')).toBeInTheDocument();
    expect(within(table).queryByText('US$1,500')).not.toBeInTheDocument();
  });
});
