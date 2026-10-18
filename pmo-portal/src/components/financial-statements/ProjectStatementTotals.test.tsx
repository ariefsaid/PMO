import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'jest-axe';
import { render, screen, within } from '@testing-library/react';
import { ProjectStatementTotals } from './ProjectStatementTotals';
import type { NativeProjectStatementTotals, StatementReportPeriod } from '@/src/lib/adapterSeam/erpnext/statementReports';
import { getActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const localeBeforeTest = getActiveLocale();
afterEach(() => setActiveLocale(localeBeforeTest));

const current: Readonly<NativeProjectStatementTotals> = {
  income: '9007199254740993.123456789',
  expense: '2345678.90000000001',
  net: '7654321.12000000000000000009',
  currency: 'IDR',
};
const prior: Readonly<NativeProjectStatementTotals> = {
  income: '3456789.987654321',
  expense: '0.0',
  net: '-0.0',
  currency: 'IDR',
};
const periods = {
  current: { fromDate: '2025-01-01', toDate: '2025-01-31' },
  prior: { fromDate: '2024-01-01', toDate: '2024-01-31' },
} satisfies {
  current: Pick<StatementReportPeriod, 'fromDate' | 'toDate'>;
  prior: Pick<StatementReportPeriod, 'fromDate' | 'toDate'>;
};
const labels = {
  current: 'Current',
  prior: 'Previous',
  income: 'Income',
  expense: 'Expense',
  net: 'Net',
  amounts: 'Project statement amounts',
};

function renderTotals() {
  return render(<ProjectStatementTotals current={current} prior={prior} periods={periods} labels={labels} />);
}

describe('ProjectStatementTotals (AC-008)', () => {
  it('renders exactly three named native totals with the six supplied values in their own period columns', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const { container } = renderTotals();
    const table = screen.getByRole('table', { name: labels.amounts });

    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual([
      labels.amounts,
      'CurrentCurrent · Jan 1, 2025 – Jan 31, 2025 · IDR',
      'PreviousPrevious · Jan 1, 2024 – Jan 31, 2024 · IDR',
    ]);
    expect(headers[1]?.querySelector('[data-period-caption="mobile"]')).toHaveTextContent('Current');
    expect(headers[1]?.querySelector('[data-period-caption="desktop"]')).toHaveTextContent('Current · Jan 1, 2025 – Jan 31, 2025 · IDR');
    expect(headers[2]?.querySelector('[data-period-caption="mobile"]')).toHaveTextContent('Previous');
    expect(headers[2]?.querySelector('[data-period-caption="desktop"]')).toHaveTextContent('Previous · Jan 1, 2024 – Jan 31, 2024 · IDR');
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.querySelector('td')?.textContent))
      .toEqual(['Income', 'Expense', 'Net']);
    for (const value of [
      '9,007,199,254,740,993.123456789',
      '2,345,678.90000000001',
      '7,654,321.12000000000000000009',
      '3,456,789.987654321',
      '0.0',
      '-0.0',
    ]) {
      expect(within(table).getByText(value)).toBeInTheDocument();
    }
    expect(container.textContent).not.toMatch(/account|company|raw|filter/i);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps date language and number preference independent and preserves native zero expense', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'en-US', timezone: 'UTC' });
    renderTotals();
    const table = screen.getByRole('table', { name: labels.amounts });
    const headers = within(table).getAllByRole('columnheader');

    expect(headers[1]?.querySelector('[data-period-caption="desktop"]')).toHaveTextContent('Current · 1 Jan 2025 – 31 Jan 2025 · IDR');
    expect(headers[2]?.querySelector('[data-period-caption="desktop"]')).toHaveTextContent('Previous · 1 Jan 2024 – 31 Jan 2024 · IDR');
    expect(within(table).getByText('2,345,678.90000000001')).toBeInTheDocument();
    expect(within(table).getByText('0.0')).toBeInTheDocument();
    expect(within(table).getByText('-0.0')).toBeInTheDocument();
    expect(within(table).queryByText('0')).not.toBeInTheDocument();
  });
});
