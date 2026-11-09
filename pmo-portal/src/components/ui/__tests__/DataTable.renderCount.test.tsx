import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DataTable, type Column } from '../DataTable';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Row { id: string; name: string }
const rows: Row[] = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }];

/** A real browser measures overflow in the first layout effect; jsdom has no layout, so give every
 *  element the metrics up front (the stub must exist BEFORE mount to exercise the first measurement). */
function stubLayout(metrics: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  for (const key of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
    vi.spyOn(Element.prototype, key, 'get').mockImplementation(() => metrics[key]);
  }
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 768px'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  return metrics;
}

/** jsdom has no ResizeObserver and no layout: capture the observer and fire its callback by hand,
 *  exactly like a real browser fires it after the scrollport's or table's box changes. */
class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
  observe(_target: Element) {}
  disconnect() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function mount() {
  const cell = vi.fn((r: Row) => r.name);
  const columns: Column<Row>[] = [{ key: 'name', header: 'Name', cell }];
  render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]} />);
  return { cell };
}

describe('DataTable render count (desktop sticky seam)', () => {
  it('AC-TBL-STICKY-001 renders the desktop body once on mount even when the first measurement finds hidden right content', () => {
    stubLayout({ scrollWidth: 500, clientWidth: 300, scrollLeft: 0 });
    const { cell } = mount();

    // The seam is still painted in that first commit...
    expect(screen.getByTestId('dt-table-branch')).toHaveAttribute('data-dt-overflowing', '');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(rows.length + 1);
    // ...without a second render of the table body (one cell call per row per body render; a Profiler
    // cannot tell, since the seam strips' own pre-paint update is also a commit).
    expect(cell).toHaveBeenCalledTimes(rows.length);
  });

  it('AC-TBL-STICKY-001 does not re-render the body when scrolling toggles the seam', () => {
    const metrics = stubLayout({ scrollWidth: 500, clientWidth: 300, scrollLeft: 0 });
    const { cell } = mount();
    cell.mockClear();
    const scrollport = screen.getByTestId('dt-table-branch');

    metrics.scrollLeft = 200;
    fireEvent.scroll(scrollport);
    expect(scrollport).not.toHaveAttribute('data-dt-overflowing');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(0);

    metrics.scrollLeft = 0;
    act(() => { fireEvent.scroll(scrollport); });
    expect(scrollport).toHaveAttribute('data-dt-overflowing', '');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(rows.length + 1);
    expect(cell).not.toHaveBeenCalled();
  });

  it('AC-TBL-STICKY-001 tracks a scrollport resize: seam appears when the viewport narrows and disappears when it widens, without re-rendering the body', () => {
    TestResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const metrics = stubLayout({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    const { cell } = mount();
    const scrollport = screen.getByTestId('dt-table-branch');
    expect(scrollport).not.toHaveAttribute('data-dt-overflowing');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(0);

    act(() => { TestResizeObserver.instances[0].trigger(); }); // still fits: no change
    expect(scrollport).not.toHaveAttribute('data-dt-overflowing');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(0);

    metrics.clientWidth = 200; // viewport narrows below the table width
    act(() => { TestResizeObserver.instances[0].trigger(); });
    expect(scrollport).toHaveAttribute('data-dt-overflowing', '');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(rows.length + 1);
    // A resize alone must not re-render the table body — the seam store updates only the strips.
    expect(cell).toHaveBeenCalledTimes(rows.length);

    metrics.clientWidth = 300; // viewport widens back: overflow is gone again
    act(() => { TestResizeObserver.instances[0].trigger(); });
    expect(scrollport).not.toHaveAttribute('data-dt-overflowing');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(0);
    expect(cell).toHaveBeenCalledTimes(rows.length);
  });

  it('AC-TBL-STICKY-001 tracks the rows: the seam appears when they widen the table past the scrollport and disappears when a smaller page fits; the shrink repaints nothing and the flips add no body render', () => {
    TestResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const metrics = stubLayout({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    const cell = vi.fn((r: Row) => r.name);
    const columns: Column<Row>[] = [{ key: 'name', header: 'Name', cell }];
    const rowMenu = () => [{ label: 'Edit', onClick: vi.fn() }];
    const { rerender } = render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowMenu={rowMenu} />,
    );
    const scrollport = screen.getByTestId('dt-table-branch');
    expect(scrollport).not.toHaveAttribute('data-dt-overflowing');
    expect(cell).toHaveBeenCalledTimes(rows.length);

    metrics.scrollWidth = 500; // wider rows land (simulated by the layout metrics)
    act(() => { TestResizeObserver.instances[0].trigger(); });
    expect(scrollport).toHaveAttribute('data-dt-overflowing', '');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(rows.length + 1);
    expect(cell).toHaveBeenCalledTimes(rows.length); // a measurement flip alone re-renders no body row

    metrics.scrollWidth = 300; // next page shrinks to one UNCHANGED row (the same object) that fits
    rerender(<DataTable rows={[rows[0]!]} columns={columns} rowKey={(r) => r.id} rowMenu={rowMenu} />);
    // The shrink removes two rows and repaints NONE of them (#2102 row memo: untouched data)…
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    expect(cell).toHaveBeenCalledTimes(rows.length);
    act(() => { TestResizeObserver.instances[0].trigger(); });
    expect(scrollport).not.toHaveAttribute('data-dt-overflowing');
    expect(document.querySelectorAll('[data-dt-seam]')).toHaveLength(0);
    // ...and the seam flip adds nothing.
    expect(cell).toHaveBeenCalledTimes(rows.length);
  });

  it('#2102 row memo: a list shrink paints the surviving row without re-running its cell', () => {
    stubLayout({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    const cell = vi.fn((r: Row) => r.name);
    const columns: Column<Row>[] = [{ key: 'name', header: 'Name', cell }];
    const { rerender } = render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1); // header + 3
    expect(cell).toHaveBeenCalledTimes(rows.length);

    // The surviving row is the SAME object, so the shrink removes two rows and repaints none.
    rerender(<DataTable rows={[rows[0]!]} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + the survivor
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    expect(cell).toHaveBeenCalledTimes(rows.length);
  });
});
