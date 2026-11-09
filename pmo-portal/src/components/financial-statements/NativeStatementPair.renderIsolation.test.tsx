import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { NativeReportColumn, NativeReportScalar, StatementReportPair, StatementReportPeriod } from '@/src/lib/adapterSeam/erpnext/statementReports';

/**
 * #2103 AC: "Given a statement group toggle, then only that group's rows re-render." Each amount cell
 * renders through `formatStatementAmount`, so counting those calls measures exactly how many cells were
 * re-rendered: a full-table re-render formats every visible amount, the memoised rows format one row's.
 */
const counts = { formatted: 0 };
vi.mock('@/src/lib/nativeStatementPresentation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/nativeStatementPresentation')>();
  return {
    ...real,
    formatStatementAmount: (...args: Parameters<typeof real.formatStatementAmount>) => {
      counts.formatted += 1;
      return real.formatStatementAmount(...args);
    },
  };
});

import { NativeStatementPair } from './NativeStatementPair';

const columns = [
  { fieldname: 'account', label: 'Account', type: 'text' },
  { fieldname: 'acc_number', label: 'Account Number', type: 'text' },
  { fieldname: 'currency', label: 'Currency', type: 'text' },
  { fieldname: 'debit', label: 'Debit', type: 'currency' },
  { fieldname: 'credit', label: 'Credit', type: 'currency' },
] satisfies NativeReportColumn['columns'];

const periodPair: { current: StatementReportPeriod; prior: StatementReportPeriod } = {
  current: { fromDate: '2025-01-01', toDate: '2025-01-31', fromFiscalYear: 'FY 2025', toFiscalYear: 'FY 2025', kind: 'month', columnLabel: 'Jan 2025' },
  prior: { fromDate: '2024-01-01', toDate: '2024-01-31', fromFiscalYear: 'FY 2024', toFiscalYear: 'FY 2024', kind: 'month', columnLabel: 'Jan 2024' },
};

const GROUPS = 10;
const PER_GROUP = 40;

function statementRows(): Readonly<Record<string, NativeReportScalar>>[] {
  const out: Record<string, NativeReportScalar>[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    out.push({ account: `G${group}`, account_name: `Group ${group}`, indent: 0, is_group: true, level: 1, debit: '100.00', credit: '0.00' });
    for (let child = 0; child < PER_GROUP; child += 1) {
      out.push({
        account: `G${group}-${child}`, account_name: `Account ${group}.${child}`, indent: 1, level: 2,
        debit: '10.00', credit: '0.00', parent_account: `G${group}`,
      });
    }
  }
  out.push({ account_name: "'Total Debit (Credit)'", debit: '5000.00', credit: '0.00' });
  return out;
}

function side(which: 'current' | 'prior'): NativeReportColumn {
  return {
    reportName: 'Profit and Loss Statement', company: 'Sample organization', side: which, period: periodPair[which], periodPair,
    project: null, language: 'en', profile: { erpVersion: '16.33.0', frappeVersion: '16.31.0' }, columns,
    rows: statementRows(), summary: null,
    provenance: {
      endpoint: '/api/method/frappe.desk.query_report.run', method: 'GET', ignorePreparedReport: 1,
      rawSha256: 'hash', acquiredAt: which === 'current' ? '2025-01-31T12:30:00.000Z' : '2024-01-31T10:15:00.000Z', filters: {},
    },
  };
}

const pair: Pick<StatementReportPair, 'current' | 'prior'> = { current: side('current'), prior: side('prior') };

const labels = {
  current: 'This period', prior: 'Previous period', noActivity: 'No activity', noActivityDescription: 'Nothing',
  notProvided: 'Not provided', asAt: 'As at', forThePeriod: 'For the period', amountsIn: 'Amounts in', periodShown: 'Period',
  collapseGroup: (group: string) => `Collapse ${group}`, expandGroup: (group: string) => `Expand ${group}`,
  collapseAll: 'Collapse all', expandAll: 'Expand all',
};

const renderPair = () => render(
  <NativeStatementPair pair={pair} reportTitle="Profit and Loss Statement" currency="IDR" presentation={{ precision: 2, roundingMethod: 'round-half-up' }} labels={labels} />,
);

describe('#2103 statement group toggle', () => {
  it('re-renders only the toggled group row, not the whole statement', () => {
    renderPair();
    expect(counts.formatted).toBe(GROUPS * (PER_GROUP + 1) * 4 + 4);

    counts.formatted = 0;
    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse Group 3' })[0]);

    // One row's four amount cells (its two currency columns on each side); the rest of the table is reused.
    expect(counts.formatted).toBeLessThanOrEqual(8);
  });

  it('still hides exactly the collapsed group’s children and keeps the other groups whole', () => {
    const view = renderPair();
    const table = view.container.querySelector('table')!;
    const shownBefore = within(table).getAllByRole('row').length;

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse Group 3' })[0]);

    const shownAfter = within(view.container.querySelector('table')!).getAllByRole('row').length;
    expect(shownAfter).toBe(shownBefore - PER_GROUP);
    expect(screen.queryByText('Account 3.0')).toBeNull();
    expect(screen.getByText('Account 2.0')).toBeInTheDocument();
    expect(screen.getByText('Account 4.0')).toBeInTheDocument();
    // Expand puts the children back.
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand Group 3' })[0]);
    expect(screen.getByText('Account 3.0')).toBeInTheDocument();
  });
});
