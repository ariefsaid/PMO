import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'jest-axe';
import { render, screen, within } from '@testing-library/react';
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
  current: 'Current',
  prior: 'Previous',
  values: 'Values',
  noActivity: 'No activity in this period',
  noActivityDescription: 'There was no activity during this period.',
  notProvided: 'Not provided',
  collected: 'Collected',
  asAt: 'As at',
};

function renderPair(pair = pairWithUnusableAccountUnion(), reportTitle = 'Trial Balance') {
  return render(<NativeStatementPair pair={pair} reportTitle={reportTitle} labels={labels} />);
}

function mockMobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe('NativeStatementPair (AC-008)', () => {
  it('renders native current/prior rows independently, in order, with all visible fields and source separators', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { container } = renderPair();
    const current = screen.getByRole('region', { name: 'Trial Balance — Current' });
    const prior = screen.getByRole('region', { name: 'Trial Balance — Previous' });

    expect(within(current).getByText('Jan 1, 2025 – Jan 31, 2025')).toBeInTheDocument();
    expect(within(prior).getByText('Jan 1, 2024 – Jan 31, 2024')).toBeInTheDocument();
    expect(within(current).getByText('Collected Jan 31, 2025, 12:30 PM')).toBeInTheDocument();
    expect(within(prior).getByText('Collected Jan 31, 2024, 10:15 AM')).toBeInTheDocument();
    expect(within(current).getAllByRole('table')).toHaveLength(3);
    expect(within(prior).getAllByRole('table')).toHaveLength(2);
    expect(current.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(prior.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(current.querySelectorAll('hr')).toHaveLength(5);
    expect(prior.querySelectorAll('hr')).toHaveLength(1);

    const currentRowLabels = Array.from(current.querySelectorAll('tbody tr td:first-child'))
      .map((cell) => cell.querySelector('span')?.textContent);
    expect(currentRowLabels).toEqual(['Assets', 'Current-only Expense', 'Provisional result', 'Section total']);
    const priorRowLabels = Array.from(prior.querySelectorAll('tbody tr td:first-child'))
      .map((cell) => cell.querySelector('span')?.textContent);
    expect(priorRowLabels).toEqual(['Prior-only Account', 'Assets']);
    expect(within(current).getByText('Assets')).toHaveClass('font-semibold');
    expect(within(current).getByText('Current-only Expense')).toBeInTheDocument();
    expect(within(prior).getByText('Prior-only Account')).toBeInTheDocument();
    expect(within(prior).queryByText('Current-only Expense')).not.toBeInTheDocument();
    expect(within(current).queryByText('Prior-only Account')).not.toBeInTheDocument();
    expect(within(current).getByText('Provisional result')).toBeInTheDocument();
    expect(screen.queryByText('Unclosed result')).not.toBeInTheDocument();

    for (const fieldLabel of ['Account Number', 'Currency', 'Opening Debit', 'Opening Credit', 'Debit', 'Credit', 'Closing Debit', 'Closing Credit', 'Returned Total']) {
      expect(within(current).getAllByText(fieldLabel).length).toBeGreaterThan(0);
    }
    expect(within(current).getAllByText('1000-10')).toHaveLength(1);
    expect(within(prior).getAllByText('1000-10')).toHaveLength(1);
    for (const amount of ['200.00', '300.123', '400.123456789', '500', '600.0']) {
      expect(within(current).getByText(amount)).toBeInTheDocument();
    }
    expect(within(current).getByText('9,007,199,254,740,993.123456789')).toBeInTheDocument();
    expect(within(current).getAllByText('0.0')).toHaveLength(2);
    expect(within(current).getAllByLabelText('Not provided: Returned Total')).toHaveLength(2);
    expect(within(current).getAllByLabelText('Not provided: Closing Debit')).toHaveLength(2);
    expect(within(current).queryByText('Hidden alias')).not.toBeInTheDocument();
    expect(within(current).queryByText('Parent machine identity')).not.toBeInTheDocument();
    expect(current.querySelector('strong')).toBeNull();
    expect(within(prior).queryAllByText('Returned Total')).toHaveLength(0);
    expect(within(current).getAllByRole('table', { name: /Current.*Values/ })).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders non-native markup-looking labels as inert text and uses only known strong-wrapper cleanup', () => {
    const unsafeLabel = '<img src=x onerror=alert(1)>';
    const pair = pairWithUnusableAccountUnion([
      { account: unsafeLabel, closing_credit: '1.0' },
    ], []);
    const { container } = renderPair(pair);
    const current = screen.getByRole('region', { name: 'Trial Balance — Current' });

    expect(within(current).getByText(unsafeLabel)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('uses DataTable’s single mobile card branch without hiding either comparison side', () => {
    mockMobileViewport();
    const pair = pairWithUnusableAccountUnion();
    renderPair(pair);

    expect(screen.queryAllByRole('table')).toHaveLength(0);
    expect(screen.getAllByTestId('dt-card-branch')).toHaveLength(5);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('region', { name: 'Trial Balance — Current' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Trial Balance — Previous' })).toBeInTheDocument();
    expect(screen.getByText('400.123456789')).toBeInTheDocument();
    expect(screen.getByText('906')).toBeInTheDocument();
  });

  it('keeps an empty side local while the populated prior side retains its rows and collection time', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const pair = pairWithUnusableAccountUnion([], priorRows);
    renderPair(pair);
    const current = screen.getByRole('region', { name: 'Trial Balance — Current' });
    const prior = screen.getByRole('region', { name: 'Trial Balance — Previous' });

    expect(within(current).getByText(labels.noActivity)).toBeInTheDocument();
    expect(within(current).getByText(labels.noActivityDescription)).toBeInTheDocument();
    expect(within(current).getByText('Jan 1, 2025 – Jan 31, 2025')).toBeInTheDocument();
    expect(within(prior).getByText('Prior-only Account')).toBeInTheDocument();
    expect(within(prior).getByText('Collected Jan 31, 2024, 10:15 AM')).toBeInTheDocument();
    expect(within(prior).queryByText(labels.noActivity)).not.toBeInTheDocument();
  });

  it('rejects a numeric value in a native currency cell instead of stringifying it', () => {
    const pair = pairWithUnusableAccountUnion([
      { account: 'Sparse footer', closing_credit: 12 },
    ], []);
    expect(() => renderPair(pair)).toThrow('Native currency cell is not a lexical decimal token');
  });

  it('keeps both complete-empty sides named and independently contextualized', () => {
    renderPair(pairWithUnusableAccountUnion([], []));
    const current = screen.getByRole('region', { name: 'Trial Balance — Current' });
    const prior = screen.getByRole('region', { name: 'Trial Balance — Previous' });

    expect(within(current).getByText(labels.noActivity)).toBeInTheDocument();
    expect(within(prior).getByText(labels.noActivity)).toBeInTheDocument();
    expect(within(current).getByText('Jan 1, 2025 – Jan 31, 2025')).toBeInTheDocument();
    expect(within(prior).getByText('Jan 1, 2024 – Jan 31, 2024')).toBeInTheDocument();
    expect(within(current).getByText('Collected Jan 31, 2025, 12:30 PM')).toBeInTheDocument();
    expect(within(prior).getByText('Collected Jan 31, 2024, 10:15 AM')).toBeInTheDocument();
  });

  it('shows source Balance Sheet end date with its range and keeps native field labels', () => {
    const periods = {
      current: { ...periodPair.current, toDate: '2025-01-31' },
      prior: { ...periodPair.prior, toDate: '2024-01-31' },
    } satisfies { current: StatementReportPeriod; prior: StatementReportPeriod };
    const columns = [
      { fieldname: 'account', label: 'Account', type: 'text' },
      { fieldname: 'jan_2025', label: 'January Balance', type: 'currency' },
      { fieldname: 'total', label: 'Total', type: 'currency' },
    ] satisfies NativeReportColumn['columns'];
    const bsRows = [{
      account: 'Cash', account_name: 'Cash', acc_name: 'Cash', acc_number: null,
      parent_account: null, indent: 0, jan_2025: '1234567.25', total: '1234567.25',
    }] satisfies readonly Readonly<Record<string, NativeReportScalar>>[];
    const pair: StatementReportPair = {
      current: report('current', bsRows, { reportName: 'Balance Sheet', columns, periodPair: periods }),
      prior: report('prior', [], { reportName: 'Balance Sheet', columns, periodPair: periods }),
      accounts: [],
    };
    renderPair(pair, 'Balance Sheet');
    const current = screen.getByRole('region', { name: 'Balance Sheet — Current' });

    expect(within(current).getByText('As at Jan 31, 2025')).toBeInTheDocument();
    expect(within(current).getByText('Jan 1, 2025 – Jan 31, 2025')).toBeInTheDocument();
    expect(within(current).getByText('January Balance')).toBeInTheDocument();
    expect(within(current).getByText('Total')).toBeInTheDocument();
    expect(within(current).getAllByText('1,234,567.25')).toHaveLength(2);
  });

  it('composes inside the actual section without replacing its completed capture time or delayed content', () => {
    const pair = pairWithUnusableAccountUnion();
    render(
      <FinancialStatementsSection
        title="Financial statements"
        context="January 2025 · IDR · captured during the completed collection window"
        state={{ kind: 'complete', asOf: '2025-01-31T13:00:00.000Z', hasActivity: true, delayed: true, background: 'idle' }}
        labels={{
          unavailable: 'Statements are not available yet', unavailableDescription: 'No complete statement is available.',
          noActivity: labels.noActivity, noActivityDescription: labels.noActivityDescription,
          error: 'Statements could not be loaded', errorDescription: 'Try again.', retry: 'Retry',
          updated: 'Updated', delayed: 'Update delayed', refreshing: 'Refreshing',
        }}
        onRetry={vi.fn()}
      >
        <NativeStatementPair pair={pair} reportTitle="Trial Balance" labels={labels} />
      </FinancialStatementsSection>,
    );
    const section = screen.getByRole('region', { name: 'Financial statements' });

    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent('Updated Jan 31, 2025');
    expect(within(section).getByText('January 2025 · IDR · captured during the completed collection window')).toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent('Update delayed');
    expect(within(section).getByText('Current-only Expense')).toBeInTheDocument();
    expect(within(section).getByText('Prior-only Account')).toBeInTheDocument();
  });
});
