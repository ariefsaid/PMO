import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AuthContext } from '@/src/auth/AuthContext';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; amount: number }
const rows: Row[] = [{ id: 'r1', name: 'Synthetic project', amount: 420 }];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Project', cell: (row) => row.name, size: 180, minSize: 120, maxSize: 240 },
  { key: 'amount', header: 'Amount', cell: (row) => row.amount, align: 'num', size: 100, minSize: 80, maxSize: 140 },
];

function renderTable(props: React.ComponentProps<typeof DataTable<Row>>, userId = 'synthetic-user') {
  return render(
    <AuthContext.Provider value={{ currentUser: { id: userId } } as never}>
      <DataTable {...props} />
    </AuthContext.Provider>,
  );
}

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
    renderTable({ rows, columns, rowKey: (row) => row.id, onActivate, rowLabel: (row) => `Open ${row.name}` });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Synthetic project' })).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Synthetic project/ })).getByText('420')).toBeInTheDocument();
  });

  it('announces a column header by its own name, not with the resize handle label', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'resize-name' });
    expect(screen.getAllByRole('columnheader').map((th) => th.getAttribute('aria-label'))).toEqual([null, null]);
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Resize/i })).not.toBeInTheDocument();
  });

  it('AC-TBL-RESIZE-001: the keyboard handle honors the kind contract bounds (status 112-220), as pointer drag does', () => {
    desktop();
    const statusColumns: Column<Row>[] = [
      { key: 'name', header: 'Project', cell: (row) => row.name, kind: 'status' },
      { key: 'amount', header: 'Amount', cell: (row) => row.amount, align: 'num', size: 100 },
    ];
    renderTable({ rows, columns: statusColumns, rowKey: (row) => row.id, tableId: 'resize-kind-status' });
    const separator = screen.getByRole('separator', { name: /Project/i });
    expect(separator).toHaveAttribute('aria-valuemin', '112');
    expect(separator).toHaveAttribute('aria-valuemax', '220');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '220');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '112');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '112');
  });

  it('AC-TBL-RESIZE-001: Shift+Arrow adjusts by 64px, Enter resets, and Escape restores the pre-adjustment width', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'resize-keyboard' });
    const separator = screen.getByRole('separator', { name: 'Resize Project column' });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    expect(separator).toHaveAttribute('aria-controls', screen.getByRole('columnheader', { name: 'Project' }).id);
    separator.focus();
    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true });
    expect(separator).toHaveAttribute('aria-valuenow', '240');
    fireEvent.keyDown(separator, { key: 'Escape' });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
    expect(separator).toHaveAttribute('aria-valuenow', '120');
    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
  });

  it('AC-TBL-RESIZE-001: omits fixed-width handles and clamps pointer drag to the column maximum', () => {
    desktop();
    const fixedColumns: Column<Row>[] = [
      ...columns,
      { key: 'fixed', header: 'Fixed', cell: (row) => row.id, size: 40, minSize: 40, maxSize: 40 },
    ];
    renderTable({ rows, columns: fixedColumns, rowKey: (row) => row.id, tableId: 'resize-pointer-clamp' });
    expect(screen.queryByRole('separator', { name: 'Resize Fixed column' })).not.toBeInTheDocument();
    const amountHandle = screen.getByRole('separator', { name: 'Resize Amount column' });
    amountHandle.getBoundingClientRect = () => ({ x: 100, y: 0, width: 24, height: 38, top: 0, right: 124, bottom: 38, left: 100, toJSON: () => ({}) });
    fireEvent.mouseDown(amountHandle, { clientX: 112, clientY: 19 });
    fireEvent.mouseMove(window, { clientX: 612, clientY: 19 });
    fireEvent.mouseUp(window);
    expect(amountHandle).toHaveAttribute('aria-valuenow', '140');
    expect(JSON.parse(localStorage.getItem('pmo.table.resize-pointer-clamp.widths.v1:synthetic-user') ?? '{}').amount).toBe(140);
  });

  it('AC-TBL-RESIZE-001: places resize separators in header order before the table rows', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'resize-tab-order' });
    const headers = screen.getAllByRole('columnheader');
    const handles = screen.getAllByRole('separator');
    expect(headers.map((header) => header.contains(handles[headers.indexOf(header)]))).toEqual([true, true]);
    expect(handles.map((handle) => handle.getAttribute('aria-label'))).toEqual(['Resize Project column', 'Resize Amount column']);
    const line = handles[0].querySelector('.datatable-resize-indicator');
    expect(line).toHaveClass('w-[2px]', 'bg-[hsl(var(--input))]', 'group-hover:bg-muted-foreground/60');
    expect(handles[0]).toHaveClass('group-hover:opacity-100', 'focus-visible:opacity-100');
  });

  it('resizes by keyboard in 16px increments, clamps at min/max, and resets on double click', () => {
    desktop();
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'resize-test' });
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
    fireEvent.keyDown(separator, { key: 'Enter' });
    expect(separator).toHaveAttribute('aria-valuenow', '180');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '180');
  });

  it('does not impose heuristic widths on columns without caller sizing', () => {
    desktop();
    renderTable({ rows, columns: columns.map(({ size: _size, minSize: _min, maxSize: _max, ...column }) => column), rowKey: (row) => row.id });
    expect(screen.getAllByRole('columnheader').map((th) => (th as HTMLElement).style.width)).toEqual(['', '']);
    expect(screen.getAllByRole('cell').map((td) => (td as HTMLElement).style.minWidth)).toEqual(['', '']);
  });

  it('persists resized widths by table id and restores them on a later mount', () => {
    desktop();
    const view = renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'persist-test' });
    const separator = screen.getByRole('separator', { name: /Project/i });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(localStorage.getItem('pmo.table.persist-test.widths.v1:synthetic-user')).toContain('196');
    view.unmount();
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'persist-test' });
    expect(screen.getByRole('separator', { name: /Project/i })).toHaveAttribute('aria-valuenow', '196');
  });

  it('AC-TBL-RESIZE-002 isolates saved widths by user as well as table', () => {
    desktop();
    localStorage.setItem('pmo.table.shared.widths.v1:other-user', JSON.stringify({ name: 224 }));
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'shared' }, 'synthetic-user');
    expect(screen.getByRole('separator', { name: /Project/i })).toHaveAttribute('aria-valuenow', '180');
  });

  it('AC-TBL-RESIZE-002 clamps restored widths and ignores unknown column keys', () => {
    desktop();
    localStorage.setItem('pmo.table.clamped.widths.v1:synthetic-user', JSON.stringify({ name: 999, amount: 1, removedColumn: 200 }));
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'clamped' });
    expect(screen.getByRole('separator', { name: /Project/i })).toHaveAttribute('aria-valuenow', '240');
    expect(screen.getByRole('separator', { name: /Amount/i })).toHaveAttribute('aria-valuenow', '80');
    expect(screen.queryByRole('separator', { name: /removedColumn/i })).not.toBeInTheDocument();
  });

  it('renders and remains resizable when localStorage reads or writes throw', () => {
    desktop();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    renderTable({ rows, columns, rowKey: (row) => row.id, tableId: 'throws-test' });
    const separator = screen.getByRole('separator', { name: /Project/i });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '196');
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });
});
