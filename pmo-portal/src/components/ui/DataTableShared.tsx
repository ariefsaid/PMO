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

const ROW_ACTIVATION_CLASS = 'block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm';

/** True when the browser, not the app, should handle a link click (new tab/window, download). */
function opensElsewhere(event: React.MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * The row's activation control (#2077). With an `href` it is a real link, so Cmd/Ctrl-click,
 * middle-click and "Open link in new tab" open the record elsewhere; a plain click or Enter is
 * intercepted and runs `onActivate` (the page's own open behaviour, e.g. list-return context) so the
 * app routes in place with no document load. Without an `href` it stays a button. The click never
 * reaches the `<tr>`/card handler, so the row activates exactly once.
 */
export function RowActivation({ href, label, onActivate, children }: {
  href?: string;
  label?: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          if (opensElsewhere(event)) return;
          event.preventDefault();
          onActivate();
        }}
        className={ROW_ACTIVATION_CLASS}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      className={ROW_ACTIVATION_CLASS}
    >
      {children}
    </button>
  );
}
