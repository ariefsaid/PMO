import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; hours: number }
const rows: Row[] = [{ id: 'r1', name: 'Alpha', hours: 8 }];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Project', stickyLeft: true, size: 200, cell: (r) => r.name },
  { key: 'hours', header: 'Hours', align: 'num', size: 100, cell: (r) => r.hours },
];

describe('DataTable sticky-left first column (T9)', () => {
  it('pins the header cell, every body cell and the total row cell of a stickyLeft column', () => {
    render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} tableId="sticky-left-test"
        totals={[{ key: 'total', label: 'Total', values: { hours: 8 } }]} />,
    );
    const header = screen.getByRole('columnheader', { name: 'Project' });
    const cell = screen.getByText('Alpha').closest('td')!;
    const foot = screen.getByText('Total').closest('td')!;
    for (const el of [header, cell, foot]) expect(el).toHaveClass('sticky', 'left-0');
    expect(screen.getByRole('columnheader', { name: 'Hours' })).not.toHaveClass('left-0');
  });
});
