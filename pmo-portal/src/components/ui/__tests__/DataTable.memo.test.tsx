import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useMemo, useState } from 'react';
import i18nextTest from 'i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; amount: number }
const rows: Row[] = [
  { id: 'A', name: 'Alpha', amount: 10 },
  { id: 'B', name: 'Beta', amount: 20 },
  { id: 'C', name: 'Gamma', amount: 30 },
];

/** Renders every body row/card once per (re)render of that row — the render counter. */
function countingColumns(record: string[]): Column<Row>[] {
  return [
    { key: 'name', header: 'Name', cell: (row) => { record.push(row.id); return row.name; }, size: 180, minSize: 120, maxSize: 240 },
    { key: 'amount', header: 'Amount', cell: (row) => { record.push(`${row.id}$`); return row.amount; }, align: 'num', size: 100 },
  ];
}

function desktopViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 768px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

function mobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

function widthsKey(tableId: string) {
  return `pmo.table.${tableId}.widths.v1:user-memo`;
}

const AUTH = { currentUser: { id: 'user-memo' } } as never;
function wrap(ui: React.ReactElement) {
  return <AuthContext.Provider value={AUTH}>{ui}</AuthContext.Provider>;
}
function renderTable(ui: React.ReactElement) {
  const view = render(wrap(ui));
  return { ...view, rerender: (next: React.ReactElement) => view.rerender(wrap(next)) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  void i18nextTest.changeLanguage('en');
});

