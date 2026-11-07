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
});
