import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { DashboardRow } from '@/src/lib/workOrderDashboard';

/** #2805: the work-order dashboard lists every work order with its figures; filters narrow it; a row opens the work order. */
const h = vi.hoisted(() => ({
  exportXlsx: vi.fn(),
  state: {
    rows: [] as unknown[], isPending: false, isError: false, refetch: () => undefined, figuresPending: false, figuresError: false,
    retryFigures: () => undefined, canBilling: true, costState: 'shown' as string, disciplines: [] as unknown[],
  },
}));
vi.mock('@/src/hooks/useWorkOrderDashboard', () => ({ COST_PROJECT_CAP: 6, useWorkOrderDashboard: () => h.state }));

vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: h.exportXlsx, busy: false }) }));

import WorkOrders from './WorkOrders';

const row = (over: Partial<DashboardRow>): DashboardRow => ({
  id: 'w1', wo_number: 'WO-1', title: 'Pipe laying', status: 'Issued', project_id: 'p1', project_name: 'Depot', end_date: null,
  disciplineIds: [], progress: 40, billing: { currency: 'USD', invoiced: 1000, orderNet: 5000, complete: true },
  cost: { currency: 'USD', direct: '900.00', plan: '800.00' }, openSteps: 0, late: 0, ...over,
});
const renderPage = (path = '/work-orders') => render(<MemoryRouter initialEntries={[path]}><WorkOrders /></MemoryRouter>);
const rowFor = (label: string) => screen.getByRole('row', { name: new RegExp(label) });

beforeEach(() => {
  h.state = { ...h.state, rows: [], isPending: false, isError: false, canBilling: true, costState: 'shown', disciplines: [], figuresError: false };
});

describe('Work orders dashboard', () => {
  it('PC20 exports the listed work orders to Excel with the columns shown', async () => {
    h.state = { ...h.state, rows: [row({}), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing' })] };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const [rows, columns, entity] = h.exportXlsx.mock.calls[0];
    expect(rows.map((r: DashboardRow) => r.wo_number)).toEqual(['WO-1', 'WO-2']);
    expect(columns.find((c: { key: string }) => c.key === 'status').exportValue(rows[0])).toBe('Issued');
    expect(entity).toBe('WorkOrders');
  });

  it('AC-WOD-003 lists each work order with progress, direct cost against budget, billed and late, and opens it', () => {
    h.state = { ...h.state, rows: [row({ late: 2, openSteps: 3 }), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing', status: 'Draft', project_name: 'Yard', progress: null, billing: null, cost: null })] };
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Work order');
    const first = rowFor('WO-1');
    expect(within(first).getByText('40%')).toBeInTheDocument();
    expect(within(first).getByText(/Over budget by \$100/)).toBeInTheDocument();
    expect(within(first).getByTestId('wo-billed-w1')).toHaveTextContent('$1,000');
    expect(within(first).getByTestId('wo-billed-w1')).toHaveTextContent('of $5,000');
    expect(within(first).getByTestId('wo-missing-w1')).toHaveTextContent('2 late');
    expect(within(first).getByRole('link', { name: /Open WO-1/ })).toHaveAttribute('href', '/work-orders/w1');
    expect(within(rowFor('WO-2')).getByText('Draft')).toBeInTheDocument();
  });

  it('AC-WOD-004 a role without the invoice or plan right sees no billed or cost figure', () => {
    h.state = { ...h.state, canBilling: false, costState: 'hidden', rows: [row({ billing: null, cost: null })] };
    renderPage();
    expect(screen.queryByRole('columnheader', { name: 'Billed' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Direct cost' })).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Show late work orders (0)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /over budget/ })).toBeNull();
  });

  it('AC-WOD-009 the over-budget tile counts and filters to work orders whose direct cost passed their budget', async () => {
    h.state = { ...h.state, rows: [row({}), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing', cost: { currency: 'USD', direct: '100.00', plan: '800.00' } })] };
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Show work orders over budget (1)' }));
    expect(rowFor('WO-1')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /WO-2/ })).toBeNull();
  });

  it('AC-WOD-010 a work order without a number leads with its title', () => {
    h.state = { ...h.state, rows: [row({ wo_number: null, title: 'Unnumbered fencing' })] };
    renderPage();
    const first = rowFor('Unnumbered fencing');
    expect(within(first).getByRole('link', { name: 'Open Unnumbered fencing' })).toBeInTheDocument();
    expect(within(first).queryByText(/not numbered/i)).toBeNull();
  });

  it('AC-WOD-005 searches, filters to late and clears back to the All view', async () => {
    h.state = { ...h.state, rows: [row({ late: 1 }), row({ id: 'w2', wo_number: 'WO-2', title: 'Fencing', project_name: 'Yard' })] };
    renderPage();
    const lateTile = screen.getByRole('button', { name: 'Show late work orders (1)' });
    await userEvent.click(lateTile);
    expect(lateTile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('row', { name: /WO-2/ })).toBeNull();
    expect(rowFor('WO-1')).toBeInTheDocument();
    await userEvent.click(lateTile);
    expect(rowFor('WO-2')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'yard');
    expect(screen.queryByRole('row', { name: /WO-1/ })).toBeNull();
    expect(rowFor('WO-2')).toBeInTheDocument();
  });

  it('says so when there is none, and offers a retry on error', () => {
    const { unmount } = renderPage();
    expect(screen.getByText('You have no work orders yet')).toBeInTheDocument();
    unmount();
    h.state = { ...h.state, isError: true };
    renderPage();
    expect(screen.getByText("Couldn't load your work orders")).toBeInTheDocument();
  });
});
