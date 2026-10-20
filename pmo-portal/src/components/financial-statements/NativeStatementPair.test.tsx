import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'jest-axe';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FinancialStatementsSection } from './FinancialStatementsSection';
import { NativeStatementPair } from './NativeStatementPair';
import type { NativeReportColumn, NativeReportScalar, StatementReportPair, StatementReportPeriod } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { getActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const localeBeforeTest = getActiveLocale();

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveLocale(localeBeforeTest);
});

const periodPair = {
  current: {
    fromDate: '2025-01-01', toDate: '2025-01-31',
    fromFiscalYear: 'FY 2025', toFiscalYear: 'FY 2025', kind: 'month', columnLabel: 'Jan 2025',
  },
  prior: {
    fromDate: '2024-01-01', toDate: '2024-01-31',
    fromFiscalYear: 'FY 2024', toFiscalYear: 'FY 2024', kind: 'month', columnLabel: 'Jan 2024',
  },
} satisfies { current: StatementReportPeriod; prior: StatementReportPeriod };

const trialBalanceColumns = [
  { fieldname: 'account', label: 'Account', type: 'text' },
  { fieldname: 'acc_number', label: 'Account Number', type: 'text' },
  { fieldname: 'currency', label: 'Currency', type: 'text' },
  { fieldname: 'acc_name', label: 'Hidden Account Name', type: 'text', hidden: true },
  { fieldname: 'opening_debit', label: 'Opening Debit', type: 'currency' },
  { fieldname: 'opening_credit', label: 'Opening Credit', type: 'currency' },
  { fieldname: 'debit', label: 'Debit', type: 'currency' },
  { fieldname: 'credit', label: 'Credit', type: 'currency' },
  { fieldname: 'closing_debit', label: 'Closing Debit', type: 'currency' },
  { fieldname: 'closing_credit', label: 'Closing Credit', type: 'currency' },
  { fieldname: 'result_total', label: 'Returned Total', type: 'currency' },
] satisfies NativeReportColumn['columns'];

function report(
  side: 'current' | 'prior',
  rows: readonly Readonly<Record<string, NativeReportScalar>>[],
  options: {
    reportName?: NativeReportColumn['reportName'];
    columns?: NativeReportColumn['columns'];
    acquiredAt?: string;
    periodPair?: typeof periodPair;
  } = {},
): NativeReportColumn {
  const periods = options.periodPair ?? periodPair;
  return {
    reportName: options.reportName ?? 'Trial Balance',
    company: 'Sample organization',
    side,
    period: periods[side],
    periodPair: periods,
    project: null,
    language: 'en',
    profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' },
    columns: options.columns ?? trialBalanceColumns,
    rows,
    summary: null,
    provenance: {
      endpoint: '/api/method/frappe.desk.query_report.run',
      method: 'GET',
      ignorePreparedReport: 1,
      rawSha256: 'not-rendered-hash',
      acquiredAt: options.acquiredAt ?? (side === 'current' ? '2025-01-31T12:30:00.000Z' : '2024-01-31T10:15:00.000Z'),
      filters: {},
    },
  };
}

const currentRows: readonly Readonly<Record<string, NativeReportScalar>>[] = [
  {},
  {
    account: 'Native Assets', account_name: '<strong>Assets</strong>', acc_name: 'Hidden alias',
    acc_number: '1000-10', currency: 'IDR', parent_account: 'Parent machine identity', indent: 1,
    is_group_account: true, opening_debit: '9007199254740993.123456789', opening_credit: '200.00', debit: '300.123',
    credit: '400.123456789', closing_debit: '500', closing_credit: '600.0',
  },
  {},
  {
    account: 'Current Expense', account_name: 'Current-only Expense', acc_name: 'Expense original',
    acc_number: '5000-20', currency: 'IDR', parent_account: null, indent: 0, is_group: false,
    opening_debit: '11', opening_credit: '22', debit: '33', credit: '44', closing_debit: '55', closing_credit: '66',
    result_total: null,
  },
  { account: 'Provisional result', acc_name: 'Provisional result', closing_credit: '77.0', result_total: '88.00' },
  {},
  {},
  { account: 'Section total', closing_debit: null, closing_credit: '0.0', result_total: '0.0' },
  {},
] satisfies readonly Readonly<Record<string, NativeReportScalar>>[];

const priorRows: readonly Readonly<Record<string, NativeReportScalar>>[] = [
  {
    account: 'Prior-only Account', acc_name: 'Prior-only Account', acc_number: '2000-30', currency: 'IDR',
    parent_account: null, indent: 0, is_group_account: false, opening_debit: '901', opening_credit: '902',
    debit: '903', credit: '904', closing_debit: '905', closing_credit: '906',
  },
  {},
  {
    account: 'Native Assets', account_name: 'Assets', acc_name: 'Hidden alias', acc_number: '1000-10', currency: 'IDR',
    parent_account: 'Parent machine identity', indent: 1, is_group_account: true,
    opening_debit: '801', opening_credit: '802', debit: '803', credit: '804', closing_debit: '805', closing_credit: '806',
  },
] satisfies readonly Readonly<Record<string, NativeReportScalar>>[];

