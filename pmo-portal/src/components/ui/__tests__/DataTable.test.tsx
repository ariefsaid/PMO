import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DataTable, type Column } from '../DataTable';

afterEach(() => vi.unstubAllGlobals());

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
  it('UXS-006: localizes shared accessible row and action names', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'id',
      fallbackLng: 'en',
      resources: {
        en: { translation: { table: { actions: 'Actions', openRow: 'Open {{name}}', rowActions: 'Row actions' } } },
        id: { translation: { table: { actions: 'Tindakan', openRow: 'Buka {{name}}', rowActions: 'Tindakan baris' } } },
      },
      interpolation: { escapeValue: false },
    });
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 768px'), media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    render(
      <I18nextProvider i18n={i18n}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          onActivate={vi.fn()}
          rowLabel={(row) => `Open ${row.name}`}
          rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole('button', { name: 'Buka Alpha' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Tindakan baris' })).toHaveLength(rows.length);
    expect(screen.getByRole('columnheader', { name: 'Tindakan' })).toBeInTheDocument();
  });

  it('#961 open-case-scroll exposes a focusable row target in both table and card branches', () => {
    const rowTarget = (row: Row) => row.id === 'PRJ-1' ? 'target-alpha' : undefined;
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: true, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    const desktop = render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} rowTarget={rowTarget} />);
    expect(document.getElementById('target-alpha')?.tagName).toBe('TR');
    expect(document.getElementById('target-alpha')).toHaveAttribute('tabindex', '-1');
    desktop.unmount();

    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} rowTarget={rowTarget} />);
    expect(document.getElementById('target-alpha')?.tagName).toBe('LI');
    expect(document.getElementById('target-alpha')).toHaveAttribute('tabindex', '-1');
  });

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

  it('sortable header with no `sort` prop renders without a sort icon and without throwing (null-safety guard)', () => {
    // No `sort` prop at all — a sortable column must not deref `sort.dir` on an undefined `sort`.
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onSort={vi.fn()} />);
    const nameTh = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameTh).toHaveAttribute('aria-sort', 'none');
    expect(nameTh.querySelector('svg')).not.toBeInTheDocument();
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

  it('AC-TBL-STICKY-001 keeps the desktop row-actions header and cells pinned with an opaque separated surface', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />
    );

    const header = screen.getByRole('columnheader', { name: 'Actions' });
    const actionCell = screen.getAllByRole('button', { name: /row actions/i })[0].closest('td')!;
    // Chromium table-cell paint quirks (2026-10-08 fix round, see ROW_MENU_STICKY_CLASS):
    // - `-right-px`: the cell sticks 1px PAST the scrollport edge so the scroller's own clip
    //   closes the 1px seam through which scrolled text otherwise shows (the cell's painted bg
    //   stops ~1px short of its layout edge when stuck flush with `right-0`).
    // - Inset hairline box-shadow instead of `border-l`: in a border-collapse table the collapsed
    //   border does NOT travel with a sticky cell; the inset shadow paints with the cell.
    const sharedClasses = [
      'sticky',
      '-right-px',
      'bg-card',
      'shadow-[inset_1px_0_0_hsl(var(--border))]',
    ];

    for (const className of sharedClasses) {
      expect(header.className).toContain(className);
      expect(actionCell.className).toContain(className);
    }
    expect(header.className).not.toContain('border-l');
    expect(actionCell.className).not.toContain('border-l');
    expect(header.className).toContain('z-[3]');
    expect(actionCell.className).toContain('z-[1]');
  });

  it('AC-TBL-STICKY-001 renders the left-cast separation gradient in BOTH sticky cells — outset box-shadows do not paint on sticky table cells, so the strip is a positioned element', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />
    );

    const seams = document.querySelectorAll<HTMLSpanElement>('[data-dt-seam]');
    expect(seams.length).toBeGreaterThanOrEqual(2); // one in the header th, one in each body td
    for (const seam of seams) {
      expect(seam.getAttribute('aria-hidden')).toBe('true');
      expect(seam.className).toContain('absolute');
      expect(seam.className).toContain('-left-3');
      expect(seam.className).toContain('bg-gradient-to-l');
      expect(seam.className).toContain('from-[hsl(var(--foreground)/0.16)]');
      expect(seam.className).toContain('pointer-events-none');
    }
  });

  it('per-row rowMenu returning undefined ("no menu for this row") skips that row\'s trigger, other rows unaffected', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={(r) => (r.id === 'PRJ-1' ? [{ label: 'Delete', onClick: vi.fn() }] : undefined)}
      />
    );
    // Alpha (PRJ-1) gets a trigger; Beta (PRJ-2) — undefined menu — gets none.
    expect(screen.getAllByRole('button', { name: /row actions/i })).toHaveLength(1);
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

  // ── WAI-ARIA menu pattern: a disabled item stays FOCUSABLE ──────────────────
  // An HTML `disabled` button is unfocusable, so when the FIRST menu item is disabled
  // the open-focus `el.focus()` was a no-op and keyboard focus stayed on the trigger —
  // arrows/Escape were dead. `aria-disabled` keeps the item in the tab/focus order so
  // the roving focus always has a landing spot; the activate guard makes Enter a no-op.
  it('a disabled FIRST item takes focus on open; ArrowDown roves off it; Enter does nothing; Escape closes', async () => {
    const busyClick = vi.fn();
    const downloadClick = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [
          { label: 'Preparing PDF…', onClick: busyClick, disabled: true },
          { label: 'Download PDF', onClick: downloadClick },
        ]}
      />
    );
    const trigger = screen.getAllByRole('button', { name: /row actions/i })[0];
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu');
    const disabled = within(menu).getByRole('menuitem', { name: 'Preparing PDF…' });
    // aria-disabled — announced disabled, but NOT the unfocusable HTML attribute.
    await waitFor(() => expect(disabled).toHaveAttribute('aria-disabled', 'true'));
    expect(disabled).not.toBeDisabled();
    // muted styling survives the switch
    expect(disabled.className).toContain('text-muted-foreground');
    // on open, focus lands on that first (disabled) item — not stranded on the trigger.
    expect(disabled).toHaveFocus();
    // ArrowDown roves to the next item; ArrowUp back onto the disabled one.
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Download PDF' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(disabled).toHaveFocus();
    // Enter on the disabled item does nothing — guard holds, menu stays open.
    await userEvent.keyboard('{Enter}');
    expect(busyClick).not.toHaveBeenCalled();
    expect(downloadClick).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Escape closes and restores focus to the trigger.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
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
