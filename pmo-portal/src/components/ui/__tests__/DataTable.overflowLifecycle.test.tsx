import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DataTable, type Column } from '../DataTable';
import { DataTableWidget } from '@/src/components/panel/widgets/DataTableWidget';

afterEach(() => vi.unstubAllGlobals());

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observedElements: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observedElements.push(target);
  }

  disconnect() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function stubScrollMetrics(
  scrollport: HTMLElement,
  initial: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  const metrics = { ...initial };
  for (const key of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
    Object.defineProperty(scrollport, key, {
      configurable: true,
      get: () => metrics[key],
    });
  }
  return metrics;
}

/** matchMedia stub that tracks the desktop breakpoint over time: `setDesktop` flips the
 *  answer and fires the captured `change` listeners exactly like a real viewport resize
 *  crossing the `md` breakpoint (useIsDesktop keeps itself in sync via that listener). */
function stubMatchMedia(initialDesktop: boolean) {
  const changeListeners = new Set<(event: { matches: boolean; media: string }) => void>();
  let desktop = initialDesktop;
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('min-width: 768px') ? desktop : false,
    media: query, onchange: null,
    addEventListener: (_type: string, listener: (event: { matches: boolean; media: string }) => void) => { changeListeners.add(listener); },
    removeEventListener: (_type: string, listener: (event: { matches: boolean; media: string }) => void) => { changeListeners.delete(listener); },
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
  return {
    setDesktop(next: boolean) {
      desktop = next;
      for (const listener of changeListeners) listener({ matches: next, media: '(min-width: 768px)' });
    },
  };
}

interface Row {
  id: string;
  name: string;
  value: number;
}
const rows: Row[] = [
  { id: 'PRJ-1', name: 'Alpha', value: 1200 },
  { id: 'PRJ-2', name: 'Beta', value: 980 },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, sortKey: 'name' },
  { key: 'value', header: 'Value', align: 'num', cell: (r) => r.value },
];

// Overflow-lifecycle regression (post-extraction review fix): the pre-extraction
// component reported `onOverflowChange(false)` whenever the branch decision was NOT
// desktop — at the initial mobile render and whenever the viewport leaves desktop —
// so the consumer's scroll mask (DataTableWidget's `data-table-widget-scroll-mask`)
// cleared. The desktop module unmounts on that transition, so the report must live
// at the DataTable owner level, which stays mounted across the switch.
describe('DataTable overflow lifecycle (responsive switch)', () => {
  it('reports onOverflowChange(false) at an initial mobile render so a consumer mask never mounts over cards', () => {
    const onOverflowChange = vi.fn();
    stubMatchMedia(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onOverflowChange={onOverflowChange} />);

    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    expect(screen.queryByTestId('dt-table-branch')).toBeNull();
    expect(onOverflowChange).toHaveBeenCalledWith(false);
  });

  it('reports false when an overflowing desktop table switches to the mobile card branch, clearing the consumer scroll mask', () => {
    const onOverflowChange = vi.fn();
    const viewport = stubMatchMedia(true);
    TestResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
        onOverflowChange={onOverflowChange}
      />,
    );

    const scrollport = screen.getByTestId('dt-table-branch');
    stubScrollMetrics(scrollport, { scrollWidth: 500, clientWidth: 300, scrollLeft: 0 });
    const observer = TestResizeObserver.instances[0];
    act(() => observer.trigger());
    expect(scrollport).toHaveAttribute('data-dt-overflowing', '');
    expect(onOverflowChange).toHaveBeenLastCalledWith(true);

    act(() => viewport.setDesktop(false));
    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    expect(screen.queryByTestId('dt-table-branch')).toBeNull();
    // Leaving desktop must report false — the mask would otherwise stay painted over the cards.
    expect(onOverflowChange).toHaveBeenLastCalledWith(false);
  });

  it('unmounts the DataTableWidget scroll mask when an overflowing desktop table narrows to mobile', () => {
    const viewport = stubMatchMedia(true);
    TestResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    render(
      <DataTableWidget
        widget={{
          kind: 'data_table',
          caption: 'Wide data',
          columns: [{ key: 'name', label: 'Project' }],
          rows: [{ name: 'Alpha' }, { name: 'Beta' }],
        }}
      />,
    );

    const scrollport = screen.getByTestId('dt-table-branch');
    stubScrollMetrics(scrollport, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    const observer = TestResizeObserver.instances[0];
    act(() => observer.trigger());
    expect(screen.getByTestId('data-table-widget-scroll-mask')).toBeInTheDocument();

    act(() => viewport.setDesktop(false));
    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    // The consumer's mask derives solely from the overflow callback — it must be gone.
    expect(screen.queryByTestId('data-table-widget-scroll-mask')).toBeNull();
  });
});
