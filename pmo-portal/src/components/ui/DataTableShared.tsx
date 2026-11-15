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

/** The shared primary-identity cell: wrapping bold title and optional muted secondary line.
 *  Identical on desktop tables and mobile cards so a record's identity renders the same way
 *  in both branches without hiding part of its meaning. */
export function PrimaryCell({ title, titleText, secondary }: { title: React.ReactNode; titleText?: string; secondary?: React.ReactNode }) {
  const accessibleTitle = titleText ?? (typeof title === 'string' ? title : undefined);
  return <span className="block min-w-0">
    <span title={accessibleTitle} className="block break-words font-semibold text-foreground">{title}</span>
    {secondary != null && <span className="block break-words text-control font-normal text-muted-foreground">{secondary}</span>}
  </span>;
}

const ROW_OPEN_CLASS =
  'block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm';

/** The row's open control: a real `<a href>` when the row has an in-app URL (so new-tab
 *  gestures work), otherwise a `<button>`. A plain left click is handled in-app via
 *  `onActivate`; modified clicks and middle-click fall through to the browser. */
export function RowOpenControl({ href, label, onOpen, stopPropagation, children }: {
  href?: string;
  label: string | undefined;
  onOpen: () => void;
  stopPropagation?: boolean;
  children: React.ReactNode;
}) {
  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        className={ROW_OPEN_CLASS}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onOpen();
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onOpen();
      }}
      className={ROW_OPEN_CLASS}
    >
      {children}
    </button>
  );
}
