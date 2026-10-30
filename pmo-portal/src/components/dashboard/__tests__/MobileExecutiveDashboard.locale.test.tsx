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
    renderCompanyDashboard('id');

    expect(screen.getByRole('link', { name: 'Buka catatan terkait untuk Kontrak berjalan.' })).toHaveAttribute('href', '/projects?filter=Ongoing');
    const risk = screen.getByRole('link', { name: /1 dari 7 proyek pekerjaan aktif berisiko/ });
    expect(risk).toHaveAttribute('href', '/projects?filter=at-risk');
    const help = screen.getByRole('button', { name: /Bantuan: Kontrak berjalan/ });
    fireEvent.focus(help);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/nilai kontrak/i);

    const spendList = screen.getByRole('list', { name: 'Pengeluaran dibandingkan kontrak' });
    expect(within(spendList).getByRole('link', { name: /Buka Alpha; pengeluaran tercatat/ })).toBeInTheDocument();
    expect(within(spendList).getByRole('progressbar', { name: 'Alpha: 50% kontrak terpakai' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentang pengeluaran dibandingkan kontrak' })).toBeInTheDocument();
  });

  it('formats the accessible spend with the configured number locale rather than the UI language', () => {
    dashboardHarness.dashboard!.top_projects = [
      { id: 'locale', name: 'Locale', contract_value: 3_000, currency: 'USD', spent: 1_500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
    ];
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    renderCompanyDashboard('id');
    const spendList = screen.getByRole('list', { name: 'Pengeluaran dibandingkan kontrak' });
    expect(within(spendList).getByRole('link', { name: /Locale.*US\$1\.500/ })).toBeInTheDocument();
    expect(within(spendList).queryByRole('link', { name: /US\$1,500/ })).not.toBeInTheDocument();
  });
});