function pairWithUnusableAccountUnion(
  currentRowsForPair: readonly Readonly<Record<string, NativeReportScalar>>[] = currentRows,
  priorRowsForPair: readonly Readonly<Record<string, NativeReportScalar>>[] = priorRows,
): StatementReportPair {
  return {
    current: report('current', currentRowsForPair),
    prior: report('prior', priorRowsForPair, {
      columns: trialBalanceColumns.filter((column) => column.fieldname !== 'result_total'),
    }),
    get accounts(): StatementReportPair['accounts'] {
      throw new Error('The renderer must not read the cross-period account union');
    },
  };
}

const labels = {
  current: 'Current period',
  prior: 'Previous period',
  noActivity: 'No activity in this period',
  noActivityDescription: 'There was no activity during this period.',
  notProvided: 'Not provided',
  asAt: 'As at',
  forThePeriod: 'For the period',
  amountsIn: 'Amounts in',
  periodShown: 'Period shown',
};

const presentation = { precision: 2, roundingMethod: 'Commercial Rounding' };

function renderPair(pair: Pick<StatementReportPair, 'current' | 'prior'> = pairWithUnusableAccountUnion(), reportTitle = 'Trial Balance') {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  return render(
    <NativeStatementPair
      pair={pair}
      reportTitle={reportTitle}
      companyLabel="Sample organization"
      currency="IDR"
      presentation={presentation}
      labels={labels}
    />,
  );
}

const rowFor = (table: HTMLElement, name: string) => within(table).getByRole('rowheader', { name: new RegExp(name) }).closest('tr') as HTMLElement;
const cellsOf = (row: HTMLElement) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent);

const plColumns = [
  { fieldname: 'account', label: 'Account', type: 'text' },
  { fieldname: 'currency', label: 'Currency', type: 'text', hidden: true },
  { fieldname: 'sep_2026', label: 'Sep 2026', type: 'currency' },
  { fieldname: 'total', label: 'Total', type: 'currency' },
] satisfies NativeReportColumn['columns'];
const plPriorColumns = [
  { fieldname: 'account', label: 'Account', type: 'text' },
  { fieldname: 'aug_2026', label: 'Aug 2026', type: 'currency' },
  { fieldname: 'total', label: 'Total', type: 'currency' },
] satisfies NativeReportColumn['columns'];
const plPeriods = {
  current: { ...periodPair.current, fromDate: '2026-09-01', toDate: '2026-09-30' },
  prior: { ...periodPair.prior, fromDate: '2026-08-01', toDate: '2026-08-31' },
} satisfies { current: StatementReportPeriod; prior: StatementReportPeriod };

const plCurrent: readonly Readonly<Record<string, NativeReportScalar>>[] = [
  { account: 'Income - SO', account_name: 'Income', indent: 0, is_group: true, parent_account: null, sep_2026: '1500', total: '1500' },
  { account: '4110 - Service revenue - SO', account_name: '4110 - Service revenue', acc_number: '4110', indent: 1, is_group: false, parent_account: 'Income - SO', sep_2026: '1500', total: '1500' },
  { account: "'Total Income (Credit)'", account_name: "'Total Income (Credit)'", sep_2026: '1500', total: '1500' },
  {},
  { account: 'Expenses - SO', account_name: 'Expenses', indent: 0, is_group: true, parent_account: null, sep_2026: '2000.5', total: '2000.5' },
  { account: '5110 - Rent - SO', account_name: '5110 - Rent', indent: 1, is_group: false, parent_account: 'Expenses - SO', sep_2026: '2000.5', total: '2000.5' },
  { account: "'Total Expense (Debit)'", account_name: "'Total Expense (Debit)'", sep_2026: '2000.5', total: '2000.5' },
  {},
  { account: "'Profit for the period'", account_name: "'Profit for the period'", sep_2026: '-500.5', total: '-500.5' },
] satisfies readonly Readonly<Record<string, NativeReportScalar>>[];
const plPrior: readonly Readonly<Record<string, NativeReportScalar>>[] = [
  { account: 'Income - SO', account_name: 'Income', indent: 0, is_group: true, parent_account: null, aug_2026: '1000', total: '1000' },
  { account: '4120 - Licence revenue - SO', account_name: '4120 - Licence revenue', indent: 1, is_group: false, parent_account: 'Income - SO', aug_2026: '1000', total: '1000' },
  { account: "'Total Income (Credit)'", account_name: "'Total Income (Credit)'", aug_2026: '1000', total: '1000' },
  { account: "'Profit for the period'", account_name: "'Profit for the period'", aug_2026: '0.0', total: '0.0' },
] satisfies readonly Readonly<Record<string, NativeReportScalar>>[];

