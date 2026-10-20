import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; currency: string }
const rows: Row[] = [{ id: 'r1', name: 'Alpha', currency: 'USD' }];

describe('DataTable export-only columns', () => {
  it('T10: an exportOnly column is never rendered (header or cell) but stays on the column list for export', () => {
    const columns: Column<Row>[] = [
      { key: 'name', header: 'Name', cell: (r) => r.name },
      { key: 'currency', header: 'Currency', exportOnly: true, cell: (r) => r.currency, exportValue: (r) => r.currency },
    ];
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} tableId="export-only-test" />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Currency' })).not.toBeInTheDocument();
    expect(screen.queryByText('USD')).not.toBeInTheDocument();
    expect(columns[1].exportValue?.(rows[0])).toBe('USD');
  });
});
