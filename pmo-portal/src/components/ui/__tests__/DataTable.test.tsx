import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';

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

describe('DataTable', () => {
  it('renders one row per record and the column headers', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  });

  it('numeric columns right-align', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Value' }).className).toContain('text-right');
  });

  it('sortable header toggles aria-sort and calls the sort handler', async () => {
    const onSort = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        sort={{ key: 'name', dir: 'asc' }}
        onSort={onSort}
      />
    );
    const nameTh = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameTh).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(within(nameTh).getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('a11y: activatable body rows keep their implicit role="row" (NOT role="link"), so getByRole("row") finds them', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={vi.fn()}
        rowLabel={(r) => `Open ${r.name}`}
      />
    );
    const alphaRow = screen.getByText('Alpha').closest('tr')!;
    // The invalid role="link" override is gone — the <tr> keeps role="row".
    expect(alphaRow).not.toHaveAttribute('role', 'link');
    // header row + 2 body rows are all discoverable as rows.
    expect(screen.getAllByRole('row').length).toBe(rows.length + 1);
  });

  it('a11y: each activatable row exposes a focusable button carrying the row accessible name', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
      />
    );
    const openAlpha = screen.getByRole('button', { name: 'Open Alpha' });
    // ring token + positive (outset) offset — never the inset/black variant.
    expect(openAlpha.className).toContain('focus-visible:outline-offset-2');
    expect(openAlpha.className).not.toContain('focus-visible:-outline-offset-2');
    expect(openAlpha.className).toContain('focus-visible:outline-ring');
    // keyboard activation: focus the button and press Enter.
    openAlpha.focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  it('row click activates (pointer convenience) without double-firing the in-cell button', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
      />
    );
    // click the row body (a non-button cell) → one activation
    await userEvent.click(screen.getByText('980'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
    onActivate.mockClear();
    // click the in-cell button → exactly one activation (stopPropagation prevents the row's too)
    await userEvent.click(screen.getByRole('button', { name: 'Open Alpha' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  it('state="empty" renders ListState empty in place of the body', () => {
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        state="empty"
        emptyTitle="No projects"
      />
    );
    expect(screen.getByText('No projects')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('state="loading" renders the loading ListState', () => {
    render(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} state="loading" />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('state="error" renders an alert with a Retry that calls onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        state="error"
        errorTitle="Load failed"
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('marks the selected row with the primary tint', () => {
    render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} selectedKey="PRJ-1" />
    );
    expect(screen.getByText('Alpha').closest('tr')!.className).toContain('bg-primary/[0.07]');
  });

  it('Toolbar/SearchMini/TableFoot render their content', async () => {
    const { Toolbar, SearchMini, TableFoot } = await import('../DataTable');
    render(
      <div>
        <Toolbar standalone>
          <SearchMini placeholder="Find…" />
        </Toolbar>
        <TableFoot>
          <span>Total: 2,180</span>
        </TableFoot>
      </div>
    );
    expect(screen.getByPlaceholderText('Find…')).toBeInTheDocument();
    expect(screen.getByText('Total: 2,180')).toBeInTheDocument();
  });

  it('row menu opens on its trigger and Esc closes it', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Delete', danger: true, onClick: vi.fn() }]}
      />
    );
    const trigger = screen.getAllByRole('button', { name: /row actions/i })[0];
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('separates a danger item from the items above it with a hairline separator (destructive-nav-separation)', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Archive', onClick: vi.fn() },
          { label: 'Delete', danger: true, onClick: vi.fn() },
        ]}
      />
    );
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    const menu = screen.getByRole('menu');
    const sep = within(menu).getByRole('separator');
    expect(sep).toBeInTheDocument();
    // The separator sits ABOVE Delete (between Archive and Delete).
    const items = Array.from(menu.children);
    const sepIndex = items.indexOf(sep);
    const deleteIndex = items.findIndex((el) => el.textContent === 'Delete');
    expect(sepIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBe(sepIndex + 1);
  });

  it('does NOT render a separator when a danger item is the only / first item', async () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Delete', danger: true, onClick: vi.fn() }]}
      />
    );
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    expect(within(screen.getByRole('menu')).queryByRole('separator')).not.toBeInTheDocument();
  });

  // ── Cause-1 guard: inline interactive controls must NOT fire onActivate ──────
  it('clicking an in-row <select> does NOT fire onActivate (interactive-element guard)', async () => {
    const onActivate = vi.fn();
    const cols: Column<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        cell: (r) => r.name,
      },
      {
        key: 'value',
        header: 'Status',
        cell: (r) => (
          <select aria-label={`Status for ${r.name}`} defaultValue="open">
            <option value="open">Open</option>
            <option value="done">Done</option>
          </select>
        ),
      },
    ];
    render(
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Edit ${r.name}`}
      />
    );
    // clicking the <select> must NOT trigger onActivate
    await userEvent.click(screen.getByRole('combobox', { name: 'Status for Alpha' }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('clicking the activation button DOES fire onActivate even when in-row controls exist', async () => {
    const onActivate = vi.fn();
    const cols: Column<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        cell: (r) => r.name,
      },
      {
        key: 'value',
        header: 'Status',
        cell: (r) => (
          <select aria-label={`Status for ${r.name}`} defaultValue="open">
            <option value="open">Open</option>
            <option value="done">Done</option>
          </select>
        ),
      },
    ];
    render(
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Edit ${r.name}`}
      />
    );
    // clicking the activation button SHOULD fire onActivate
    await userEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });
});

