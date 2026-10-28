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
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';

const { fetchMock, upsertEtcMock, yearsMock, phasingMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  upsertEtcMock: vi.fn(),
  yearsMock: vi.fn(),
  phasingMock: vi.fn(),
}));

vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  fetchBudgetProjection: fetchMock,
  upsertBudgetProjectionEtc: upsertEtcMock,
  listBudgetFiscalYears: yearsMock,
  fetchActiveBudgetCategoryPhasing: phasingMock,
}));

import BudgetProjection from './BudgetProjection';
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

const renderForecast = ({ canEdit = true } = {}) => render(
  <FinanceI18nTestProvider>
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ToastProvider>
          <BudgetProjection
            projectId="proj-1"
            currency="USD"
            canEdit={canEdit}
            committedByCategory={{}}
            canReadCommitments
            onAdjustInDraft={vi.fn()}
            onExport={vi.fn()}
          />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  </FinanceI18nTestProvider>,
);

const rowFor = async (category: string) => (await screen.findByRole('row', { name: new RegExp(category) }));

beforeEach(async () => {
  fetchMock.mockReset();
  upsertEtcMock.mockReset();
  yearsMock.mockReset();
  phasingMock.mockReset();
  yearsMock.mockResolvedValue([
    { fiscalYear: ERP_FISCAL_YEAR, isActivePush: true },
    { fiscalYear: PRIOR_ERP_FISCAL_YEAR, isActivePush: false },
  ]);
  fetchMock.mockResolvedValue([ROW]);
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

  it('H-4 uses the client-listed fiscal year instead of the calendar year', async () => {
    renderForecast();
    await rowFor('Labor');
    expect(fetchMock).toHaveBeenCalledWith('proj-1', ERP_FISCAL_YEAR);
    expect(fetchMock).not.toHaveBeenCalledWith('proj-1', String(new Date().getFullYear()));
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue(ERP_FISCAL_YEAR);
  });

  it('AC-1424 defaults to the first listed year with recorded spending before a later active-push year', async () => {
    const firstWithSpending = 'FY-2026';
    const laterActivePush = 'FY-2028';
    yearsMock.mockResolvedValue([
      { fiscalYear: firstWithSpending, isActivePush: false },
      { fiscalYear: laterActivePush, isActivePush: true },
      { fiscalYear: 'FY-2024', isActivePush: false },
    ]);
    fetchMock.mockImplementation(async (_projectId: string, year: string) => {
      if (year === firstWithSpending) return [{ ...ROW, actualsToDate: 12_000 }];
      if (year === laterActivePush) return [{ ...ROW, actualsToDate: 95_000 }];
      return [{ ...ROW, actualsToDate: 0 }];
    });

    renderForecast();

    expect(await rowFor('Labor')).toHaveTextContent('$12,000');
    expect(screen.getByRole('combobox', { name: 'Fiscal year' })).toHaveValue(firstWithSpending);
    expect(fetchMock).toHaveBeenCalledWith('proj-1', firstWithSpending);
    expect(fetchMock).not.toHaveBeenCalledWith('proj-1', laterActivePush);
  });

  it('AC-1440 keeps forecast headers short and exposes their full meaning', async () => {
    renderForecast();
    await rowFor('Labor');

    const remaining = screen.getByRole('columnheader', { name: 'Forecast remaining' });
    expect(within(remaining).getByText('Remaining')).toBeInTheDocument();
    expect(within(remaining).getByText('Remaining')).toHaveAttribute('title', 'Forecast remaining');

    const used = screen.getByRole('columnheader', { name: 'Forecast budget used' });
    expect(within(used).getByText('% used')).toBeInTheDocument();
    expect(within(used).getByText('% used')).toHaveAttribute('title', 'Forecast budget used');
  });

  it('H-4 offers only fiscal years that exist for this project — never a synthesized calendar year', async () => {
    renderForecast();
    await rowFor('Labor');
    const options = Array.from((screen.getByRole('combobox', { name: 'Fiscal year' }) as HTMLSelectElement).options).map((o) => o.value);
    // '' is the "Whole project" choice, which reads no fiscal year at all.
    expect(options).toEqual(['', ERP_FISCAL_YEAR, PRIOR_ERP_FISCAL_YEAR]);
  });

  it('H-4 selecting another fiscal year reads THAT year', async () => {
    const user = userEvent.setup();
    renderForecast();
    await rowFor('Labor');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), PRIOR_ERP_FISCAL_YEAR);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('proj-1', PRIOR_ERP_FISCAL_YEAR));
  });

  it('H-4/C-3/MED-3 with no fiscal year on record it says so, shows no money grid, names the real route out and offers no edit', async () => {
    yearsMock.mockResolvedValue([]);
    renderForecast();
    expect(await screen.findByText('Choose a fiscal year to view the ERP forecast')).toBeInTheDocument();
    expect(screen.getByText(/Activate and push a budget version/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(row.getAllByText('—').length).toBeGreaterThanOrEqual(2);
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
    fetchMock.mockRejectedValue(new Error('boom'));
    renderForecast();
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
      { ...ROW, pmoBudgetAmount: 100000, projectedFinalCost: 95000, projectedVariance: 5000, projectedUtilization: 0.95 },
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
    fetchMock.mockResolvedValue([{ ...NO_BUDGET, actualsToDate: 12000, pmoEtc: 0, projectedFinalCost: 12000 }]);
    phasingMock.mockResolvedValue(phasing({ Materials: [ERP_FISCAL_YEAR] }));
    renderForecast();
    // HIGH-1 (second half): on the year the budget IS on record for, it is a missing line.
    expect(await screen.findByText('Labor: No budget line is recorded for this category.')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiscal year' }), PRIOR_ERP_FISCAL_YEAR);
    expect(await screen.findByText('Labor: No budget is recorded for this fiscal year.')).toBeInTheDocument();
    expect(within(await rowFor('Labor')).getAllByText('$12,000').length).toBeGreaterThan(0);
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

  it('I-3 saving also returns focus to the trigger, never to <body>', async () => {
    const user = await openEditor();
    await type(user, 'Materials', '45000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit cost to finish' })).toHaveFocus());
  });

  it('UX-039 the fiscal year is locked while the editor is open, so a save stays on the year it was opened for', async () => {
    const user = await openEditor();
    const year = screen.getByRole('combobox', { name: 'Fiscal year' });
    expect(year).toBeDisabled();
    await user.selectOptions(year, PRIOR_ERP_FISCAL_YEAR).catch(() => undefined);
    expect(year).toHaveValue(ERP_FISCAL_YEAR);
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
