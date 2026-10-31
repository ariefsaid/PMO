import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import type { ProjectConsumption } from '@/src/lib/db/stockReports';

const { consumption } = vi.hoisted(() => ({ consumption: { report: vi.fn() } }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { consumption } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

import ConsumptionReport, { defaultRange } from './ConsumptionReport';

const key = (b: string, i: string) => ({ boqItemId: b, boqItemCode: b.toUpperCase(), boqDescription: `Work ${b}`, itemId: i, itemCode: i.toUpperCase(), itemName: `Item ${i}`, unitCode: 'bag' });
const report = (over: Partial<ProjectConsumption> = {}): ProjectConsumption => ({
  from: '2026-08-01', to: '2026-11-30',
  months: [
    { ...key('w1', 'cem'), month: '2026-10-01', issued: '45', returned: '0', netConsumed: '45', issuedBy: ['Ana Admin'] },
    { ...key('w1', 'cem'), month: '2026-11-01', issued: '22', returned: '3', netConsumed: '19', issuedBy: ['Kai Keeper'] },
    { ...key('w2', 'reb'), month: '2026-11-01', issued: '120', returned: '0', netConsumed: '120', issuedBy: ['Kai Keeper'] },
  ],
  allowances: [{ ...key('w1', 'cem'), id: 'a1', plannedQuantity: '60', netToDate: '64', variance: '4', overAllowance: true },
               { ...key('w3', 'cab'), id: 'a2', plannedQuantity: '300', netToDate: '150', variance: '-150', overAllowance: false }],
  unplanned: [{ ...key('w2', 'reb'), netToDate: '120' }],
  ...over,
});
const renderIt = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConsumptionReport projectId="p1" /></QueryClientProvider>);
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => vi.clearAllMocks());

describe('Project consumption report', () => {
  it('defaults to the current month and the three before it', () => {
    expect(defaultRange(new Date(2026, 10, 15))).toEqual({ fromMonth: '2026-08', toMonth: '2026-11' });
    expect(defaultRange(new Date(2026, 1, 3))).toEqual({ fromMonth: '2025-11', toMonth: '2026-02' });
  });

  it('FR-STK-042 asks the server for whole months: first day of the from-month to the last day of the to-month', async () => {
    consumption.report.mockResolvedValue(report());
    renderIt();
    await screen.findByRole('table', { name: 'By month' });
    const [, from, to] = consumption.report.mock.calls[0];
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to).toMatch(/^\d{4}-\d{2}-(28|29|30|31)$/);
  });

  it('AC-STK-022 the report renders one row per month x work item x item with issued, returned, net and who issued it', async () => {
    consumption.report.mockResolvedValue(report());
    renderIt();
    const table = await screen.findByRole('table', { name: 'By month' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Nov 2026');
    expect(rows[1]).toHaveTextContent('W1');
    expect(rows[1]).toHaveTextContent('CEM');
    expect(rows[1]).toHaveTextContent('22');
    expect(rows[1]).toHaveTextContent('3');
    expect(rows[1]).toHaveTextContent('19');
    expect(rows[1]).toHaveTextContent('Kai Keeper');
  });

  it('AC-STK-023 a row over its allowance shows the variance and an "Over allowance" flag with text, not colour alone (WCAG)', async () => {
    consumption.report.mockResolvedValue(report());
    renderIt();
    const table = await screen.findByRole('table', { name: 'Against allowance' });
    const [, over, under] = within(table).getAllByRole('row');
    expect(over).toHaveTextContent('+4');
    expect(within(over).getByText('Over allowance')).toBeInTheDocument();
    expect(under).toHaveTextContent('-150');
    expect(within(under).queryByText('Over allowance')).not.toBeInTheDocument();
  });

  it('AC-STK-023 an item with no allowance shows consumption only and appears in the "Unplanned" list', async () => {
    consumption.report.mockResolvedValue(report());
    renderIt();
    const unplanned = await screen.findByRole('table', { name: 'Issued without an allowance' });
    expect(within(unplanned).getByText('REB')).toBeInTheDocument();
    const allowance = screen.getByRole('table', { name: 'Against allowance' });
    expect(within(allowance).queryByText('REB')).not.toBeInTheDocument();
  });

  it('AC-STK-020 value columns appear only when the server sent a value', async () => {
    consumption.report.mockResolvedValue(report());
    const a = renderIt();
    await screen.findByRole('table', { name: 'By month' });
    expect(screen.queryByRole('columnheader', { name: 'Value' })).not.toBeInTheDocument();
    a.unmount();
    consumption.report.mockResolvedValue(report({ months: [{ ...key('w1', 'cem'), month: '2026-10-01', issued: '1', returned: '0', netConsumed: '1', issuedBy: [], netValue: '8.50' }] }));
    renderIt();
    expect(await screen.findByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
  });

  it('FR-STK-044 an RPC failure shows an error with retry and never a zero', async () => {
    consumption.report.mockRejectedValueOnce(new Error('boom'));
    renderIt();
    expect(await screen.findByText('Consumption could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    consumption.report.mockResolvedValue(report());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'By month' })).toBeInTheDocument();
  });

  it('AC-STK-032 loading and empty states', async () => {
    let resolve: (v: ProjectConsumption) => void = () => {};
    consumption.report.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderIt();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    resolve(report({ months: [], allowances: [], unplanned: [] }));
    expect(await screen.findByText('No material issued to this project in these months')).toBeInTheDocument();
  });
});
