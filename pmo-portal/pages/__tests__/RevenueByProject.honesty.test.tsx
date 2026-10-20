import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
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
      | Array<{ project_id: string | null; project_name: string | null; currency: string; total_amount: number; open_ar: number; invoice_count: number }>
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

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname}{location.search}</output>;
};

const renderPage = (role: 'Admin' | 'Executive' | 'Finance' | 'Project Manager' = 'Executive') =>
  render(
    <I18nextProvider i18n={testI18n}>
      <ImpersonationProvider realRole={role}>
        <MemoryRouter initialEntries={['/revenue-by-project']}>
          <LocationProbe />
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
    expect(screen.getByText('Total Revenue (net of tax)')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows skeletons, not zeroes, while the revenue query is still loading', () => {
    revenueState.isPending = true;

    renderPage();

    expect(screen.queryAllByText('$0')).toHaveLength(0);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThanOrEqual(2);
  });

  it('reports the real totals once the data has actually loaded', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 4_000_000, open_ar: 250_000, invoice_count: 12 },
      { project_id: null, project_name: null, currency: 'USD', total_amount: 200_000, open_ar: 0, invoice_count: 3 },
    ];

    renderPage();

    // Tile value and the table's total row both carry the per-currency total.
    expect(screen.getAllByText('$4,200,000').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('$250,000').length).toBeGreaterThanOrEqual(2);
    // FIN-S6: the Total Invoices and Projects tiles are gone (two money tiles remain).
    expect(screen.queryByText('Total Invoices')).not.toBeInTheDocument();
    expect(screen.queryByText('Projects', { selector: 'p, span, div' })).not.toBeInTheDocument();
  });

  it('reports a genuine zero as $0 when the org truly has no invoices yet', () => {
    revenueState.data = [];

    renderPage();

    expect(screen.getByText('No revenue data yet')).toBeInTheDocument();
    expect(screen.getAllByText('$0').length).toBeGreaterThanOrEqual(2);
  });

  it('UX-010 tells a Project Manager that Finance owns invoice creation and keeps project browsing available', () => {
    revenueState.data = [];

    renderPage('Project Manager');

    // FIN-S6: no duplicate "Browse Projects" header button; the empty state still says who creates invoices.
    expect(screen.queryByRole('button', { name: 'Browse Projects' })).not.toBeInTheDocument();
    expect(screen.getByText(/Finance manages invoice creation/)).toBeInTheDocument();
    expect(screen.queryByText('Create sales invoices to see revenue per project.')).toBeNull();
  });

  it('UX-010 gives Finance a single New Invoice doorway from a truly empty revenue view', async () => {
    revenueState.data = [];
    const user = userEvent.setup();

    renderPage('Finance');

    const createInvoice = screen.getByRole('button', { name: 'New Invoice' });
    expect(createInvoice).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse Projects' })).toBeNull();
    await user.click(createInvoice);
    expect(screen.getByTestId('route-location')).toHaveTextContent('/sales-invoices?create=1');
  });

  it('UX-010 renders the Project Manager empty-state copy in Indonesian', async () => {
    revenueState.data = [];
    await testI18n.changeLanguage('id');

    renderPage('Project Manager');

    expect(screen.getByText(/Finance mengelola pembuatan faktur/)).toBeInTheDocument();
    await testI18n.changeLanguage('en');
  });

  it('AC-PFIN-009 / FIN-S6: the Unassigned row is one clickable row for every role (no separate Assign button); keyboard activation opens the unassigned list', async () => {
    revenueState.data = [
      { project_id: null, project_name: null, currency: 'USD', total_amount: 1200, open_ar: 1200, invoice_count: 1 },
    ];
    for (const role of ['Finance', 'Admin', 'Executive'] as const) {
      const view = renderPage(role);
      expect(screen.queryByRole('button', { name: 'Assign project' })).not.toBeInTheDocument();
      const openGroup = screen.getByRole('button', { name: 'Open Unassigned (USD)' });
      openGroup.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('route-location')).toHaveTextContent('/sales-invoices?attribution=unassigned');
      view.unmount();
    }
  });

  it('AC-801-001: describes the unassigned invoices in English and Indonesian without exposing a setting key', async () => {
    const { unmount } = renderPage();
    expect(screen.getByText(englishSubtitle)).toBeInTheDocument();
    expect(screen.queryByText(/process_gates\.require_project_on_si/)).not.toBeInTheDocument();

    unmount();
    await testI18n.changeLanguage('id');
    renderPage();

    expect(screen.getByText(indonesianSubtitle)).toBeInTheDocument();
    expect(screen.getByText('Total Pendapatan (di luar pajak)')).toBeInTheDocument();
    expect(screen.getByText('Piutang Terbuka (bruto, termasuk pajak)')).toBeInTheDocument();
    expect(screen.getByText('Pendapatan per Proyek')).toBeInTheDocument();
    expect(screen.queryByText(/process_gates\.require_project_on_si/)).not.toBeInTheDocument();
  });

  it('AC-802-001: does not render USD labels while the non-USD organization currency is unresolved', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 4_000, open_ar: 2_500, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'USD'; // useOrgCurrency's pending placeholder
    orgCurrencyState.isResolved = false;

    renderPage();

    expect(screen.queryAllByText(/^\$4,000(?:\.00)?$/)).toHaveLength(0);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThanOrEqual(2);
  });

  it('AC-802-001: formats resolved organization totals with the org currency', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 4_000, open_ar: 2_500, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'IDR';

    renderPage();

    expect(screen.getAllByText(/IDR[\s\u00a0]?4,000(?:\.00)?/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryAllByText(/^\$4,000(?:\.00)?$/)).toHaveLength(0);
  });

  it('AC-L10N-B03 formats finance totals with the id-ID number locale', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 1_234_567, open_ar: 12_345, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'IDR';
    await testI18n.changeLanguage('id');
    setActiveLocale(ID_LOCALE);

    renderPage();

    expect(screen.getAllByText('Rp\u00a01.234.567', { normalizer: (text) => text }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Rp\u00a012.345', { normalizer: (text) => text }).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('2 faktur')).not.toBeInTheDocument();
  });

  it('FIN-S6: no per-row "N invoices" sub-line, no second description line, no Currency column', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 0, invoice_count: 2 },
    ];
    renderPage();
    expect(screen.queryByText('2 invoices')).not.toBeInTheDocument();
    expect(screen.queryByText(/Billed work excludes tax; open receivables include tax owed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Currency' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Invoices' })).toBeInTheDocument();
  });

  it('AC-831-2: a project billed in two currencies shows two rows, each labelled with its own currency', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 0, invoice_count: 1 },
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 2_000_000, open_ar: 0, invoice_count: 1 },
    ];

    renderPage();

    expect(screen.getAllByText('$1,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/IDR[\s\u00a0]?2,000,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('AC-RF-040: labels net revenue and gross receivables without subtracting guessed VAT', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 250, open_ar: 275, invoice_count: 1 },
    ];

    renderPage();

    expect(screen.getAllByText('Total Revenue (net of tax)').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Open AR (gross, tax included)').length).toBeGreaterThanOrEqual(2);
    // T10: full amount, zero fraction suppressed; tabular, never monospace.
    expect(screen.getAllByText('$250').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('$275').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('td .font-mono')).toBeNull();
  });

  it('AC-831-3: the org-wide total never adds two currencies into one number', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 0, invoice_count: 1 },
      { project_id: 'p2', project_name: 'Beta', currency: 'IDR', total_amount: 2_000_000, open_ar: 0, invoice_count: 1 },
    ];

    renderPage();

    // One tile value carrying both per-currency totals; no 2,001,000 blend anywhere.
    expect(screen.getByText(/\$1,000 · IDR[\s\u00a0]?2,000,000/)).toBeInTheDocument();
    expect(screen.queryByText(/2,001,000/)).not.toBeInTheDocument();
  });
});
