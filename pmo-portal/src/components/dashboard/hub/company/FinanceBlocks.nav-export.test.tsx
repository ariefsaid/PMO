import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';

const exportXlsx = vi.fn();
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx, busy: false }) }));

import { BudgetReviewCard, ReadyToPayCard } from './FinanceBlocks';

type ExportCol = { key: string; header: unknown; exportValue?: (row: unknown) => unknown };
const Where = () => <div data-testid="where">{useLocation().pathname}</div>;

const proc = (id: string, over: Record<string, unknown> = {}) => ({
  id, code: id.toUpperCase(), title: `Case ${id}`, status: 'Vendor Invoiced', currency: 'IDR', total_value: 1_000_000,
  vendor: { name: 'Sample Supplier' }, procurement_invoices: [{ invoice_date: '2026-10-17', amount: 1_000_000 }], ...over,
}) as unknown as ProcurementWithRefs;

const budget = (id: string, over: Partial<BudgetReviewRow> = {}): BudgetReviewRow => ({
  id, name: `Project ${id}`, client_name: null, status: 'Active', currency: 'USD', budget: 1000, budget_currency: 'USD',
  spent: 1250, variance: 250, actual_currency: 'USD', actual_complete: true, actual_coverage_count: 1, actual_coverage_total: 1,
  actual_as_of: null, ledger_owned: true, ...over,
} as BudgetReviewRow);

const withRouter = (ui: React.ReactElement) => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => exportXlsx.mockClear());

describe('#2544 ReadyToPayCard export rows', () => {
  it('#2544 the exported columns resolve to each ready row\'s title, supplier, unpaid amount and invoice age; unknowns export blank', async () => {
    const unpaid: Record<string, number | null> = { a: 750_000, b: null };
    const rows = [
      proc('a'),
      proc('b', { vendor: null, procurement_invoices: [] }),
      proc('c', { status: 'Ordered' }),
    ];
    withRouter(<ReadyToPayCard rows={rows} pending={false} error={false} retry={() => {}} unpaidOf={(r) => unpaid[r.id] ?? null} today="2026-10-27" />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const [exported, columns, entity] = exportXlsx.mock.calls[0] as [ProcurementWithRefs[], ExportCol[], string];
    expect(entity).toBe('Ready to pay');
    expect(exported.map((r) => r.id)).toEqual(['a', 'b']);
    expect(columns.map((c) => c.key)).toEqual(['procurement', 'supplier', 'amount', 'age']);
    const sheet = exported.map((r) => columns.map((c) => c.exportValue!(r)));
    expect(sheet).toEqual([
      ['Case a', 'Sample Supplier', 750_000, 10],
      ['Case b', '', '', ''],
    ]);
  });

  it('#2544 an erroring or loading card offers no export', () => {
    const { unmount } = withRouter(<ReadyToPayCard rows={[proc('a')]} pending={false} error retry={() => {}} unpaidOf={() => 1} today="2026-10-27" />);
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    unmount();
    withRouter(<ReadyToPayCard rows={[proc('a')]} pending error={false} retry={() => {}} unpaidOf={() => 1} today="2026-10-27" />);
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });
});

describe('#2544 ReadyToPayCard navigation', () => {
  it('#2544 opening a ready-to-pay row goes to that procurement', async () => {
    withRouter(<ReadyToPayCard rows={[proc('pr7'), proc('pr8')]} pending={false} error={false} retry={() => {}} unpaidOf={() => 1} today="2026-10-27" />);
    const link = screen.getByRole('link', { name: 'Open Case pr8' });
    expect(link).toHaveAttribute('href', '/procurement/pr8');
    await userEvent.click(link);
    expect(screen.getByTestId('where')).toHaveTextContent('/procurement/pr8');
  });

  it('#2544 Retry on the error state calls the retry handler', async () => {
    const retry = vi.fn();
    withRouter(<ReadyToPayCard rows={[]} pending={false} error retry={retry} unpaidOf={() => 1} today="2026-10-27" />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('#2544 BudgetReviewCard navigation and export', () => {
  it('#2544 opening a budget row goes to that project\'s budget', async () => {
    withRouter(<BudgetReviewCard rows={[budget('p1'), budget('p2')]} pending={false} error={false} retry={() => {}} />);
    const link = screen.getByRole('link', { name: 'Open budget for Project p2' });
    expect(link).toHaveAttribute('href', '/projects/p2/budget');
    await userEvent.click(link);
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p2/budget');
  });

  it('#2544 the row menu offers Open project (the project page) and Open budget (its budget)', async () => {
    withRouter(<BudgetReviewCard rows={[budget('p1')]} pending={false} error={false} retry={() => {}} />);
    const card = screen.getByRole('heading', { name: 'Budget review' }).closest('.panel-card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: /more|actions|menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open project' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/p1');
    expect(screen.getByTestId('where').textContent).not.toContain('/budget');
  });

  it('#2544 the export carries the review verdict, budget, spent, percent used and variance per project', async () => {
    const rows = [
      budget('over'),
      budget('within', { spent: 400, variance: -600 }),
      budget('unknown', { spent: null, variance: null, actual_complete: false }),
    ];
    withRouter(<BudgetReviewCard rows={rows} pending={false} error={false} retry={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const [exported, columns, entity] = exportXlsx.mock.calls[0] as [BudgetReviewRow[], ExportCol[], string];
    expect(entity).toBe('Budget review');
    expect(columns.map((c) => c.key)).toEqual(['project', 'review', 'budget', 'spent', 'used', 'variance']);
    expect(exported.map((r) => columns.map((c) => c.exportValue!(r)))).toEqual([
      ['Project over', 'Over budget', 1000, 1250, 125, 250],
      ['Project within', 'Within budget', 1000, 400, 40, -600],
      ['Project unknown', 'Spending not recorded', 1000, '', '', ''],
    ]);
  });
});
