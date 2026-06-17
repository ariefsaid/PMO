/**
 * AC-ROWCLICK-DATATABLE-* — the shared DataTable is a NAVIGATION surface: a
 * whole-row click fires onActivate (drill into the record), while nested controls
 * stay isolated. Keyboard activation is reachable via the first-cell button that
 * `rowLabel` renders. These lock the row-clickable contract for every page that
 * passes onActivate (Projects, Companies, Contacts, Procurement table, etc.).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'value', header: 'Value', align: 'num', cell: (r) => r.value },
];

describe('AC-ROWCLICK-DATATABLE: whole-row activation', () => {
  it('AC-ROWCLICK-DATATABLE-1: clicking a row body cell fires onActivate with the row', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    // Click a non-interactive cell (the numeric value) → row activates.
    await userEvent.click(screen.getByText('980'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
  });

  it('AC-ROWCLICK-DATATABLE-2: pressing Enter on the first-cell button activates the row (keyboard path)', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    screen.getByRole('button', { name: 'Open Alpha' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  it('AC-ROWCLICK-DATATABLE-3: opening the row-actions (⋯) menu does NOT fire onActivate', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(onActivate).not.toHaveBeenCalled();
    // Activating a menu item must not fire the row's onActivate either.
    const onEdit = vi.fn();
    onActivate.mockClear();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onActivate).not.toHaveBeenCalled();
    void onEdit;
  });
});
