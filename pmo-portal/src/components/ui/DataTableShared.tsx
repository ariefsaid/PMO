/**
 * DataTableShared — INTERNAL helpers shared by the DataTable render branches
 * (DataTableDesktop / DataTableMobile). Not part of the public DataTable API:
 * import from `./DataTable` (or the `components/ui` barrel) for that. Nothing
 * outside the DataTable module family may import this file.
 */
import React from 'react';
import type { Row as TableRow } from '@tanstack/react-table';

/** One entry of the branch-agnostic row list: either an aligned group heading (with its
 *  rows for header aggregates) or a TanStack model row (with its group key, if grouped). */
export type GroupedRowEntry<Row> =
  | { type: 'heading'; label: string; count: number; rows: TableRow<Row>[] }
  | { type: 'data'; modelRow: TableRow<Row>; group: string | undefined };

/** The shared primary-identity cell: 2-line clamp bold title with a `title` tooltip
 *  fallback, plus an optional muted secondary line. Identical on desktop tables and
 *  mobile cards so a record's identity renders the same way in both branches. */
export function PrimaryCell({ title, titleText, secondary }: { title: React.ReactNode; titleText?: string; secondary?: React.ReactNode }) {
  const accessibleTitle = titleText ?? (typeof title === 'string' ? title : undefined);
  return <span className="block min-w-0">
    <span title={accessibleTitle} className="block line-clamp-2 break-words font-semibold text-foreground">{title}</span>
    {secondary != null && <span className="block truncate text-[12px] font-normal text-muted-foreground">{secondary}</span>}
  </span>;
}