// ── A-C-1 regression: mobile card <dd> value clipping at 390px ────────────────
// When the DataTable renders the card branch (<768px), long unbroken string values
// in <dd> elements must carry `min-w-0` and `break-words` so they wrap within the
// grid column and are never clipped off the card edge.
// jsdom has no real layout so we assert the applied classes + DOM presence (class
// presence = the correct flexbox/grid overflow prevention; DOM presence = text is
// in the document regardless of viewport width).
// No `truncate` without an associated `title` attribute is permitted — silent
// truncation is a content-loss defect.
describe('DataTable — A-C-1: mobile card <dd> wrapping (no value clipping at 390px)', () => {
  function mockMobile() {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false, // <768px → card branch
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it('A-C-1: <dd> carries min-w-0 and break-words so long values wrap instead of clipping', () => {
    mockMobile();

    const LONG_VALUE = 'REMOTE_PLATFORM_ALPHA_BRAVO_CHARLIE_DELTA_ECHO_FOXTROT_123456789_LOCATION';

    interface LongRow { id: string; label: string; location: string }
    const longCols: Column<LongRow>[] = [
      { key: 'label', header: 'Name', cell: (r) => r.label },
      { key: 'location', header: 'Location', cell: (r) => r.location },
    ];
    const longRows: LongRow[] = [{ id: 'INC-1', label: 'Incident 1', location: LONG_VALUE }];

    render(
      <DataTable
        rows={longRows}
        columns={longCols}
        rowKey={(r) => r.id}
      />,
    );

    // The long value text must be in the DOM — never silently dropped.
    expect(screen.getByText(LONG_VALUE)).toBeInTheDocument();

    // The <dd> must carry the wrapping classes that prevent overflow-clipping.
    const cardBranch = document.querySelector('[data-testid="dt-card-branch"]')!;
    const locationDt = Array.from(cardBranch.querySelectorAll('dt')).find(
      (dt) => dt.textContent === 'Location',
    );
    expect(locationDt).toBeTruthy();
    const locationDd = locationDt!.nextElementSibling as HTMLElement;
    expect(locationDd.tagName).toBe('DD');

    // min-w-0 prevents the grid child from overflowing its 1fr column.
    expect(locationDd.className).toContain('min-w-0');
    // break-words forces the long unbroken string to wrap.
    expect(locationDd.className).toContain('break-words');
  });

  it('A-C-1: the <dl> grid parent does not have overflow-hidden that would clip <dd> content', () => {
    mockMobile();

    interface SimpleRow { id: string; name: string; val: string }
    const simpleCols: Column<SimpleRow>[] = [
      { key: 'name', header: 'Name', cell: (r) => r.name },
      { key: 'val', header: 'Val', cell: (r) => r.val },
    ];
    const simpleRows: SimpleRow[] = [{ id: 'R-1', name: 'Row 1', val: 'some value' }];

    render(
      <DataTable
        rows={simpleRows}
        columns={simpleCols}
        rowKey={(r) => r.id}
      />,
    );

    const cardBranch = document.querySelector('[data-testid="dt-card-branch"]')!;
    // The <dl> grid parent (direct parent of dt/dd) must not apply overflow-hidden.
    const dl = cardBranch.querySelector('dl');
    expect(dl).toBeTruthy();
    expect(dl!.className).not.toContain('overflow-hidden');
  });
});
