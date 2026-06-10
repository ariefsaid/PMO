import { describe, it, expect, vi } from 'vitest';
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

// Helper: get the desktop table branch wrapper (hidden md:block).
// The dual-render (OD-W4-4) places the <table> inside this container and
// the card list in a sibling; scoping to this branch keeps the existing
// desktop-table assertions stable.
function getTableBranch() {
  return document.querySelector('[data-testid="dt-table-branch"]') as HTMLElement;
}

describe('DataTable', () => {
  it('renders one row per record and the column headers', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const branch = getTableBranch();
    // Each value appears in both branches (dual-render) — use getAllByText to find any.
    expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Beta').length).toBeGreaterThanOrEqual(1);
    // Column headers are only in the table branch (no thead in cards).
    expect(within(branch).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  });

  it('numeric columns right-align', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const branch = getTableBranch();
    expect(within(branch).getByRole('columnheader', { name: 'Value' }).className).toContain('text-right');
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
    const branch = getTableBranch();
    const nameTh = within(branch).getByRole('columnheader', { name: /Name/ });
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
    const branch = getTableBranch();
    // Scope to the table branch so we're testing <tr> semantics, not the card list.
    const alphaTexts = within(branch).getAllByText('Alpha');
    const alphaRow = alphaTexts[0].closest('tr')!;
    // The invalid role="link" override is gone — the <tr> keeps role="row".
    expect(alphaRow).not.toHaveAttribute('role', 'link');
    // header row + 2 body rows are all discoverable as rows inside the table branch.
    expect(within(branch).getAllByRole('row').length).toBe(rows.length + 1);
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
    // Scope to the table branch — the card branch also has an "Open Alpha" button,
    // but this test is specifically about the <td>-level button in the desktop table.
    const branch = getTableBranch();
    const openAlpha = within(branch).getByRole('button', { name: 'Open Alpha' });
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
    const branch = getTableBranch();
    // click the row body (a non-button cell) → one activation.
    // '980' only appears in the value column of the table branch.
    await userEvent.click(within(branch).getByText('980'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
    onActivate.mockClear();
    // click the in-cell button → exactly one activation (stopPropagation prevents the row's too).
    await userEvent.click(within(branch).getByRole('button', { name: 'Open Alpha' }));
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
    expect(screen.getAllByText('No projects').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('state="loading" renders the loading ListState', () => {
    render(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} state="loading" />);
    // Both branches render ListState in the async-state path — at least one is present.
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThanOrEqual(1);
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
    // Both branches render the error alert — use getAllByRole and check the first.
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('Load failed');
    // Both Retry buttons call the same onRetry — click the first.
    await userEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]);
    expect(onRetry).toHaveBeenCalled();
  });

  it('marks the selected row with the primary tint', () => {
    render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} selectedKey="PRJ-1" />
    );
    const branch = getTableBranch();
    const alphaText = within(branch).getAllByText('Alpha')[0];
    expect(alphaText.closest('tr')!.className).toContain('bg-primary/[0.07]');
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
});
