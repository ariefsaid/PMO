import React from 'react';
import type { Column } from '../../DataTable';

/**
 * A per-CELL render counter around the REAL `DataTable` (#2102 AC2, page-level binding).
 *
 * `DataTable`'s row memo keys on the columns array's IDENTITY, so AC2 ("a parent re-render that
 * changes nothing re-renders no row") holds only on pages that keep that array stable. A unit
 * test that memoises the array proves the component; this wrapper proves a PAGE: it re-wraps each
 * column's `cell` in a tally and memoises the result on the array it was handed, so an inline,
 * per-render column array produces a new identity every render and every cell runs again — the
 * tally fills and the page test fails. `tally` records one entry per cell render, `key:rowId`.
 *
 * Mount it by replacing the barrel's `DataTable` in a page test:
 * `vi.mock('@/src/components/ui', …)` returning `{ ...actual, DataTable: countingDataTable(actual.DataTable, cells) }`.
 */
export function countingDataTable(
  Real: unknown,
  tally: string[],
): React.FC<Record<string, unknown>> {
  const RealTable = Real as React.FC<Record<string, unknown>>;
  return function CountingDataTable(props) {
    const columns = props.columns as Column<Record<string, unknown>>[];
    const counted = React.useMemo(
      () => columns.map((column) => ({
        ...column,
        cell: (row: Record<string, unknown>) => {
          tally.push(`${column.key}:${String(row.id)}`);
          return column.cell(row);
        },
      })),
      [columns],
    );
    return <RealTable {...props} columns={counted} />;
  };
}
