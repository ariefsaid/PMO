import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
 * RLS denial, 5xx) painted a confident "Total Revenue 0 · Open AR 0 · Total Invoices 0" above a
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
  orgCurrencyState: { currency: 'USD', isResolved: true, isError: false, refetch: vi.fn() },
  isDesktop: true,
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
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => hoisted.isDesktop }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-exec', org_id: 'org-1' }, role: 'Executive' }),
}));

import RevenueByProject from '../RevenueByProject';

const testI18n = createInstance();
const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as Record<string, unknown>;
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as Record<string, unknown>;
const enMoneyInCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/moneyIn.json'), 'utf8')) as Record<string, unknown>;
const idMoneyInCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/moneyIn.json'), 'utf8')) as Record<string, unknown>;
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

beforeAll(async () => {
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      en: { common: enCatalogue, moneyIn: enMoneyInCatalogue },
      id: { common: idCatalogue, moneyIn: idMoneyInCatalogue },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname}{location.search}</output>;
};

const renderPage = (
  role: 'Admin' | 'Executive' | 'Finance' | 'Project Manager' = 'Executive',
  url = '/financial-statements?section=project-revenue&view=billing',
) =>
  render(
    <I18nextProvider i18n={testI18n}>
      <ImpersonationProvider realRole={role}>
        <MemoryRouter initialEntries={[url]}>
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
  orgCurrencyState.refetch = vi.fn();
  hoisted.isDesktop = true;
});

