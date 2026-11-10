import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DataTable, dropBlankColumns, isBlankCell, type Column } from '../DataTable';

type Row = { id: string; name: string; actual: number | null; note: string; budget: string | null };
const rows: Row[] = [
  { id: '1', name: 'Alpha', actual: null, note: '—', budget: '100' },
  { id: '2', name: 'Beta', actual: null, note: '', budget: null },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Project', cell: (r) => r.name, kind: 'primary' },
  { key: 'actual', header: 'Actual', cell: (r) => r.actual },
  { key: 'note', header: 'Note', cell: (r) => r.note },
  { key: 'budget', header: 'Budget', cell: (r) => r.budget },
];
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe('DataTable: a column blank on every loaded row is not rendered', () => {
  it('drops columns whose cell is nothing or the "—" marker on every row; keeps one with any value', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(headers()).toEqual(['Project', 'Budget']);
  });

  it('keepWhenBlank keeps a blank column', () => {
    render(<DataTable rows={rows} columns={columns.map((c) => (c.key === 'actual' ? { ...c, keepWhenBlank: true } : c))} rowKey={(r) => r.id} />);
    expect(headers()).toEqual(['Project', 'Actual', 'Budget']);
  });

  it('keeps every column while loading, empty or failed (no loaded rows to judge by)', () => {
    const { rerender } = render(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} state="loading" />);
    rerender(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} state="loading" />);
    // while loading no row is judged: every column keeps its header
    expect(headers()).toEqual(['Project', 'Actual', 'Note', 'Budget']);
    rerender(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(headers()).toEqual(['Project', 'Budget']);
    rerender(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} />);
    expect(dropBlankColumns(columns, [], undefined, true)).toHaveLength(4);
  });

  it('a column appears when a later load brings a value', () => {
    const { rerender } = render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(headers()).not.toContain('Actual');
    rerender(<DataTable rows={[...rows, { id: '3', name: 'Gamma', actual: 5, note: '—', budget: null }]} columns={columns} rowKey={(r) => r.id} />);
    expect(headers()).toEqual(['Project', 'Actual', 'Budget']);
  });

  it('never drops the first column, a sticky or row-header column, or one a totals row fills', () => {
    const blankRows: Row[] = [{ id: '1', name: '', actual: null, note: '', budget: null }];
    const kept = dropBlankColumns(
      [
        { key: 'a', header: 'A', cell: () => null },
        { key: 'b', header: 'B', cell: () => null, stickyLeft: true },
        { key: 'c', header: 'C', cell: () => null, rowHeader: true },
        { key: 'd', header: 'D', cell: () => null },
        { key: 'e', header: 'E', cell: () => null },
      ] as Column<Row>[],
      blankRows,
      [{ key: 't', label: 'Total', values: { d: '10' } }],
      true,
    ).map((c) => c.key);
    expect(kept).toEqual(['a', 'b', 'c', 'd']);
  });

  it('isBlankCell: element content is never blank; markers, empty lists and fragments are', () => {
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell(false)).toBe(true);
    expect(isBlankCell('  ')).toBe(true);
    expect(isBlankCell('—')).toBe(true);
    expect(isBlankCell([null, '—'])).toBe(true);
    expect(isBlankCell(<>{null}</>)).toBe(true);
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell('0')).toBe(false);
    expect(isBlankCell(<span>x</span>)).toBe(false);
    expect(isBlankCell(<span />)).toBe(false);
  });
});
