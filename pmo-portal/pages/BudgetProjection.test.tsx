/**
 * Budget forecast (the Forecast view of the project Budget tab). Re-created after the #1402
 * restructure deleted the previous file: every behaviour it pinned that the new component still
 * offers is asserted here against the shipped component; the push-state behaviours moved with the
 * notice to `project-detail/budget/BudgetErpNotice.test.tsx`.
 *
 * Only the repository seam is mocked; the money rows use the RPC's real shapes.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import enProjectTabs from '../public/locales/en/projectTabs.json';
import idProjectTabs from '../public/locales/id/projectTabs.json';

const { fetchMock, comparisonMock, upsertEtcMock, yearsMock, phasingMock, summaryMock, distributionMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  comparisonMock: vi.fn(),
  upsertEtcMock: vi.fn(),
  yearsMock: vi.fn(),
  phasingMock: vi.fn(),
  summaryMock: vi.fn(),
  distributionMock: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetProjection: fetchMock,
  fetchBudgetComparison: comparisonMock,
  upsertBudgetProjectionEtc: upsertEtcMock,
  listBudgetFiscalYears: yearsMock,
  fetchActiveBudgetCategoryPhasing: phasingMock,
  fetchFirstSpendingYear: summaryMock,
}));
vi.mock('@/src/hooks/useBudget', () => ({ useBudgetDistribution: distributionMock }));

import BudgetProjection from './BudgetProjection';
import type { BudgetProjectionExport } from '@/src/lib/budget/budgetProjectionExport';
import { useForecastEditor } from './budget-projection/useForecastEditor';
import { FinanceI18nTestProvider } from './__tests__/financeI18nTestProvider';
import { financeTestI18n } from './__tests__/financeI18nTestInstance';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };
// A Jul–Jun client: the fiscal year is the NAME the client declared, never a calendar year.
const ERP_FISCAL_YEAR = '2025-2026';
const PRIOR_ERP_FISCAL_YEAR = '2024-2025';
const READ_AT = '2026-03-04T09:00:00.000Z';

const ROW: BudgetProjectionCellRow = {
  category: 'Labor',
  pmoBudgetAmount: 100000,
  actualsToDate: 40000,
  actualsAsOf: READ_AT,
  pmoEtc: 35000,
  projectedFinalCost: 75000,
  projectedVariance: 25000,
  // get_budget_projection returns utilization as a FRACTION: (actuals + ETC) / budget (0290).
  projectedUtilization: 0.75,
  attributionKnown: true,
};

const phasing = (years: Record<string, string[]>, unphased: Record<string, true> = {}) => ({ years, unphased });

type ForecastRenderOptions = { canEdit?: boolean; budgetCurrency?: string; onExport?: (payload: BudgetProjectionExport) => void; projectId?: string; budgetMode?: string; approvedBudgetYears?: string[] };
const forecastTree = (options: Required<ForecastRenderOptions>, queryClient: QueryClient) => (
  <FinanceI18nTestProvider>
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BudgetProjection
            projectId={options.projectId}
            budgetVersionId="version-1"
            budgetMode={options.budgetMode}
            approvedBudgetYears={options.approvedBudgetYears}
            currency="USD"
            budgetCurrency={options.budgetCurrency}
            canEdit={options.canEdit}
            committedByCategory={{}}
            canReadCommitments
            onAdjustInDraft={vi.fn()}
            onExport={options.onExport}
          />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  </FinanceI18nTestProvider>
);
const renderForecast = (input: ForecastRenderOptions = {}) => {
  const options: Required<ForecastRenderOptions> = {
    canEdit: input.canEdit ?? true,
    budgetCurrency: input.budgetCurrency ?? 'USD',
    onExport: input.onExport ?? vi.fn<(payload: BudgetProjectionExport) => void>(),
    projectId: input.projectId ?? 'proj-1',
    budgetMode: input.budgetMode ?? 'per_year',
    approvedBudgetYears: input.approvedBudgetYears ?? [],
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(forecastTree(options, queryClient));
  return {
    ...view,
    queryClient,
    rerenderForecast: (next: ForecastRenderOptions) => view.rerender(forecastTree({ ...options, ...next }, queryClient)),
  };
};

const rowFor = async (category: string) => (await screen.findByRole('row', { name: new RegExp(category) }));

beforeEach(async () => {
  fetchMock.mockReset();
  comparisonMock.mockReset();
  upsertEtcMock.mockReset();
  yearsMock.mockReset();
  phasingMock.mockReset();
  summaryMock.mockReset();
  summaryMock.mockResolvedValue(ERP_FISCAL_YEAR);
  distributionMock.mockReset();
  distributionMock.mockReturnValue({ data: null, isSuccess: true, isPending: false, isError: false, refetch: vi.fn() });
  yearsMock.mockResolvedValue([
    { fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true },
  ]);
  fetchMock.mockResolvedValue([ROW]);
  comparisonMock.mockImplementation(async (projectId: string, fiscalYear: string | null) => {
    const readProjection = fetchMock.getMockImplementation();
    const projections = readProjection ? await readProjection(projectId, fiscalYear ?? '') : [ROW];
    return (projections as BudgetProjectionCellRow[]).map((row) => ({
      category: row.category,
      budgetTotal: row.pmoBudgetAmount,
      recorded: row.actualsToDate,
      recordedAsOf: row.actualsAsOf,
      mapped: row.actualsToDate !== null,
      hasLedger: row.actualsAsOf !== null,
      remaining: row.pmoBudgetAmount === null || row.actualsToDate === null ? null : row.pmoBudgetAmount - row.actualsToDate,
      percentUsed: row.pmoBudgetAmount === null || row.pmoBudgetAmount === 0 || row.actualsToDate === null ? null : row.actualsToDate / row.pmoBudgetAmount,
    }));
  });
  phasingMock.mockResolvedValue(phasing({ Labor: [ERP_FISCAL_YEAR] }));
  upsertEtcMock.mockResolvedValue(undefined);
  setActiveLocale(EN_LOCALE);
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

describe('BudgetProjection — the forward view (AC-BUD-050/051)', () => {
  it('renders the category row: budget, recorded spending, projected final and remaining', async () => {
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getByText('$100,000')).toBeInTheDocument();
    expect(row.getByText('$40,000')).toBeInTheDocument();
    expect(row.getByText('$75,000')).toBeInTheDocument();
    expect(row.getByText('$25,000')).toBeInTheDocument();
    expect(row.getByText('Watch')).toBeInTheDocument();
    expect(row.getByRole('progressbar', { name: /forecast utilization/i })).toHaveAttribute('aria-valuenow', '75');
  });

  it('keeps forecast inputs available and refuses comparisons across currency bases', async () => {
    const onExport = vi.fn<(payload: BudgetProjectionExport) => void>();
    renderForecast({ budgetCurrency: 'GBP', onExport });
    const row = within(await rowFor('Labor'));
    expect(row.getByText('£100,000')).toBeInTheDocument();
    expect(row.getByText('$40,000')).toBeInTheDocument();
    expect(row.getByText('$75,000')).toBeInTheDocument();
    expect(row.queryByText('$25,000')).not.toBeInTheDocument();
    expect(row.getByText('Unavailable')).toBeInTheDocument();
    expect(row.queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledWith({
      scope: { kind: 'year', year: ERP_FISCAL_YEAR },
      rows: [expect.objectContaining({ projectedVariance: null, projectedUtilization: null })],
    });
    await userEvent.click(screen.getByRole('row', { name: /Labor/ }));
    const drawer = screen.getByRole('dialog', { name: 'Labor' });
    expect(within(drawer).getByText('£100,000')).toBeInTheDocument();
    expect(within(drawer).queryByText('$25,000')).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit cost to finish' }));
    const input = screen.getByRole('textbox', { name: 'Cost to finish for Labor' });
    await userEvent.clear(input);
    await userEvent.type(input, '45000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 45000));
  });

  it('H-4 uses the client-listed fiscal year instead of the calendar year', async () => {
    renderForecast();
    await rowFor('Labor');
    expect(fetchMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR);
    expect(fetchMock).not.toHaveBeenCalledWith('proj-1', String(new Date().getFullYear()));
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue(JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR }));
  });

  it('AC-013 defaults a multi-year project to All years and loads comparison without a successful push', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: 'FY-2028', hasActiveBudget: false },
      { fiscalYear: 'FY-2027', hasActiveBudget: true },
    ]);
    comparisonMock.mockResolvedValue([{
      category: 'Labor', budgetTotal: 125000, recorded: 40000, recordedAsOf: READ_AT,
      mapped: true, hasLedger: true, remaining: 85000, percentUsed: 0.32,
    }]);
    renderForecast();
    expect(await rowFor('Labor')).toHaveTextContent('$125,000');
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue(JSON.stringify({ kind: 'all' }));
    expect(screen.getByRole('columnheader', { name: /Recorded spending as a share/ })).toBeInTheDocument();
    expect(screen.getByText('% recorded', { selector: 'dt' }).parentElement).toHaveTextContent('32%');
    expect(screen.queryByRole('columnheader', { name: 'Cost to finish' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Forecast final' })).not.toBeInTheDocument();
    expect(comparisonMock).toHaveBeenCalledWith('proj-1', null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('labels Active-version and saved line years as approved while leaving ledger-only years unmarked', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: 'FY-on-record', hasActiveBudget: true },
      { fiscalYear: 'FY-ledger-only', hasActiveBudget: false },
    ]);
    renderForecast({ approvedBudgetYears: ['FY-line-unpushed'] });
    const select = await screen.findByRole('combobox', { name: 'Fiscal year' });
    await screen.findByRole('option', { name: 'FY-on-record · approved budget' });
    expect(screen.getByRole('option', { name: 'FY-line-unpushed · approved budget' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'FY-ledger-only' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'FY-ledger-only · approved budget' })).not.toBeInTheDocument();
    expect(select).toHaveValue(JSON.stringify({ kind: 'all' }));
  });

  it('keeps unresolved fiscal years distinct from the explicit All years scope', async () => {
    let resolveYears!: (years: { fiscalYear: string; hasActiveBudget: boolean }[]) => void;
    yearsMock.mockReturnValue(new Promise((resolve) => { resolveYears = resolve; }));
    comparisonMock.mockResolvedValue([{ category: 'Labor', budgetTotal: 100, recorded: 40, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: 60, percentUsed: 0.4 }]);
    renderForecast();
    const select = screen.getByRole('combobox', { name: 'Fiscal year' });
    expect(select).toHaveValue('unresolved');
    expect(screen.getByRole('option', { name: 'Loading fiscal years' })).toBeDisabled();
    expect(comparisonMock).not.toHaveBeenCalled();

    await act(async () => resolveYears([{ fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true }]));
    await rowFor('Labor');
    expect(select).toHaveValue(JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR }));
    expect(comparisonMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR);
  });

  it('merges current calendar, approved distribution, and observed years without dropping an approved zero year', async () => {
    distributionMock.mockReturnValue({
      data: {
        basis: { years: [
          { name: 'FY-calendar-a', start: '2028-01-01', end: '2028-12-31' },
          { name: 'FY-calendar-b', start: '2029-01-01', end: '2029-12-31' },
        ] },
        rows: [{ fiscal_year: 'FY-approved-zero', ordinal: 0, category: 'Labor', amount: '0.00', method: 'by_days', is_override: false }],
      },
      isSuccess: true, isPending: false, isError: false, refetch: vi.fn(),
    });
    yearsMock.mockResolvedValue([{ fiscalYear: 'FY-observed', hasActiveBudget: false }]);
    comparisonMock.mockResolvedValue([]);
    renderForecast({ budgetMode: 'whole_project' });
    await screen.findByText('No approved budget or recorded spending is available yet');
    const values = Array.from((screen.getByRole('combobox', { name: 'Fiscal year' }) as HTMLSelectElement).options).map((option) => option.textContent);
    expect(values).toEqual([
      'All years (project to date)',
      'FY-calendar-a',
      'FY-calendar-b',
      'FY-approved-zero · approved budget',
      'FY-observed',
    ]);
    expect(distributionMock).toHaveBeenCalledWith('proj-1', 'version-1');
  });

  it('preserves an explicit year when the observed year list refetches', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: 'FY-A', hasActiveBudget: true },
      { fiscalYear: 'FY-B', hasActiveBudget: false },
    ]);
    comparisonMock.mockResolvedValue([{ category: 'Labor', budgetTotal: 10, recorded: 2, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: 8, percentUsed: 0.2 }]);
    const view = renderForecast();
    await rowFor('Labor');
    const select = screen.getByRole('combobox', { name: 'Fiscal year' });
    await userEvent.selectOptions(select, JSON.stringify({ kind: 'year', year: 'FY-A' }));
    view.queryClient.setQueryData(['budget-fiscal-years', 'proj-1'], [
      { fiscalYear: 'FY-C', hasActiveBudget: false },
      { fiscalYear: 'FY-A', hasActiveBudget: true },
      { fiscalYear: 'FY-B', hasActiveBudget: false },
    ]);
    await waitFor(() => expect(select).toHaveValue(JSON.stringify({ kind: 'year', year: 'FY-A' })));
  });

  it('uses the saved distribution to explain a whole-project category budgeted in another year', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: 'FY-A', hasActiveBudget: true },
      { fiscalYear: 'FY-B', hasActiveBudget: true },
    ]);
    distributionMock.mockReturnValue({
      data: {
        method: 'by_days', inputs: {}, categoryOverrides: {},
        basis: { projectStart: '2026-01-01', projectEnd: '2027-12-31', years: [
          { name: 'FY-A', start: '2026-01-01', end: '2026-12-31' },
          { name: 'FY-B', start: '2027-01-01', end: '2027-12-31' },
        ] },
        rows: [
          { category: 'Labor', fiscal_year: 'FY-A', ordinal: 0, amount: '50.00', method: 'by_days', is_override: false },
          { category: 'Labor', fiscal_year: 'FY-B', ordinal: 1, amount: '50.00', method: 'by_days', is_override: false },
        ],
      }, isSuccess: true, isPending: false, isError: false, refetch: vi.fn(),
    });
    comparisonMock.mockImplementation(async (_projectId: string, fiscalYear: string | null) => fiscalYear === 'FY-A'
      ? [{ category: 'Labor', budgetTotal: null, recorded: 10, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: null, percentUsed: null }]
      : [{ category: 'Labor', budgetTotal: 100, recorded: 10, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: 90, percentUsed: 0.1 }]);
    renderForecast({ budgetMode: 'whole_project' });
    await rowFor('Labor');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: 'FY-A' }));
    expect(await screen.findByText('Labor: Budgeted in another fiscal year: FY-B')).toBeInTheDocument();
  });

  it('resets the scope to the new project default after project identity changes', async () => {
    yearsMock.mockImplementation(async (projectId: string) => projectId === 'proj-a'
      ? [{ fiscalYear: 'FY-A', hasActiveBudget: true }, { fiscalYear: 'FY-B', hasActiveBudget: false }]
      : [{ fiscalYear: 'FY-C', hasActiveBudget: true }]);
    comparisonMock.mockResolvedValue([{ category: 'Labor', budgetTotal: 10, recorded: 2, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: 8, percentUsed: 0.2 }]);
    const view = renderForecast({ projectId: 'proj-a' });
    await rowFor('Labor');
    const select = screen.getByRole('combobox', { name: 'Fiscal year' });
    await userEvent.selectOptions(select, JSON.stringify({ kind: 'year', year: 'FY-A' }));
    expect(select).toHaveValue(JSON.stringify({ kind: 'year', year: 'FY-A' }));
    view.rerenderForecast({ projectId: 'proj-b' });
    await waitFor(() => expect(select).toHaveValue(JSON.stringify({ kind: 'year', year: 'FY-C' })));
  });

  it('AC-013 keeps explicit zero, unmapped spending, and an unread ledger distinct with provenance', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: 'FY-A', hasActiveBudget: true },
      { fiscalYear: 'FY-B', hasActiveBudget: false },
    ]);
    comparisonMock.mockResolvedValue([
      { category: 'Labor', budgetTotal: 0, recorded: 0, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: 0, percentUsed: null },
      { category: 'Equipment', budgetTotal: 20000, recorded: null, recordedAsOf: null, mapped: false, hasLedger: false, remaining: null, percentUsed: null },
      { category: 'Travel', budgetTotal: 50000, recorded: null, recordedAsOf: null, mapped: true, hasLedger: false, remaining: null, percentUsed: null },
    ]);
    const onExport = vi.fn<(payload: BudgetProjectionExport) => void>();
    renderForecast({ onExport });
    const labor = within(await rowFor('Labor'));
    expect(labor.getAllByText('$0').length).toBeGreaterThan(0);
    expect(labor.getByText('As of Mar 4, 2026')).toBeInTheDocument();
    expect(labor.getByText('Unavailable')).toBeInTheDocument();
    expect(within(await rowFor('Equipment')).getByText('No ledger account is mapped')).toBeInTheDocument();
    expect(within(await rowFor('Travel')).getByText('No ledger reading is available')).toBeInTheDocument();
    expect(screen.getByTestId('whole-project-unknown')).toHaveTextContent('Equipment');
    expect(screen.getByTestId('whole-project-unknown')).toHaveTextContent('Travel');
    expect(screen.getByText('% recorded', { selector: 'dt' }).parentElement).toHaveTextContent('Unavailable');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledWith({ scope: { kind: 'all' }, rows: expect.arrayContaining([
      expect.objectContaining({ category: 'Labor', budgetTotal: 0, recorded: 0 }),
      expect.objectContaining({ category: 'Equipment', budgetTotal: 20000, recorded: null }),
    ]) });
    const exportedRows = onExport.mock.calls[0][0].rows;
    expect(exportedRows[0]).not.toHaveProperty('pmoEtc');
    await userEvent.click(screen.getByRole('button', { name: 'Open Labor budget comparison' }));
    const drawer = screen.getByRole('dialog', { name: 'Labor' });
    expect(within(drawer).getAllByText('$0').length).toBeGreaterThan(0);
    expect(within(drawer).queryByText(/Cost to finish|Forecast final/)).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenLastCalledWith({ scope: { kind: 'all' }, rows: [expect.objectContaining({ category: 'Labor', budgetTotal: 0, recorded: 0 })] });
  });

  it('AC-013 suppresses all-year remaining and percent when budget and project currencies differ', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: 'FY-A', hasActiveBudget: true },
      { fiscalYear: 'FY-B', hasActiveBudget: false },
    ]);
    comparisonMock.mockResolvedValue([{ category: 'Labor', budgetTotal: 100000, recorded: 40000, recordedAsOf: READ_AT, mapped: true, hasLedger: true, remaining: 60000, percentUsed: 0.4 }]);
    renderForecast({ budgetCurrency: 'GBP' });
    const row = within(await rowFor('Labor'));
    expect(row.getByText('£100,000')).toBeInTheDocument();
    expect(row.getByText('$40,000')).toBeInTheDocument();
    expect(row.getByText('Unavailable')).toBeInTheDocument();
    expect(row.queryByText('$60,000')).not.toBeInTheDocument();
    expect(row.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('loads only the selected yearly forecast after opening a multi-year project in All years', async () => {
    const years = Array.from({ length: 40 }, (_, i) => ({ fiscalYear: `opaque-${i}`, hasActiveBudget: i === 0 }));
    yearsMock.mockResolvedValue(years);
    fetchMock.mockResolvedValue([ROW]);
    renderForecast();
    await rowFor('Labor');
    const select = screen.getByRole('combobox', { name: 'Fiscal year' });
    expect(select).toHaveValue(JSON.stringify({ kind: 'all' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.selectOptions(select, JSON.stringify({ kind: 'year', year: 'opaque-2' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('proj-1', 'opaque-2'));
    expect(comparisonMock).toHaveBeenCalledWith('proj-1', 'opaque-2');
  });

  it('keeps the existing year selection for a single-year project even without an active budget record', async () => {
    yearsMock.mockResolvedValue([{ fiscalYear: 'single-year', hasActiveBudget: false }]);
    renderForecast();
    await rowFor('Labor');
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue(JSON.stringify({ kind: 'year', year: 'single-year' }));
    expect(fetchMock).toHaveBeenCalledWith('proj-1', 'single-year');
  });

  it('surfaces a saved distribution read error without guessing a project scope', async () => {
    distributionMock.mockReturnValue({ data: null, isSuccess: false, isPending: false, isError: true, refetch: vi.fn() });
    renderForecast({ budgetMode: 'whole_project' });
    expect(await screen.findByText('Fiscal years could not be loaded')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['en', 'Remaining', 'Forecast remaining / (overrun)', '% used', 'Forecast budget used'],
    ['id', 'Sisa', 'Perkiraan sisa / (kelebihan)', '% terpakai', 'Perkiraan anggaran terpakai'],
  ])('AC-1440: keeps forecast headers short with their full meaning available in %s', async (locale, remaining, remainingMeaning, used, usedMeaning) => {
    // The redesigned page uses projectTabs for the short labels. Load the shipped locale files
    // into this focused finance test instance so the ID row proves the real user-facing strings.
    financeTestI18n.addResourceBundle('en', 'projectTabs', enProjectTabs, true, true);
    financeTestI18n.addResourceBundle('id', 'projectTabs', idProjectTabs, true, true);
    await financeTestI18n.changeLanguage(locale);
    renderForecast();
    const table = await screen.findByRole('table');
    const remainingHeader = table.querySelector('th[data-col-key="remaining"]') as HTMLElement;
    const usedHeader = table.querySelector('th[data-col-key="status"]') as HTMLElement;
    const remainingLabel = remainingHeader.querySelector('[title]');
    const usedLabel = usedHeader.querySelector('[title]');
    expect(remainingHeader).toHaveAccessibleName(remainingMeaning);
    expect(remainingLabel).toHaveAttribute('title', remainingMeaning);
    expect(remainingLabel).toHaveTextContent(remaining);
    expect(usedHeader).toHaveAccessibleName(usedMeaning);
    expect(usedLabel).toHaveAttribute('title', usedMeaning);
    expect(usedLabel).toHaveTextContent(used);
  });

  it('H-4 offers only fiscal years that exist for this project — never a synthesized calendar year', async () => {
    renderForecast();
    await rowFor('Labor');
    const options = Array.from((screen.getByRole('combobox', { name: 'Fiscal year' }) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual([JSON.stringify({ kind: 'all' }), JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR })]);
  });

  it('H-4 selecting another fiscal year reads THAT year', async () => {
    const user = userEvent.setup();
    yearsMock.mockResolvedValue([
      { fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true },
      { fiscalYear: PRIOR_ERP_FISCAL_YEAR, hasActiveBudget: false },
    ]);
    renderForecast();
    await rowFor('Labor');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: PRIOR_ERP_FISCAL_YEAR }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('proj-1', PRIOR_ERP_FISCAL_YEAR));
  });

  it('uses comparison approved and recorded values for a selected year while retaining ETC forecast math', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pmoBudgetAmount: 900000, actualsToDate: 800000, pmoEtc: 35000 }]);
    comparisonMock.mockResolvedValue([{
      category: 'Labor', budgetTotal: 100000, recorded: 30000, recordedAsOf: READ_AT,
      mapped: true, hasLedger: true, remaining: 70000, percentUsed: 0.3,
    }]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getByText('$100,000')).toBeInTheDocument();
    expect(row.getByText('$30,000')).toBeInTheDocument();
    expect(row.getByText('$65,000')).toBeInTheDocument();
    expect(row.getAllByText('$35,000').length).toBeGreaterThan(0);
    expect(row.queryByText('$900,000')).not.toBeInTheDocument();
    expect(row.queryByText('$800,000')).not.toBeInTheDocument();
    expect(comparisonMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR);
  });

  it('shows an honest empty all-years state when there are no categories and offers no year editor', async () => {
    yearsMock.mockResolvedValue([]);
    comparisonMock.mockResolvedValue([]);
    renderForecast();
    expect(await screen.findByText('No approved budget or recorded spending is available yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(comparisonMock).toHaveBeenCalledWith('proj-1', null);
    expect(screen.queryByText(/estimate to complete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit cost to finish/i })).not.toBeInTheDocument();
  });

  it('H-4 surfaces a failure to read the fiscal years rather than falling back to a guessed year', async () => {
    yearsMock.mockRejectedValue(new Error('boom'));
    renderForecast();
    expect(await screen.findByText('Fiscal years could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a null budget and utilization read as an explained dash, never 0 or blank', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pmoBudgetAmount: null, projectedVariance: null, projectedUtilization: null }]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getByText('—')).toBeInTheDocument();
    expect(row.getByText('-$75,000')).toBeInTheDocument();
    expect(row.getByText('Unavailable')).toBeInTheDocument();
    expect(row.queryByText('$0')).not.toBeInTheDocument();
    expect(row.queryByText('0%')).not.toBeInTheDocument();
  });

  it('shows a loading state and no figures while fetching', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderForecast();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('$100,000')).not.toBeInTheDocument();
  });

  it('shows an error state with retry on a failed fetch', async () => {
    const user = userEvent.setup();
    yearsMock.mockResolvedValue([
      { fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true },
      { fiscalYear: PRIOR_ERP_FISCAL_YEAR, hasActiveBudget: false },
    ]);
    renderForecast();
    await rowFor('Labor');

    // Let fiscal-year discovery and its default-year scan succeed first. Fail the user's
    // subsequent forecast read for a different listed year, so this exercises forecast Retry.
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR }));

    expect(await screen.findByText('Forecast could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('BudgetProjection — an unobtainable figure is never rendered as money (C-1/C-2/NEW-4)', () => {
  const unread = { ...ROW, actualsToDate: null, projectedFinalCost: null, projectedVariance: null, projectedUtilization: null };

  it('C-1 an unmapped category shows no actuals figure and no 0% — never a confident $0', async () => {
    fetchMock.mockResolvedValue([{ ...unread, category: 'Equipment', pmoBudgetAmount: 20000 }]);
    renderForecast();
    const row = within(await rowFor('Equipment'));
    expect(row.queryByText('$0')).not.toBeInTheDocument();
    expect(row.queryByText('0%')).not.toBeInTheDocument();
  });

  it('NEW-4 a never-read ledger shows no actuals figure, while the PMO budget is still stated', async () => {
    fetchMock.mockResolvedValue([{ ...unread, actualsAsOf: null }]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.queryByText('$0')).not.toBeInTheDocument();
    expect(row.getByText('$100,000')).toBeInTheDocument();
    expect(screen.queryByText(/Recorded spending as of/)).not.toBeInTheDocument();
  });

  it('C-1 a MAPPED category with an empty ledger still shows a real $0 — the distinction is the point', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, actualsToDate: 0, pmoEtc: 0, projectedFinalCost: 0, projectedVariance: 100000, projectedUtilization: 0 }]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getAllByText('$0').length).toBeGreaterThanOrEqual(1);
    expect(row.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('AC-PLC-005: dates the actuals reading on the viewer-timezone calendar day', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, actualsAsOf: '2026-06-14T23:30:00.000Z' }]);
    setActiveLocale({ ...EN_LOCALE, timezone: 'UTC' });
    const utc = renderForecast();
    expect(await screen.findByText(/Recorded spending as of Jun 14, 2026/)).toBeInTheDocument();
    utc.unmount();

    setActiveLocale({ ...EN_LOCALE, timezone: 'Asia/Jakarta' });
    renderForecast();
    expect(await screen.findByText(/Recorded spending as of Jun 15, 2026/)).toBeInTheDocument();
  });

  it('C-4 the spending column header uses business words and its source is stated on demand', async () => {
    const user = userEvent.setup();
    renderForecast();
    await rowFor('Labor');
    expect(screen.queryByRole('columnheader', { name: /ERP|ETC|PMO/ })).not.toBeInTheDocument();
    const spent = within(await rowFor('Labor')).getByText('$40,000').closest('[tabindex]') as HTMLElement;
    await user.hover(spent);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/ERP ledger through/);
  });

  it('UX-036 an unknown figure invalidates the totals that need it — never a partial sum shown as the total', async () => {
    fetchMock.mockResolvedValue([ROW, { ...unread, category: 'Travel', pmoBudgetAmount: 10000 }]);
    renderForecast();
    await rowFor('Travel');
    const totalRow = screen.getAllByRole('row').find((row) => /Total/.test(row.textContent ?? ''))!;
    expect(totalRow).toBeDefined();
    expect(totalRow).toHaveTextContent('$110,000');
    expect(totalRow).not.toHaveTextContent('$40,000');
    expect(totalRow).not.toHaveTextContent('$75,000');
  });

  it('T5 read-only money rounds to whole units and suppresses a zero fraction', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pmoBudgetAmount: 400000.5, actualsToDate: 180000 }]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getByText('$400,001')).toBeInTheDocument();
    expect(row.getByText('$180,000')).toBeInTheDocument();
  });

  it('UX-034/035 the totals row answers budget, recorded spending, cost to finish, forecast final and forecast remaining', async () => {
    fetchMock.mockResolvedValue([ROW, { ...ROW, category: 'Materials', pmoBudgetAmount: 50000, actualsToDate: 10000, pmoEtc: 5000, projectedFinalCost: 15000, projectedVariance: 35000, projectedUtilization: 0.3 }]);
    renderForecast();
    await rowFor('Materials');
    const totalRow = screen.getAllByRole('row').find((row) => /Total/.test(row.textContent ?? ''))!;
    for (const amount of ['$150,000', '$50,000', '$40,000', '$90,000', '$60,000']) expect(totalRow).toHaveTextContent(amount);
  });

  it('UX-035 an overrun is named an overrun', async () => {
    fetchMock.mockResolvedValue([{ ...ROW, pmoBudgetAmount: 400000, actualsToDate: 180000, pmoEtc: 250000, projectedFinalCost: 430000, projectedVariance: -30000, projectedUtilization: 1.075 }]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getByText('Over budget')).toBeInTheDocument();
    expect(row.getByText('-$30,000')).toBeInTheDocument();
  });

  it('reads the projection fraction as a percent: 0.95 is 95% and At risk, 0.75 is Watch', async () => {
    fetchMock.mockResolvedValue([
      { ...ROW, pmoBudgetAmount: 100000, actualsToDate: 60000, projectedFinalCost: 95000, projectedVariance: 5000, projectedUtilization: 0.95 },
    ]);
    renderForecast();
    const row = within(await rowFor('Labor'));
    expect(row.getByText('At risk')).toBeInTheDocument();
    expect(row.getByRole('progressbar', { name: /forecast utilization/i })).toHaveAttribute('aria-valuenow', '95');
  });

  it('UX-038 the percentage says it is forecast usage', async () => {
    renderForecast();
    await rowFor('Labor');
    expect(screen.getByRole('progressbar', { name: /forecast utilization/i })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^utilization$/i })).not.toBeInTheDocument();
  });
});

describe('BudgetProjection — a NULL budget says WHICH kind of absence it is', () => {
  const NO_BUDGET = { ...ROW, pmoBudgetAmount: null, projectedVariance: null, projectedUtilization: null };

  it('never claims "budgeted in another year" while a sibling line is un-placeable', async () => {
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, attributionKnown: false }]);
    phasingMock.mockResolvedValue(phasing({ Labor: ['2026-2027'] }, { Labor: true }));
    renderForecast();
    await screen.findByText(/Labor: Budget attribution is stale or incomplete/);
    const incomplete = screen.getByTestId('forecast-incomplete');
    expect(incomplete).toHaveTextContent(/Labor: Budget attribution is stale or incomplete/);
    expect(incomplete).not.toHaveTextContent(/Budgeted in another fiscal year/);
  });

  it('never says "no line" about a category that HAS lines, some of them un-placeable', async () => {
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, attributionKnown: false }]);
    phasingMock.mockResolvedValue(phasing({ Labor: [ERP_FISCAL_YEAR] }, { Labor: true }));
    renderForecast();
    await screen.findByText(/Review the line phasing/);
    const incomplete = screen.getByTestId('forecast-incomplete');
    expect(incomplete).toHaveTextContent(/Review the line phasing/);
    expect(incomplete).not.toHaveTextContent(/No budget line is recorded/);
  });

  it('does not blame staleness for a category that has no lines at all, and keeps its unbudgeted-spend alarm', async () => {
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, attributionKnown: true, projectedVariance: -75000 }]);
    phasingMock.mockResolvedValue(phasing({ Materials: [ERP_FISCAL_YEAR] }, { Materials: true }));
    renderForecast();
    await screen.findByText(/Labor: No budget line is recorded for this category/);
    const incomplete = screen.getByTestId('forecast-incomplete');
    expect(incomplete).toHaveTextContent(/Labor: No budget line is recorded for this category/);
    expect(incomplete).not.toHaveTextContent(/phasing/);
    expect(within(await rowFor('Labor')).getByText('-$75,000')).toBeInTheDocument();
  });
});

describe('BudgetProjection — a NULL budget, continued (HIGH-1, FU-2)', () => {
  const NO_BUDGET = { ...ROW, pmoBudgetAmount: null, projectedVariance: null, projectedUtilization: null };

  it('HIGH-1 says the budget is not on record for the selected year, and on the recorded year that the category has no line', async () => {
    // A late posting lands in a year the budget never covered; Labor has no line in any year.
    const user = userEvent.setup();
    yearsMock.mockResolvedValue([
      { fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true },
      { fiscalYear: PRIOR_ERP_FISCAL_YEAR, hasActiveBudget: false },
    ]);
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, actualsToDate: 12000, pmoEtc: 0, projectedFinalCost: 12000 }]);
    phasingMock.mockResolvedValue(phasing({ Materials: [ERP_FISCAL_YEAR] }));
    renderForecast();
    await screen.findByRole('option', { name: new RegExp(ERP_FISCAL_YEAR) });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR }));
    // HIGH-1 (second half): on the year the budget IS on record for, it is a missing line.
    expect(await screen.findByText('Labor: No budget line is recorded for this category.')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: PRIOR_ERP_FISCAL_YEAR }));
    expect(await screen.findByText('Labor: No budget is recorded for this fiscal year.')).toBeInTheDocument();
    expect(within(await rowFor('Labor')).getAllByText('$12,000').length).toBeGreaterThan(0);
  });

  it('makes no attribution claim when phasing cannot be read', async () => {
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, attributionKnown: false }]);
    phasingMock.mockRejectedValue(new Error('unavailable'));
    renderForecast();
    const incomplete = await screen.findByTestId('forecast-incomplete');
    await waitFor(() => expect(phasingMock).toHaveBeenCalled());
    expect(incomplete).not.toHaveTextContent(/cannot be attributed|stale|No budget|another fiscal year/);
    expect(within(await rowFor('Labor')).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('makes NO claim while the phasing fact is still in flight — never a transient false reason', async () => {
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, attributionKnown: false }]);
    let deliver!: (value: ReturnType<typeof phasing>) => void;
    phasingMock.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
    renderForecast();
    const incomplete = await screen.findByTestId('forecast-incomplete');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(incomplete).not.toHaveTextContent(/cannot be attributed|stale|No budget/);

    await act(async () => { deliver(phasing({ Labor: ['2026-2027'] })); });
    expect(await screen.findByText('Labor: Budgeted in another fiscal year: 2026-2027')).toBeInTheDocument();
    expect(screen.getByTestId('forecast-incomplete')).not.toHaveTextContent(/cannot be attributed/);
  });
});

describe('BudgetProjection — cost to finish editing (OD-BUDGET-3, UX-039)', () => {
  const MATERIALS = { ...ROW, category: 'Materials' as const, pmoEtc: 30000 };
  const openEditor = async (rows = [ROW, MATERIALS]) => {
    fetchMock.mockResolvedValue(rows);
    const user = userEvent.setup();
    renderForecast();
    await screen.findByRole('option', { name: new RegExp(ERP_FISCAL_YEAR) });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR }));
    await user.click(await screen.findByRole('button', { name: 'Edit cost to finish' }));
    return user;
  };
  const type = async (user: ReturnType<typeof userEvent.setup>, category: string, value: string) => {
    const field = screen.getByRole('textbox', { name: `Cost to finish for ${category}` });
    await user.clear(field);
    await user.type(field, value);
    return field;
  };

  it('saves only the changed category against the selected fiscal year', async () => {
    const user = await openEditor();
    await type(user, 'Materials', '45000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledTimes(1));
    expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Materials', 45000);
  });

  it('retains typing during a partial save and retries only unsaved changes in the same year', async () => {
    let finish!: () => void;
    upsertEtcMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const user = await openEditor();
    await type(user, 'Labor', '41000');
    await type(user, 'Materials', '42000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 41000);
    await type(user, 'Labor', '43000');
    await act(async () => finish());
    await screen.findByText(/Not saved: Materials/);
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveValue('43000');
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Materials' })).toHaveValue('42000');
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry failed edits' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledTimes(4));
    expect(upsertEtcMock.mock.calls.slice(2)).toEqual([
      ['proj-1', ERP_FISCAL_YEAR, 'Labor', 43000],
      ['proj-1', ERP_FISCAL_YEAR, 'Materials', 42000],
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toHaveFocus());
  });

  it('keeps newer typing open after a successful pending save', async () => {
    let finish!: () => void;
    upsertEtcMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const user = await openEditor([ROW]);
    await type(user, 'Labor', '41000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await type(user, 'Labor', '43000');
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveValue('43000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenLastCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 43000));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toHaveFocus());
  });

  it('keeps a new editor session intact when a cancelled save finishes', async () => {
    let finish!: () => void;
    upsertEtcMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const user = await openEditor([ROW]);
    await type(user, 'Labor', '41000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit cost to finish' }));
    await type(user, 'Labor', '43000');
    await act(async () => finish());
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveValue('43000');
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveFocus();
  });

  it('waits for a cancelled write before saving the newer session value', async () => {
    let finish!: () => void;
    let stored = 35000;
    upsertEtcMock.mockImplementation(async (_project, _year, _category, amount) => {
      if (amount === 41000) await new Promise<void>((resolve) => { finish = resolve; });
      stored = amount;
    });
    const user = await openEditor([ROW]);
    await type(user, 'Labor', '41000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit cost to finish' }));
    await type(user, 'Labor', '43000');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(stored).toBe(43000));
    expect(upsertEtcMock.mock.calls.map((call) => call[3])).toEqual([41000, 43000]);
  });

  it('saves the reopened baseline if the cancelled write changed it', async () => {
    let finish!: () => void;
    upsertEtcMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const user = await openEditor([ROW]);
    await type(user, 'Labor', '41000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit cost to finish' }));
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenLastCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 35000));
  });

  it('keeps a different-year session intact when the cancelled write fails late', async () => {
    let fail!: (reason: Error) => void;
    upsertEtcMock.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FinanceI18nTestProvider><QueryClientProvider client={client}>{children}</QueryClientProvider></FinanceI18nTestProvider>
    );
    const { result, rerender } = renderHook(({ project, year }) => useForecastEditor(project, year, [ROW]), {
      wrapper, initialProps: { project: 'proj-1', year: ERP_FISCAL_YEAR },
    });
    act(() => result.current.beginEdit());
    act(() => result.current.changeDraft('Labor', '41000'));
    act(() => result.current.saveEdits());
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledTimes(1));
    act(() => result.current.cancelEdit());
    rerender({ project: 'proj-2', year: PRIOR_ERP_FISCAL_YEAR });
    act(() => result.current.beginEdit());
    act(() => result.current.changeDraft('Labor', '43000'));
    act(() => result.current.saveEdits());
    expect(upsertEtcMock).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error('offline')));
    await waitFor(() => expect(result.current.save.isPending).toBe(false));
    expect(result.current.editing).toBe(true);
    expect(result.current.draft.Labor).toBe('43000');
    expect(result.current.errors).toEqual({});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['budget-projection', 'proj-1', ERP_FISCAL_YEAR] });
    expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 41000);
  });

  it('retries only the failed entry and then saves a separately selected year', async () => {
    upsertEtcMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    yearsMock.mockResolvedValue([
      { fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true },
      { fiscalYear: PRIOR_ERP_FISCAL_YEAR, hasActiveBudget: false },
    ]);
    const user = await openEditor();
    await type(user, 'Labor', '41000');
    await type(user, 'Materials', '42000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Not saved: Materials/);
    await user.click(screen.getByRole('button', { name: 'Retry failed edits' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toHaveFocus());
    expect(upsertEtcMock.mock.calls).toEqual([
      ['proj-1', ERP_FISCAL_YEAR, 'Labor', 41000],
      ['proj-1', ERP_FISCAL_YEAR, 'Materials', 42000],
      ['proj-1', ERP_FISCAL_YEAR, 'Materials', 42000],
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), JSON.stringify({ kind: 'year', year: PRIOR_ERP_FISCAL_YEAR }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('proj-1', PRIOR_ERP_FISCAL_YEAR));
    await user.click(await screen.findByRole('button', { name: 'Edit cost to finish' }));
    await type(user, 'Labor', '44000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenLastCalledWith('proj-1', PRIOR_ERP_FISCAL_YEAR, 'Labor', 44000));
  });

  it('I-2 UX-039 there is ONE edit trigger for the whole table, never one per category', async () => {
    fetchMock.mockResolvedValue([ROW, MATERIALS]);
    renderForecast();
    await rowFor('Materials');
    expect(screen.getAllByRole('button', { name: /edit cost to finish/i })).toHaveLength(1);
  });

  it('I-3 opening the editor moves focus INTO it, and cancelling returns focus to the trigger', async () => {
    const user = await openEditor();
    expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toHaveFocus());
  });

  it('moves focus into the editor when the forecast renders as narrow cards', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390, height: 100, x: 0, y: 0, top: 0, bottom: 100, left: 0, right: 390, toJSON: () => ({}) });
    try {
      await openEditor();
      expect(screen.getByRole('textbox', { name: 'Cost to finish for Labor' })).toHaveFocus();
    } finally { rect.mockRestore(); }
  });

  it('I-3 saving also returns focus to the trigger, never to <body>', async () => {
    const user = await openEditor();
    await type(user, 'Materials', '45000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toHaveFocus());
  });

  it('UX-039 the fiscal year is locked while the editor is open, so a save stays on the year it was opened for', async () => {
    yearsMock.mockResolvedValue([
      { fiscalYear: ERP_FISCAL_YEAR, hasActiveBudget: true },
      { fiscalYear: PRIOR_ERP_FISCAL_YEAR, hasActiveBudget: false },
    ]);
    const user = await openEditor();
    const year = screen.getByRole('combobox', { name: 'Fiscal year' });
    expect(year).toBeDisabled();
    await user.selectOptions(year, JSON.stringify({ kind: 'year', year: PRIOR_ERP_FISCAL_YEAR })).catch(() => undefined);
    expect(year).toHaveValue(JSON.stringify({ kind: 'year', year: ERP_FISCAL_YEAR }));
    await type(user, 'Materials', '45000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Materials', 45000));
    expect(upsertEtcMock).not.toHaveBeenCalledWith('proj-1', PRIOR_ERP_FISCAL_YEAR, expect.anything(), expect.anything());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toBeEnabled());
  });

  it('AC-PLC-009: rejects an en-US amount with excess precision before any write', async () => {
    const user = await openEditor([ROW]);
    await type(user, 'Labor', '1.234');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a non-negative amount with up to 2 decimal places.')).toBeInTheDocument();
    expect(upsertEtcMock).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: parses id-ID grouping "1.234" as 1234 before the write', async () => {
    setActiveLocale(ID_LOCALE);
    const user = await openEditor([ROW]);
    await type(user, 'Labor', '1.234');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(upsertEtcMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR, 'Labor', 1234));
  });

  it('I-4 an invalid row blocks the whole save, marks the field invalid and wires the message to it', async () => {
    const user = await openEditor();
    await type(user, 'Labor', '1000');
    const field = await type(user, 'Materials', '-5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const message = await screen.findByText('Enter a non-negative amount with up to 2 decimal places.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby') ?? '').toContain(message.id || message.closest('[id]')?.id || '__missing__');
    expect(upsertEtcMock).not.toHaveBeenCalled();
  });

  it('cancel discards every draft and writes nothing', async () => {
    const user = await openEditor();
    await type(user, 'Labor', '1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(upsertEtcMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Cost to finish for Labor' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toBeInTheDocument();
  });

  it('no edit affordance without the budgetLine edit right', async () => {
    fetchMock.mockResolvedValue([ROW]);
    renderForecast({ canEdit: false });
    await rowFor('Labor');
    expect(screen.queryByRole('button', { name: /edit cost to finish/i })).not.toBeInTheDocument();
  });
});

describe('BudgetProjection — Bahasa (AC-CAT-005, AC-L10N-B01)', () => {
  it('localizes categories and the edit control without changing the amounts', async () => {
    await financeTestI18n.changeLanguage('id');
    fetchMock.mockResolvedValue([{ ...ROW, category: 'Special expenses' }]);
    renderForecast();
    expect(await screen.findByText('Biaya khusus')).toBeInTheDocument();
    expect(within(await rowFor('Biaya khusus')).getByText('$100,000')).toBeInTheDocument();
    expect(screen.queryByText('Special expenses')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit cost to finish' })).not.toBeInTheDocument();
  });
});
