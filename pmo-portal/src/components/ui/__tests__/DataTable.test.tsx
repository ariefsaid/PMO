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

  it('row click and Enter both call onActivate', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onActivate={onActivate} />
    );
    await userEvent.click(screen.getByText('Alpha'));
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
    const betaRow = screen.getByText('Beta').closest('tr')!;
    betaRow.focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
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