describe('DataTable body render cost while resizing (issue #2102)', () => {
  it('AC-PERF-2102: a pointer drag of many moves writes storage ONCE on release and re-renders no body row', () => {
    desktopViewport();
    const record: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const columns = countingColumns(record);
    const { container } = renderTable(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} tableId="memo-drag" />,
    );
    record.length = 0;
    setItem.mockClear();

    const handle = screen.getByRole('separator', { name: 'Resize Name column' });
    fireEvent.mouseDown(handle, { clientX: 100 });
    for (let i = 1; i <= 30; i += 1) fireEvent.mouseMove(window, { clientX: 100 + i });

    // During the drag: no storage write per move, and no body row re-render at all.
    expect(setItem.mock.calls.filter(([key]) => key === widthsKey('memo-drag'))).toHaveLength(0);
    expect(record).toEqual([]);

    fireEvent.mouseUp(window);

    // On release: exactly one persisted write; the drag still resized (behaviour kept)…
    const writes = setItem.mock.calls.filter(([key]) => key === widthsKey('memo-drag'));
    expect(writes).toHaveLength(1);
    expect(screen.getByRole('separator', { name: 'Resize Name column' })).toHaveAttribute('aria-valuenow', '210');
    // …and the body was still never re-rendered (widths travel via CSS variables on <table>).
    expect(record).toEqual([]);
    expect(container.querySelector('tbody')).toBeInTheDocument();
  });

  it('AC-PERF-2102: a touch drag behaves the same — one write on touchend, no body re-render', () => {
    desktopViewport();
    const record: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderTable(
      <DataTable rows={rows} columns={countingColumns(record)} rowKey={(r) => r.id} tableId="memo-touch" />,
    );
    record.length = 0;
    setItem.mockClear();

    const handle = screen.getByRole('separator', { name: 'Resize Amount column' });
    fireEvent.touchStart(handle, { touches: [{ clientX: 0 }] });
    for (let i = 1; i <= 15; i += 1) fireEvent.touchMove(window, { touches: [{ clientX: i }] });
    expect(setItem.mock.calls.filter(([key]) => key === widthsKey('memo-touch'))).toHaveLength(0);
    expect(record).toEqual([]);

    fireEvent.touchEnd(window, { touches: [] });
    expect(setItem.mock.calls.filter(([key]) => key === widthsKey('memo-touch'))).toHaveLength(1);
    expect(record).toEqual([]);
    expect(screen.getByRole('separator', { name: 'Resize Amount column' })).toHaveAttribute('aria-valuenow', '115');
  });

  it('AC-PERF-2102 (C1): a lost mouseup does not freeze the body — a window blur ends the gesture, persists once, and later data still paints', () => {
    desktopViewport();
    const record: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const columns = countingColumns(record);
    const view = renderTable(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} tableId="memo-lostup" />,
    );
    record.length = 0;
    setItem.mockClear();

    const handle = screen.getByRole('separator', { name: 'Resize Name column' });
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 130 });
    expect(record).toEqual([]); // the drag freezes the body (the perf win this issue ships)

    // The pointer-up never arrives (released outside the browser, app deactivated mid-drag):
    // the blur IS the gesture end — the width is persisted once and the body is unfrozen.
    act(() => { window.dispatchEvent(new Event('blur')); });
    const writes = () => setItem.mock.calls.filter(([key]) => key === widthsKey('memo-lostup'));
    expect(writes()).toHaveLength(1);
    expect(handle).toHaveAttribute('aria-valuenow', '210');

    const renamed: Row[] = [{ ...rows[0], name: 'Alpha II' }, rows[1], rows[2]];
    view.rerender(<DataTable rows={renamed} columns={columns} rowKey={(r) => r.id} tableId="memo-lostup" />);
    expect(screen.getByText('Alpha II')).toBeInTheDocument();
    expect(writes()).toHaveLength(1); // a gesture end is one write, never one per ended signal
  });

  it('AC-PERF-2102 (C1): a pointercancel ends a drag and unfreezes the body too', () => {
    desktopViewport();
    const record: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const columns = countingColumns(record);
    const view = renderTable(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} tableId="memo-cancel" />,
    );
    record.length = 0;
    setItem.mockClear();

    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize Name column' }), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 110 });
    expect(record).toEqual([]);
    act(() => { window.dispatchEvent(new Event('pointercancel')); });
    expect(setItem.mock.calls.filter(([key]) => key === widthsKey('memo-cancel'))).toHaveLength(1);

    view.rerender(
      <DataTable rows={[{ ...rows[0], name: 'Alpha II' }, rows[1], rows[2]]} columns={columns} rowKey={(r) => r.id} tableId="memo-cancel" />,
    );
    expect(screen.getByText('Alpha II')).toBeInTheDocument();
  });

  it('AC-PERF-2102 (I1): a rowMenu/selection flip beside a stable columns array grows every row to the header count', () => {
    desktopViewport();
    const record: string[] = [];
    const columns = countingColumns(record);
    const rowMenu = () => [{ label: 'Edit', onClick: vi.fn() }];
    const view = renderTable(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const bodyRow = () => screen.getAllByRole('row')[1]!;
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(within(bodyRow()).getAllByRole('cell')).toHaveLength(2);

    // A permission-gated menu appears while `columns` keeps its identity: the header gains the
    // actions column, and every memoised row must gain its cell too — otherwise the menu header
    // sits over the data and the row has no ⋯ trigger at all.
    view.rerender(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowMenu={rowMenu} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(within(screen.getAllByRole('row')[1]!).getAllByRole('cell')).toHaveLength(3);
    expect(within(screen.getAllByRole('row')[1]!).getByRole('button', { name: /row actions|more|⋯/i })).toBeInTheDocument();

    // Same hole on the selection column.
    view.rerender(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={rowMenu}
        selection={{ selectedIds: new Set<string>(), onChange: vi.fn(), rowLabel: (r) => `Select ${r.name}` }}
      />,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(within(screen.getAllByRole('row')[1]!).getAllByRole('cell')).toHaveLength(4);
  });

  it('AC-PERF-2102: a keyboard resize stays a discrete persisted step and re-renders no body row', () => {
    desktopViewport();
    const record: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderTable(
      <DataTable rows={rows} columns={countingColumns(record)} rowKey={(r) => r.id} tableId="memo-keys" />,
    );
    record.length = 0;
    setItem.mockClear();

    const handle = screen.getByRole('separator', { name: 'Resize Name column' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '196');
    expect(setItem.mock.calls.filter(([key]) => key === widthsKey('memo-keys'))).toHaveLength(1);
    expect(record).toEqual([]);
  });

  it('AC-PERF-2102: a parent re-render that changes nothing (stable props) re-renders no body row', () => {
    desktopViewport();
    const record: string[] = [];
    const columns = countingColumns(record);
    const rowMenu = () => [{ label: 'Edit', onClick: vi.fn() }];
    const ui = (
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowMenu={rowMenu} onActivate={vi.fn()} />
    );
    const view = renderTable(ui);
    record.length = 0;
    view.rerender(ui);
    expect(record).toEqual([]);
  });

  it('AC-PERF-2102: a memoised-columns page re-rendering for a toast re-renders no body row', () => {
    desktopViewport();
    const record: string[] = [];
    function Harness({ tick }: { tick: number }) {
      // The heavy-table pattern: columns built in useMemo over their semantic deps.
      const columns = useMemo(() => countingColumns(record), []);
      const rowMenu = useCallback(() => [{ label: 'Edit', onClick: vi.fn() }], []);
      return (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowMenu={rowMenu}
          onActivate={vi.fn()}
          className={tick % 2 ? 'toast-a' : 'toast-b'}
        />
      );
    }
    const view = renderTable(<Harness tick={0} />);
    record.length = 0;
    view.rerender(<Harness tick={1} />);
    expect(record).toEqual([]);
  });

  it('AC-PERF-2102: a semantic column change (new closures over new state) re-renders rows even with unchanged row data — memo never freezes money states', () => {
    desktopViewport();
    const record: string[] = [];
    // ManagementPack pattern: the cell closure reads page state captured at columns-build time.
    const view = renderTable(
      <DataTable
        rows={rows}
        columns={[{ key: 'name', header: 'Name', cell: (row) => { record.push(row.id); return `status-1:${row.name}`; } }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('status-1:Alpha')).toBeInTheDocument();
    record.length = 0;
    view.rerender(
      <DataTable
        rows={rows}
        columns={[{ key: 'name', header: 'Name', cell: (row) => { record.push(row.id); return `status-2:${row.name}`; } }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('status-2:Alpha')).toBeInTheDocument();
    expect(screen.queryByText('status-1:Alpha')).not.toBeInTheDocument();
    expect(record.length).toBeGreaterThan(0);
  });

  it('AC-PERF-2102: a row whose data changed still re-renders — memo never freezes stale data', () => {
    desktopViewport();
    const record: string[] = [];
    const columns = countingColumns(record);
    const view = renderTable(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    record.length = 0;
    const renamed: Row[] = [{ ...rows[0], name: 'Alpha II' }, rows[1], rows[2]];
    view.rerender(<DataTable rows={renamed} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText('Alpha II')).toBeInTheDocument();
    expect(record).toEqual(['A', 'A$']);
  });

  it('AC-PERF-2102: a locale switch alone re-renders body rows (cell closures must not go stale)', async () => {
    desktopViewport();
    const record: string[] = [];
    const columns = countingColumns(record);
    const rowMenu = () => [];
    const onActivate = vi.fn();
    // ONE render with a STABLE columns array, then only the language changes: a new columns
    // identity would re-render the rows by itself and prove nothing about `fingerprint`.
    renderTable(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowMenu={rowMenu} onActivate={onActivate} />);
    record.length = 0;
    await act(async () => { await i18nextTest.changeLanguage('id'); });
    expect(record.length).toBeGreaterThan(0);
  });

  it('AC-PERF-2102: a selection toggle re-renders only the toggled row', async () => {
    desktopViewport();
    const record: string[] = [];
    function Harness() {
      const [ids, setIds] = useState<Set<string>>(new Set());
      // The heavy-table pattern (ManagementPack et al.): columns memoised over semantic deps,
      // so a selection toggle re-renders only the toggled row.
      const columns = useMemo(() => countingColumns(record), []);
      return (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          selection={{ selectedIds: ids, onChange: setIds, rowLabel: (r) => `Select ${r.name}` }}
        />
      );
    }
    renderTable(<Harness />);
    record.length = 0;
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
    expect(record).toEqual(['B', 'B$']);
  });
});

describe('DataTable mobile card render cost (issue #2102)', () => {
  // Every test here renders with a STABLE columns array (useMemo / a module-level const), the
  // heavy-table pattern: the card memo is keyed on that identity too, so a harness that rebuilt
  // columns inline would repaint every card and prove nothing. Do not "simplify" that away.
  it('AC-PERF-2102: a memoised-columns page re-rendering for a toast re-renders no card', () => {
    mobileViewport();
    const record: string[] = [];
    function Harness({ tick }: { tick: number }) {
      const columns = useMemo(() => countingColumns(record), []);
      return (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
          onActivate={vi.fn()}
          rowLabel={(r) => `Open ${r.name}`}
          className={tick % 2 ? 'toast-a' : 'toast-b'}
        />
      );
    }
    const view = renderTable(<Harness tick={0} />);
    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    record.length = 0;
    view.rerender(<Harness tick={1} />);
    expect(record).toEqual([]);
  });

  it('AC-PERF-2102 (I1, mobile): a selection/menu flip beside a stable columns array repaints the card', () => {
    mobileViewport();
    const record: string[] = [];
    const columns = countingColumns(record);
    const rowMenu = () => [{ label: 'Edit', onClick: vi.fn() }];
    const view = renderTable(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => `Open ${r.name}`} />);
    expect(screen.queryByRole('checkbox', { name: /Select / })).not.toBeInTheDocument();

    view.rerender(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={(r) => `Open ${r.name}`}
        rowMenu={rowMenu}
        selection={{ selectedIds: new Set<string>(), onChange: vi.fn(), rowLabel: (r) => `Select ${r.name}` }}
      />,
    );
    // The cards keep their identity, so the checkbox and ⋯ menu only appear if the presence
    // keys are part of the card memo.
    expect(screen.getByRole('checkbox', { name: 'Select Beta' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Row actions' })).toHaveLength(rows.length);
  });

  it('AC-PERF-2102: a selection toggle re-renders only the toggled card', async () => {
    mobileViewport();
    const record: string[] = [];
    function Harness() {
      const [ids, setIds] = useState<Set<string>>(new Set());
      const columns = useMemo(() => countingColumns(record), []);
      return (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowLabel={(r) => `Open ${r.name}`}
          selection={{ selectedIds: ids, onChange: setIds, rowLabel: (r) => `Select ${r.name}` }}
        />
      );
    }
    renderTable(<Harness />);
    record.length = 0;
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Gamma' }));
    expect(record).toEqual(['C', 'C$']);
  });

  it('AC-PERF-2102: a card whose data changed still re-renders — memo never freezes stale data', () => {
    mobileViewport();
    const record: string[] = [];
    const columns = countingColumns(record);
    const view = renderTable(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => `Open ${r.name}`} />,
    );
    record.length = 0;
    const renamed: Row[] = [rows[0], { ...rows[1], name: 'Beta II' }, rows[2]];
    view.rerender(
      <DataTable rows={renamed} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => `Open ${r.name}`} />,
    );
    expect(screen.getByText('Beta II')).toBeInTheDocument();
    expect(record).toEqual(['B', 'B$']);
  });
});
