import { useMemo, useRef } from 'react';
import type { RowMenuItem } from './RowMenu';

interface LiveRowCallbacks<Row, Col> {
  onActivate?: (row: Row) => void;
  rowMenu?: (row: Row) => RowMenuItem[] | undefined;
  accessibleRowLabel: (row: Row) => string | undefined;
  selectionLabel: (row: Row, primaryColumn?: Col) => string;
}

/** Row memo support. Memoised rows must not hold the closures of an old parent render, and they must
 *  repaint when what those closures PRODUCE changes. So: (1) the callbacks handed to rows are stable
 *  wrappers that always call the latest props (a click resolves the current handler / menu item), and
 *  (2) `rowKey` serialises everything the callbacks render (aria-labels, menu labels/disabled/danger)
 *  so the row memo compares the output, not the identity of the closure. */
export function useLiveRowProps<Row, Col>(p: LiveRowCallbacks<Row, Col>) {
  const live = useRef(p);
  // Written during render on purpose: memoised rows that re-render in this same pass must call the
  // newest closures, and a layout effect would run after them.
  live.current = p;
  const stable = useMemo(() => ({
    onActivate: (row: Row) => live.current.onActivate?.(row),
    rowMenu: (row: Row): RowMenuItem[] | undefined =>
      live.current.rowMenu?.(row)?.map((item, index) => ({
        ...item,
        onClick: () => live.current.rowMenu?.(row)?.[index]?.onClick(),
      })),
    accessibleRowLabel: (row: Row) => live.current.accessibleRowLabel(row),
    selectionLabel: (row: Row, col?: Col) => live.current.selectionLabel(row, col),
  }), []);
  return stable;
}

/** What a row paints through its callbacks, as one comparable string. */
export function rowContentKey<Row, Col>(
  row: Row,
  p: LiveRowCallbacks<Row, Col> & { rowTarget?: (row: Row) => string | undefined },
  primaryColumn?: Col,
): string {
  const menu = p.rowMenu?.(row)?.map((i) => `${i.label}\u0001${i.disabled ? 1 : 0}${i.danger ? 1 : 0}`).join('\u0002') ?? '';
  return [p.accessibleRowLabel(row) ?? '', p.selectionLabel(row, primaryColumn), p.rowTarget?.(row) ?? '', menu].join('\u0003');
}