function plPair(reportName: NativeReportColumn['reportName'] = 'Profit and Loss Statement'): StatementReportPair {
  return {
    current: report('current', plCurrent, { reportName, columns: plColumns, periodPair: plPeriods }),
    prior: report('prior', plPrior, { reportName, columns: plPriorColumns, periodPair: plPeriods }),
    get accounts(): StatementReportPair['accounts'] {
      throw new Error('The renderer must not read the cross-period account union');
    },
  };
}

describe('NativeStatementPair — statement format (AC-008)', () => {
  it('renders the trial balance as ONE table for the current period with the native money columns', async () => {
    const { container } = renderPair();
    const table = screen.getByRole('table', { name: /Trial Balance/ });

    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(table).toHaveAccessibleName(/Sample organization/);
    expect(table).toHaveAccessibleName(/For the period Jan 1, 2025 – Jan 31, 2025/);
    expect(table).toHaveAccessibleName(/Amounts in IDR/);
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Account', 'Opening Debit', 'Opening Credit', 'Debit', 'Credit', 'Closing Debit', 'Closing Credit', 'Returned Total']);
    expect(within(table).queryByText('Currency')).not.toBeInTheDocument();
    expect(within(table).queryByText('Prior-only Account')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('formats amounts at the generation precision, with zero as a muted dash and missing as —', () => {
    renderPair();
    const table = screen.getByRole('table');
    expect(cellsOf(rowFor(table, 'Assets')).slice(0, 2)).toEqual(['9,007,199,254,740,993.12', '200.00']);
    expect(cellsOf(rowFor(table, 'Current-only Expense'))).toEqual(['11.00', '22.00', '33.00', '44.00', '55.00', '66.00', '—']);
    const sectionTotal = rowFor(table, 'Section total');
    expect(within(sectionTotal).getAllByText('–')).toHaveLength(2);
    expect(within(sectionTotal).getAllByText('0.00')).toHaveLength(2);
    expect(within(sectionTotal).getByLabelText('Not provided: Closing Debit')).toHaveTextContent('—');
    expect(screen.queryByText('0.0')).not.toBeInTheDocument();
  });

  it('shows each account once with its number, hierarchy indent and group weight; ERP markup stays inert', () => {
    renderPair();
    const table = screen.getByRole('table');
    const assets = rowFor(table, 'Assets');
    expect(within(table).getAllByText('1000-10')).toHaveLength(1);
    expect(assets).toHaveAttribute('data-row-kind', 'group');
    expect(assets).toHaveClass('font-semibold');
    expect(assets.querySelector('th div')).toHaveStyle({ paddingInlineStart: 'calc(var(--spacing) * 4)' });
    expect(rowFor(table, 'Current-only Expense')).not.toHaveClass('font-semibold');
    // A row header is bold by default in the browser; leaf accounts must reset it explicitly.
    expect(within(table).getByRole('rowheader', { name: /Current-only Expense/ })).toHaveClass('font-normal');
    expect(within(table).getByRole('rowheader', { name: /Assets/ })).toHaveClass('font-semibold');
    expect(table.querySelector('strong')).toBeNull();
    expect(within(table).queryByText('Hidden alias')).not.toBeInTheDocument();
    expect(within(table).queryByText('Parent machine identity')).not.toBeInTheDocument();
  });

  it('switches the trial balance between current and previous period without duplicating the table', () => {
    renderPair();
    const previous = screen.getByRole('button', { name: 'Previous period' });
    expect(screen.getByRole('button', { name: 'Current period' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(previous);

    expect(previous).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(table).toHaveAccessibleName(/For the period Jan 1, 2024 – Jan 31, 2024/);
    expect(within(table).getByText('Prior-only Account')).toBeInTheDocument();
    expect(within(table).queryByText('Current-only Expense')).not.toBeInTheDocument();
    expect(cellsOf(rowFor(table, 'Prior-only Account'))).toEqual(['901.00', '902.00', '903.00', '904.00', '905.00', '906.00']);
  });

  it('keeps an empty period local: no-activity for that period, the other period still reachable', () => {
    renderPair(pairWithUnusableAccountUnion([], priorRows));
    expect(screen.getByText(labels.noActivity)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(within(screen.getByRole('table')).getByText('Prior-only Account')).toBeInTheDocument();
  });

  it('renders non-native markup-looking labels as inert text', () => {
    const unsafeLabel = '<img src=x onerror=alert(1)>';
    const { container } = renderPair(pairWithUnusableAccountUnion([{ account: unsafeLabel, closing_credit: '1.0' }], []));
    expect(screen.getByText(unsafeLabel)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('rejects a numeric value in a native currency cell instead of stringifying it', () => {
    expect(() => renderPair(pairWithUnusableAccountUnion([{ account: 'Sparse footer', closing_credit: 12 }], [])))
      .toThrow('Native currency cell is not a lexical decimal token');
  });

  it('renders profit and loss as one comparative table: current and previous columns matched by account', async () => {
    const { container } = renderPair(plPair(), 'Profit and loss');
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Previous period' })).not.toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Profit and loss/ });
    expect(table).toHaveAccessibleName(/For the period Sep 1, 2026 – Sep 30, 2026/);
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Account', 'Sep 2026Current period', 'Aug 2026Previous period']);

    expect(cellsOf(rowFor(table, '^Income$'))).toEqual(['1,500.00', '1,000.00']);
    expect(cellsOf(rowFor(table, 'Service revenue'))).toEqual(['1,500.00', '—']);
    expect(cellsOf(rowFor(table, 'Licence revenue'))).toEqual(['—', '1,000.00']);
    expect(within(table).getAllByRole('rowheader').slice(0, 4).map((cell) => cell.textContent))
      .toEqual(['Income', '4110 - Service revenue', '4120 - Licence revenue', 'Total Income (Credit)']);
    expect(within(table).getAllByText('4110 - Service revenue')).toHaveLength(1);
    expect(within(table).queryByText('4110')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('rules ERP total rows and double-underlines the final net figure in the footer, negatives in parentheses', () => {
    renderPair(plPair(), 'Profit and loss');
    const table = screen.getByRole('table');
    const totalIncome = rowFor(table, 'Total Income');
    expect(totalIncome).toHaveAttribute('data-row-kind', 'total');
    expect(totalIncome).toHaveClass('font-semibold');
    expect(totalIncome.querySelector('td')).toHaveClass('border-t');

    const footer = table.querySelector('tfoot') as HTMLElement;
    const profit = within(footer).getByRole('rowheader', { name: 'Profit for the period' }).closest('tr') as HTMLElement;
    expect(cellsOf(profit)).toEqual(['(500.50)', '–0.00']);
    expect(profit.querySelector('td')).toHaveClass('border-double');
  });

  it('states the balance sheet as-at date once, in its heading', () => {
    renderPair(plPair('Balance Sheet'), 'Balance sheet');
    const table = screen.getByRole('table', { name: /Balance sheet/ });
    expect(table).toHaveAccessibleName(/As at Sep 30, 2026/);
    expect(screen.getAllByText(/As at/)).toHaveLength(1);
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Account', 'Sep 2026Current period', 'Aug 2026Previous period']);
  });

  it('notes a comparison period with no activity while still showing the other period', () => {
    const pair = plPair();
    renderPair({ current: pair.current, prior: report('prior', [], { reportName: 'Profit and Loss Statement', columns: plPriorColumns, periodPair: plPeriods }) }, 'Profit and loss');
    expect(screen.getByText('Previous period: No activity in this period')).toBeInTheDocument();
    expect(cellsOf(rowFor(screen.getByRole('table'), 'Service revenue'))).toEqual(['1,500.00', '—']);
  });

  it('shows the no-activity state when both comparison periods are empty', () => {
    renderPair({
      current: report('current', [], { reportName: 'Balance Sheet', columns: plColumns }),
      prior: report('prior', [], { reportName: 'Balance Sheet', columns: plPriorColumns }),
    }, 'Balance sheet');
    expect(screen.getByText(labels.noActivity)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('composes inside the section without replacing its capture time or delayed note', () => {
    render(
      <FinancialStatementsSection
        title="Financial statements"
        context="Capture window: Jan 31, 2025, 12:00 PM – Jan 31, 2025, 1:00 PM"
        state={{ kind: 'complete', asOf: '2025-01-31T13:00:00.000Z', hasActivity: true, delayed: true, background: 'idle' }}
        labels={{
          unavailable: 'Statements are not available yet', unavailableDescription: 'No complete statement is available.',
          noActivity: labels.noActivity, noActivityDescription: labels.noActivityDescription,
          error: 'Statements could not be loaded', errorDescription: 'Try again.', retry: 'Retry',
          updated: 'Updated', delayed: 'Update delayed', refreshing: 'Refreshing',
        }}
        onRetry={vi.fn()}
      >
        <NativeStatementPair pair={pairWithUnusableAccountUnion()} reportTitle="Trial Balance" currency="IDR" presentation={presentation} labels={labels} />
      </FinancialStatementsSection>,
    );
    const section = screen.getByRole('region', { name: 'Financial statements' });

    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent('Updated Jan 31, 2025');
    expect(within(section).getByText(/Capture window:/)).toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent('Update delayed');
    expect(within(section).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(section).getByText('Current-only Expense')).toBeInTheDocument();
  });
});