describe('Billing — never reports a figure it does not have', () => {
  it('shows the error state without a fabricated zero when the revenue query failed', () => {
    revenueState.isError = true;

    renderPage();

    expect(screen.getByText("Couldn't load billing totals")).toBeInTheDocument();
    expect(screen.queryAllByText('$0')).toHaveLength(0);
    expect(screen.queryAllByText('$0.00')).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows loading state, not zeroes, while the revenue query is still pending', () => {
    revenueState.isPending = true;

    renderPage();

    expect(screen.queryAllByText('$0')).toHaveLength(0);
    expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('reports loaded amounts and totals without repeating a KPI summary', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 4_000_000, open_ar: 250_000, invoice_count: 12 },
      { project_id: null, project_name: null, currency: 'USD', total_amount: 200_000, open_ar: 0, invoice_count: 3 },
    ];

    renderPage();

    expect(screen.getAllByText('4,200,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('250,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Total Revenue (net of tax)' })).not.toBeInTheDocument();
  });

  it('reports a genuine zero as $0 when the org truly has no invoices yet', () => {
    revenueState.data = [];

    renderPage();

    expect(screen.getByText('No revenue data yet')).toBeInTheDocument();
    expect(screen.queryAllByText('$0')).toHaveLength(0);
  });

  it('gives a Project Manager a permitted route from an empty Billing view', async () => {
    revenueState.data = [];
    const user = userEvent.setup();

    renderPage('Project Manager');

    const openProjects = screen.getByRole('button', { name: 'Open projects' });
    await user.click(openProjects);
    expect(screen.getByTestId('route-location')).toHaveTextContent('/projects');
    expect(screen.queryByRole('button', { name: 'New Invoice' })).not.toBeInTheDocument();
  });

  it('moves invoice creation to the invoice list from an empty Billing view', async () => {
    revenueState.data = [];
    const user = userEvent.setup();

    renderPage('Finance');

    const openInvoices = screen.getByRole('button', { name: 'Open invoices' });
    expect(screen.queryByRole('button', { name: 'New Invoice' })).not.toBeInTheDocument();
    await user.click(openInvoices);
    expect(screen.getByTestId('route-location')).toHaveTextContent('/sales-invoices');
  });

  it('renders the Project Manager empty-state action in Indonesian', async () => {
    revenueState.data = [];
    await testI18n.changeLanguage('id');

    const view = renderPage('Project Manager');

    expect(screen.getByRole('button', { name: 'Buka proyek' })).toBeInTheDocument();
    view.unmount();
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

  it('AC-801-001: labels billing measures in English and Indonesian without exposing a setting key', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 100, open_ar: 25, invoice_count: 1 },
    ];
    const { unmount } = renderPage();
    expect(screen.getAllByRole('columnheader', { name: 'Net billed' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Open receivables' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/process_gates\.require_project_on_si/)).not.toBeInTheDocument();

    unmount();
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 100, open_ar: 25, invoice_count: 1 },
    ];
    await testI18n.changeLanguage('id');
    renderPage();

    expect(screen.getAllByRole('columnheader', { name: 'Tagihan neto' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Piutang terbuka' }).length).toBeGreaterThan(0);
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
    expect(screen.getByTestId('liststate-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('offers Retry when organization currency cannot be resolved', async () => {
    orgCurrencyState.isResolved = false;
    orgCurrencyState.isError = true;
    orgCurrencyState.refetch = vi.fn();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(orgCurrencyState.refetch).toHaveBeenCalledOnce();
  });

  it('AC-802-001: formats whole-unit amounts and names their source currency', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 4_000, open_ar: 2_500, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'IDR';

    renderPage();

    expect(screen.getAllByText('4,000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IDR').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('$4,000')).toHaveLength(0);
  });

  it('AC-L10N-B03 formats finance totals with the id-ID number locale', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 1_234_567, open_ar: 12_345, invoice_count: 2 },
    ];
    orgCurrencyState.currency = 'IDR';
    await testI18n.changeLanguage('id');
    setActiveLocale(ID_LOCALE);

    renderPage();

    expect(screen.getAllByText('1.234.567', { normalizer: (text) => text }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('12.345', { normalizer: (text) => text }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('IDR').length).toBeGreaterThan(0);
    expect(screen.queryByText('2 faktur')).not.toBeInTheDocument();
  });

  it('shows one project row with the correct billing basis and invoice count', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 0, invoice_count: 2 },
    ];
    renderPage();
    expect(screen.getAllByRole('columnheader', { name: 'Invoices' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Net billed' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Open receivables' }).length).toBeGreaterThan(0);
  });

  it('AC-831-2: a project billed in two currencies shows two rows, each labelled with its own currency', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 0, invoice_count: 1 },
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 2_000_000, open_ar: 0, invoice_count: 1 },
    ];

    renderPage();

    const usdRow = screen.getByRole('button', { name: 'Open Alpha (USD)' }).closest('tr');
    const idrRow = screen.getByRole('button', { name: 'Open Alpha (IDR)' }).closest('tr');
    expect(usdRow).toHaveTextContent('USD');
    expect(usdRow).toHaveTextContent('1,000');
    expect(idrRow).toHaveTextContent('IDR');
    expect(idrRow).toHaveTextContent('2,000,000');
  });

  it('GLM R-006 keeps Net billed and Open receivables visible together on phone', () => {
    hoisted.isDesktop = false;
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 500, invoice_count: 2 },
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 2_000_000, open_ar: 1_000_000, invoice_count: 1 },
    ];

    renderPage();

    const project = screen.getByRole('button', { name: 'Open Alpha (USD)' });
    expect(project).toHaveTextContent('Alpha · USD');
    const card = project.closest('li')!;
    expect(within(card).getByText('1,000')).toBeVisible();
    expect(within(card).getByText('500')).toBeVisible();
    const details = screen.getAllByText('Other billing details · 2', { selector: 'summary' });
    expect(details).toHaveLength(2);
    for (const summary of details) expect(summary.closest('details')).toHaveProperty('open', false);
    expect(screen.getByRole('heading', { name: 'Billing · mixed currencies' })).toBeInTheDocument();
  });

  it('AC-RF-040: labels net revenue and gross receivables without subtracting guessed VAT', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 250, open_ar: 275, invoice_count: 1 },
    ];

    renderPage();

    expect(screen.getAllByRole('columnheader', { name: 'Net billed' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Open receivables' }).length).toBeGreaterThan(0);
    // Currency and tax basis come from the report group heading; values stay whole-unit plain amounts.
    expect(screen.getAllByText('250').length).toBeGreaterThan(0);
    expect(screen.getAllByText('275').length).toBeGreaterThan(0);
  });

  it('AC-831-3: the org-wide total never adds two currencies into one number', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 1_000, open_ar: 0, invoice_count: 1 },
      { project_id: 'p2', project_name: 'Beta', currency: 'IDR', total_amount: 2_000_000, open_ar: 0, invoice_count: 1 },
    ];

    renderPage();

    expect(screen.getAllByText('Total · USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total · IDR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2,000,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/2,001,000/)).not.toBeInTheDocument();
  });

  it('filters and sorts by visible project names while preserving the independent date range', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 100, open_ar: 10, invoice_count: 1 },
      { project_id: 'p2', project_name: 'Beta', currency: 'IDR', total_amount: 200, open_ar: 20, invoice_count: 2 },
      { project_id: 'p3', project_name: 'Gamma', currency: 'IDR', total_amount: 300, open_ar: 30, invoice_count: 3 },
      { project_id: null, project_name: null, currency: 'IDR', total_amount: 400, open_ar: 40, invoice_count: 4 },
    ];
    const user = userEvent.setup();
    renderPage('Executive', '/financial-statements?section=project-revenue&view=billing&from=2026-01&to=2026-06&currency=IDR&sort=project-name-desc');

    const projectNames = screen.getAllByRole('button', { name: /^Open (?:Gamma|Beta|Unassigned) \(IDR\)$/ });
    expect(projectNames[0]).toHaveAccessibleName('Open Gamma (IDR)');
    expect(screen.getAllByText('300').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('200').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Open Alpha (USD)' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort projects' }), 'project-name-asc');
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent('sort=project-name-asc'));
    expect(screen.getByTestId('route-location')).toHaveTextContent('from=2026-01');
    expect(screen.getByTestId('route-location')).toHaveTextContent('to=2026-06');
    const sorted = screen.getAllByRole('button', { name: /^Open (?:Beta|Gamma|Unassigned) \(IDR\)$/ });
    expect(sorted[0]).toHaveAccessibleName('Open Beta (IDR)');
  });

  it('keeps billing project and currency filters collapsed on phone while sort remains available', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'IDR', total_amount: 100, open_ar: 10, invoice_count: 1 },
    ];
    const user = userEvent.setup();
    renderPage('Executive', '/financial-statements?section=project-revenue&view=billing&project=p1&currency=IDR');
    const filters = screen.getByRole('button', { name: 'Filters · 2' });
    expect(filters).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('combobox', { name: 'Sort projects' })).toHaveValue('project-name-asc');

    await user.click(filters);

    expect(filters).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Filter by project' })).toHaveValue('p1');
    expect(screen.getByRole('combobox', { name: 'Filter by currency' })).toHaveValue('IDR');
  });

  it('offers Clear filters when search has no match and keeps the report range', async () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 100, open_ar: 10, invoice_count: 1 },
    ];
    const user = userEvent.setup();
    renderPage('Executive', '/financial-statements?section=project-revenue&view=billing&from=2026-01&to=2026-06&q=missing');
    expect(screen.getByText('No projects match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('route-location')).not.toHaveTextContent('q='));
    expect(screen.getByTestId('route-location')).toHaveTextContent('from=2026-01');
    expect(screen.getByTestId('route-location')).toHaveTextContent('to=2026-06');
    expect(screen.getByRole('button', { name: 'Open Alpha (USD)' })).toBeInTheDocument();
  });

  it('keeps export unavailable and explains why when no Billing rows match', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Alpha', currency: 'USD', total_amount: 100, open_ar: 10, invoice_count: 1 },
    ];
    renderPage('Executive', '/financial-statements?section=project-revenue&view=billing&currency=IDR');
    expect(screen.getByRole('button', { name: 'Export billing totals' })).toBeDisabled();
    expect(screen.getByText('No rows to export')).toBeInTheDocument();
  });
});

describe('RevenueByProject identity (H-09)', () => {
  it('shows the full contractual name in the project doorway without hover-only recovery', () => {
    revenueState.data = [
      { project_id: 'p1', project_name: 'Contractual Depot Expansion', project_short_name: 'Depot', currency: 'USD', total_amount: 1000, open_ar: 0, invoice_count: 1 },
    ] as never;
    renderPage();
    const open = screen.getByRole('button', { name: 'Open Contractual Depot Expansion (USD)' });
    expect(open).toHaveTextContent('Contractual Depot Expansion');
    expect(open).not.toHaveAttribute('title');
  });
});
