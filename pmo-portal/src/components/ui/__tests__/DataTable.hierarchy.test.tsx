import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AuthContext } from '@/src/auth/AuthContext';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; title: string; detail: string; status: string; currency: string; amount: number }
const rows: Row[] = [
  { id: 'a', title: 'Synthetic item', detail: 'Reference A', status: 'Open', currency: 'IDR', amount: 12 },
  { id: 'b', title: 'Another item', detail: 'Reference B', status: 'Open', currency: 'USD', amount: 8 },
];
const columns: Column<Row>[] = [
  { key: 'title', header: 'Item', kind: 'primary', cell: (row) => row.title, secondaryCell: (row) => row.detail },
  { key: 'status', header: 'Status', kind: 'status', cell: (row) => row.status },
  { key: 'amount', header: 'Amount', kind: 'money', align: 'num', sortKey: 'amount', cell: (row) => row.amount,
    caveat: { reason: 'Some values are estimates', remedy: <a href="/help">Review estimates</a> } },
];

function desktop() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 768px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}
function renderTable(props: React.ComponentProps<typeof DataTable<Row>>) {
  return render(<AuthContext.Provider value={{ currentUser: { id: 'table-user' } } as never}><DataTable {...props} /></AuthContext.Provider>);
}

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('DataTable hierarchy contract', () => {
  it('AC-TBL-GROUP-001 renders currency totals as aligned in-table footer rows without combining currencies', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id, groupBy: (row) => row.currency,
      totals: [
        { key: 'idr', label: 'IDR subtotal', values: { amount: '12 IDR' } },
        { key: 'usd', label: 'USD subtotal', values: { amount: '8 USD' } },
      ] });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('rowgroup')).toHaveLength(3);
    const footer = table.querySelector('tfoot');
    expect(footer).toBeInTheDocument();
    expect(within(footer as HTMLElement).getAllByRole('row')).toHaveLength(2);
    expect(within(footer as HTMLElement).getByText('12 IDR')).toBeInTheDocument();
    expect(within(footer as HTMLElement).getByText('8 USD')).toBeInTheDocument();
    expect(within(table).getByText('IDR')).toBeInTheDocument();
    expect(within(table).getByText('USD')).toBeInTheDocument();
    const groupToggle = within(table).getByRole('button', { name: /IDR/ });
    expect(groupToggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(groupToggle);
    expect(groupToggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(table).queryByText('Synthetic item')).not.toBeInTheDocument();
  });

  it('AC-TBL-CAVEAT-001 marks the header and renders one table-level footnote', () => {
    desktop();
    renderTable({ rows, columns: columns.map((column) => column.key === 'amount' ? { ...column, sortKey: undefined } : column), rowKey: (row) => row.id });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-describedby');
    expect(within(table).getByRole('columnheader', { name: /Amount/ }).querySelector('[aria-hidden="true"]')).toHaveTextContent('*');
    expect(screen.getAllByText('Some values are estimates')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Review estimates' })).toBeInTheDocument();
  });

  it('renders visible sort direction affordances before activation while preserving aria-sort', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id, onSort: vi.fn() });
    const header = screen.getByRole('columnheader', { name: /Amount/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(within(header).getByTestId('sort-cue')).toBeVisible();
  });

  it('applies primary wrapping and kind-specific nowrap behavior', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id });
    const table = screen.getByRole('table');
    const primaryCell = within(table).getByText('Synthetic item').closest('td');
    const statusCell = within(table).getAllByRole('cell')[1];
    const moneyCell = within(table).getAllByRole('cell')[2];
    expect(primaryCell).not.toHaveClass('whitespace-nowrap');
    expect(primaryCell?.querySelector('.line-clamp-2')).toHaveAttribute('title', 'Synthetic item');
    expect(within(primaryCell as HTMLElement).getByText('Reference A')).toBeInTheDocument();
    expect(statusCell).toHaveClass('whitespace-nowrap');
    expect(table.querySelector('th[data-col-key="status"]')).toHaveStyle({ minWidth: '112px', maxWidth: '220px' });
    expect(moneyCell).toHaveClass('whitespace-nowrap');
  });
});
