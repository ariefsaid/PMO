import React from 'react';
import type { Column, DataTableProps } from './DataTable';

const EMPTY_MARKERS = new Set(['—', '–', '-']);
const NUMERIC_KINDS = new Set(['money', 'number', 'percent']);

type ColumnPresentation = Pick<Column<unknown>, 'kind' | 'align'>;

/** Numeric column kinds default to right alignment; legacy `align: 'num'` columns keep it too. */
export function isNumericColumn<Row>(column: Pick<Column<Row>, 'kind' | 'align'>): boolean {
  return NUMERIC_KINDS.has(column.kind ?? '') || column.align === 'num';
}

/** An explicit centered matrix column remains centered; otherwise numeric columns line up on the right. */
export function columnAlignmentClass(column: ColumnPresentation): string {
  if (column.align === 'center') return 'text-center';
  return isNumericColumn(column) ? 'text-right' : 'text-left';
}

/** Keep the shared table marker and standard utility so figures stay fixed-width in every table branch. */
export function numericColumnClass(column: ColumnPresentation): string | undefined {
  return isNumericColumn(column) ? 'tabular tabular-nums' : undefined;
}

/** True when a cell renders nothing a person can read: null/false/''/whitespace, the "—" marker, or a list/fragment of those.
 *  Any other element counts as content (its output cannot be inspected without rendering it). */
export function isBlankCell(node: React.ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return true;
  if (typeof node === 'string') return node.trim() === '' || EMPTY_MARKERS.has(node.trim());
  if (typeof node === 'number' || typeof node === 'bigint') return false;
  if (Array.isArray(node)) return node.every(isBlankCell);
  if (React.isValidElement(node) && node.type === React.Fragment) return isBlankCell((node.props as { children?: React.ReactNode }).children);
  return false;
}

/** Columns that are blank on every loaded row are dropped (see `Column.keepWhenBlank`). */
export function dropBlankColumns<Row>(
  columns: Column<Row>[],
  rows: Row[],
  totals: DataTableProps<Row>['totals'],
  loaded: boolean,
): Column<Row>[] {
  if (!loaded || rows.length === 0) return columns;
  return columns.filter((column, index) => {
    if (index === 0 || column.keepWhenBlank || column.stickyLeft || column.rowHeader || column.caveat) return true;
    if (column.kind === 'actions' || column.kind === 'select') return true;
    if (totals?.some((total) => total.values && !isBlankCell(total.values[column.key]))) return true;
    return rows.some((row) => !isBlankCell(column.cell(row)) || (column.secondaryCell != null && !isBlankCell(column.secondaryCell(row))));
  });
}
