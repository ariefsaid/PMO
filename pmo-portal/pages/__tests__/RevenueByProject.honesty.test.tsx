import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

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
  orgCurrencyState: { currency: 'USD', isResolved: true, isError: false },
}));
const revenueState = hoisted.revenueState;
const orgCurrencyState = hoisted.orgCurrencyState;

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => orgCurrencyState.currency,
  useOrgCurrencyState: () => orgCurrencyState,
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useRevenuePerProject: () => revenueState,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-exec', org_id: 'org-1' }, role: 'Executive' }),
}));

import RevenueByProject from '../RevenueByProject';

const testI18n = createInstance();
const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as {
  revenueByProject: { subtitle: string };
};
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as {
  revenueByProject: { subtitle: string };
};
const englishSubtitle = enCatalogue.revenueByProject.subtitle;
const indonesianSubtitle = idCatalogue.revenueByProject.subtitle;
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

beforeAll(async () => {
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      en: { common: enCatalogue },
      id: { common: idCatalogue },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const renderPage = () =>
  render(
    <I18nextProvider i18n={testI18n}>
      <ImpersonationProvider realRole="Executive">
        <MemoryRouter>
          <ToastProvider>
            <RevenueByProject />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </I18nextProvider>,
  );

beforeEach(async () => {
  await testI18n.changeLanguage('en');
  revenueState.data = undefined;
  revenueState.isPending = false;
  revenueState.isError = false;
  orgCurrencyState.currency = 'USD';
  orgCurrencyState.isResolved = true;
  orgCurrencyState.isError = false;
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

  it('AC-801-001: describes the unassigned invoices in English and Indonesian without exposing a setting key', async () => {
    const { unmount } = renderPage();
    expect(screen.getByText(englishSubtitle)).toBeInTheDocument();
    expect(screen.queryByText(/process_gates\.require_project_on_si/)).not.toBeInTheDocument();

    unmount();
    await testI18n.changeLanguage('id');
    renderPage();

    expect(screen.getByText(indonesianSubtitle)).toBeInTheDocument();
    expect(screen.getByText('Total Pendapatan')).toBeInTheDocument();
    expect(screen.getByText('Pendapatan per Proyek')).toBeInTheDocument();
    expect(screen.queryByText(/process_gates\.require_project_on_si/)).not.toBeInTheDocument();
  });

  it('AC-802-001: does not render USD labels while the non-USD organization currency is unresolved', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', total_amount: 4_000, open_ar: 2_500, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'USD'; // useOrgCurrency's pending placeholder
    orgCurrencyState.isResolved = false;

    renderPage();

    expect(screen.queryAllByText(/^\$4,000(?:\.00)?$/)).toHaveLength(0);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThanOrEqual(2);
  });

  it('AC-802-001: formats resolved organization totals with the org currency', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', total_amount: 4_000, open_ar: 2_500, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'IDR';

    renderPage();

    expect(screen.getAllByText(/IDR[\s\u00a0]?4,000(?:\.00)?/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryAllByText(/^\$4,000(?:\.00)?$/)).toHaveLength(0);
  });

  it('AC-L10N-B03 formats finance totals with the id-ID number locale', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', total_amount: 1_234_567, open_ar: 12_345, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'IDR';
    await testI18n.changeLanguage('id');
    setActiveLocale(ID_LOCALE);

    renderPage();

    expect(screen.getByText('Rp\u00a01.234.567', { normalizer: (text) => text })).toBeInTheDocument();
    expect(screen.getByText('Rp\u00a012.345', { normalizer: (text) => text })).toBeInTheDocument();
    expect(screen.getByText('2 faktur')).toBeInTheDocument();
  });

  it('AC-L10N-B03 uses localized singular and plural invoice counts in both catalogues', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', total_amount: 1_000, open_ar: 0, invoice_count: 1 },
      { project_id: 'p2', project_name: 'Beta', total_amount: 2_000, open_ar: 0, invoice_count: 2 },
    ];

    const { unmount } = renderPage();
    expect(screen.getByText('1 invoice')).toBeInTheDocument();
    expect(screen.getByText('2 invoices')).toBeInTheDocument();

    unmount();
    await testI18n.changeLanguage('id');
    renderPage();
    expect(screen.getByText('1 faktur')).toBeInTheDocument();
    expect(screen.getByText('2 faktur')).toBeInTheDocument();
  });
});
