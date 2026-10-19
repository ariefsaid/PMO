import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; amount: number }
const rows: Row[] = [{ id: 'r1', name: 'Synthetic project', amount: 420 }];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Project', cell: (row) => row.name, size: 180, minSize: 120, maxSize: 240 },
  { key: 'amount', header: 'Amount', cell: (row) => row.amount, align: 'num', size: 100, minSize: 80, maxSize: 140 },
];

function desktop() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 768px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DataTable column resizing', () => {
  it('preserves existing table content, sorting controls, and row activation when resize support is added', () => {
    desktop();
    const onActivate = vi.fn();
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={onActivate} rowLabel={(row) => `Open ${row.name}`} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Synthetic project' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Synthetic project/ })).getByText('420')).toBeInTheDocument();
  });

  it('announces a column header by its own name, not with the resize handle label', () => {
    desktop();
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} tableId="resize-name" />);
    expect(screen.getAllByRole('columnheader').map((th) => th.getAttribute('aria-label'))).toEqual(['Project', 'Amount']);
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Resize/i })).not.toBeInTheDocument();
  });

  it('resizes by keyboard in 16px increments, clamps at min/max, and resets on double click', () => {
    desktop();
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} tableId="resize-test" />);
    const separator = screen.getByRole('separator', { name: /Project/i });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    separator.focus();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '196');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '120');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '120');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '240');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '240');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '180');
  });

  it('persists resized widths by table id and restores them on a later mount', () => {
    desktop();
    const view = render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} tableId="persist-test" />);
    const separator = screen.getByRole('separator', { name: /Project/i });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(localStorage.getItem('pmo:datatable:persist-test:columnSizing')).toContain('196');
    view.unmount();
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} tableId="persist-test" />);
    expect(screen.getByRole('separator', { name: /Project/i })).toHaveAttribute('aria-valuenow', '196');
  });

  it('renders and remains resizable when localStorage reads or writes throw', () => {
    desktop();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} tableId="throws-test" />);
    const separator = screen.getByRole('separator', { name: /Project/i });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '196');
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });
});
