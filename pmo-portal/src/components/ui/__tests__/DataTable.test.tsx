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
});
