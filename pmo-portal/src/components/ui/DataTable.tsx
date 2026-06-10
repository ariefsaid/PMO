import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Icon } from './icons';
import { ListState } from './ListState';
import { useIsDesktop } from './useIsDesktop';

export type ColAlign = 'num' | 'center';

export interface Column<Row> {
  key: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  align?: ColAlign;
  /** When set, the header is sortable and reports this key to onSort. */
  sortKey?: string;
  /**
   * Extra Tailwind classes applied to both the `<th>` and each `<td>` in this column.
   * Use for responsive hiding, e.g. `"hidden xl:table-cell"`.
   */
  colClassName?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  /** Click/Enter on a row (drill-down). */
  onActivate?: (row: Row) => void;
  /**
   * Accessible name for the row's activation control. When provided alongside
   * `onActivate`, the first column's content is wrapped in a real focusable
   * `<button>` carrying this name — so each row has a keyboard- and
   * screen-reader-reachable affordance WITHOUT overriding the `<tr>`'s implicit
   * `role="row"`. Omit when the first cell already renders its own focusable
   * control (e.g. a name button) to avoid nesting interactive elements.
   */
  rowLabel?: (row: Row) => string;
  selectedKey?: string;
  sort?: SortState;
  onSort?: (key: string) => void;
  /** Async state — renders ListState in place of the body. */
  state?: 'loading' | 'empty' | 'error';
  emptyTitle?: string;
  emptySub?: string;
  emptyAction?: { label: string; onClick: () => void };
  errorTitle?: string;
  errorSub?: string;
  onRetry?: () => void;
  /** Per-row overflow menu items (hidden until row hover). */
  rowMenu?: (row: Row) => RowMenuItem[];
  className?: string;
}

function alignClass(align?: ColAlign) {
  if (align === 'num') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/**
 * Strips responsive-hide classes (e.g. "hidden xl:table-cell") from colClassName
 * when projecting a column into the card branch. Cards have vertical room that the
 * table doesn't, so every column should render in the card regardless of the
 * desktop hiding strategy. Alignment and other utilities are preserved.
 *
 * Pattern stripped: any class that starts with "hidden" or contains ":hidden" or
 * matches "hidden [breakpoint]:table-cell" compound patterns.
 */
function stripHiddenClasses(colClassName?: string): string {
  if (!colClassName) return '';
  return colClassName
    .split(' ')
    .filter((cls) => {
      // Strip bare "hidden" and any responsive-hide pattern like "hidden xl:table-cell"
      // or "sm:hidden" etc. Alignment classes (text-right, tabular) pass through.
      return !cls.startsWith('hidden') && !cls.endsWith(':hidden');
    })
    .join(' ');
}

/**
 * Generic, typed data table (the signature surface). Presentational: the three
 * async states delegate to ListState via the `state` prop. Rows are keyboard-
 * activatable; sortable headers expose aria-sort.
 *
 * Mobile reflow (OD-W4-4, AC-IXD-MOBILE-W4-C1) — SINGLE render:
 * - `useIsDesktop()` reads `(min-width: 768px)` synchronously at first paint and
 *   re-renders on viewport change. EXACTLY ONE branch is in the DOM at a time:
 *   - At `md`+ (≥768px): the desktop `<table>` branch (markup byte-unchanged).
 *   - Below `md` (<768px): a stacked card list — each row maps to a card with the
 *     first column as the activation title and the remaining columns as a <dl>
 *     label:value list. All data is shown (no column dropped).
 * - Because only one branch renders, each cell's content (text + interactive
 *   controls) appears exactly ONCE in the DOM/AT tree — no duplication, no
 *   aria-hidden, no `hidden`/`md:hidden` CSS toggle, and no dup-match test tax.
 */
export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  onActivate,
  rowLabel,
  selectedKey,
  sort,
  onSort,
  state,
  emptyTitle = 'Nothing here yet',
  emptySub,
  emptyAction,
  errorTitle = 'Could not load',
  errorSub,
  onRetry,
  rowMenu,
  className,
}: DataTableProps<Row>) {
  const isDesktop = useIsDesktop();
  const colSpan = columns.length + (rowMenu ? 1 : 0);

  // Shared ListState node — rendered once and reused in both branches via a
  // local variable so the async-state code is one source of truth.
  const listStateNode = state ? (
    <>
      {state === 'loading' && <ListState variant="loading" />}
      {state === 'empty' && (
        <ListState
          variant="empty"
          title={emptyTitle}
          sub={emptySub}
          action={emptyAction}
        />
      )}
      {state === 'error' && (
        <ListState
          variant="error"
          title={errorTitle}
          sub={errorSub}
          onRetry={onRetry}
        />
      )}
    </>
  ) : null;

  return (
    <div className={cn('overflow-hidden rounded-b-lg border border-border bg-card', className)}>
      {isDesktop ? (
      /* ── Desktop table branch (≥768px — only branch in the DOM; markup byte-unchanged) ── */
      <div data-testid="dt-table-branch" className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              {columns.map((col) => {
                const sortable = !!col.sortKey;
                const ariaSort =
                  sort && col.sortKey === sort.key
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : sortable
                      ? 'none'
                      : undefined;
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSort}
                    className={cn(
                      'sticky top-0 z-[2] h-[38px] border-b border-border bg-card px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground whitespace-nowrap select-none',
                      alignClass(col.align),
                      col.colClassName
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort?.(col.sortKey!)}
                        className="inline-flex items-center gap-1 uppercase tracking-[0.03em] hover:text-foreground [&_svg]:size-3"
                      >
                        {col.header}
                        {sort?.key === col.sortKey && (
                          <Icon name={sort.dir === 'asc' ? 'up' : 'down'} />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
              {rowMenu && <th className="w-10 border-b border-border bg-card" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {state ? (
              <tr>
                <td colSpan={colSpan} className="p-0">
                  {listStateNode}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const selected = key === selectedKey;
                // The <tr> keeps its IMPLICIT role="row" (never role="link",
                // which breaks table-row semantics and hides body rows from
                // getByRole('row')). Whole-row onClick stays as a pointer
                // convenience; the keyboard/screen-reader affordance is the
                // real <button> rendered into the first cell when `rowLabel`
                // is supplied (see below).
                return (
                  <tr
                    key={key}
                    onClick={onActivate ? () => onActivate(row) : undefined}
                    className={cn(
                      'group border-b border-border/70 last:border-b-0 transition-colors',
                      onActivate && 'cursor-pointer hover:bg-accent/60',
                      selected && 'bg-primary/[0.07]'
                    )}
                  >
                    {columns.map((col, colIndex) => {
                      const activatable = onActivate && rowLabel && colIndex === 0;
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            'h-[54px] px-3 py-2 align-middle whitespace-nowrap',
                            alignClass(col.align),
                            col.align === 'num' && 'tabular',
                            col.colClassName
                          )}
                        >
                          {activatable ? (
                            <button
                              type="button"
                              aria-label={rowLabel(row)}
                              onClick={(e) => {
                                // The <tr> onClick already activates; stop it so
                                // the row doesn't fire onActivate twice.
                                e.stopPropagation();
                                onActivate(row);
                              }}
                              className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                            >
                              {col.cell(row)}
                            </button>
                          ) : (
                            col.cell(row)
                          )}
                        </td>
                      );
                    })}
                    {rowMenu && (
                      <td className="px-2 align-middle">
                        <RowMenu items={rowMenu(row)} />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      ) : (
      /* ── Mobile card branch (<768px — only branch in the DOM) ─────────────
       * OD-W4-4 / AC-IXD-MOBILE-W4-C1: stacked record-card list.
       * Card anatomy (DESIGN.md tokens):
       *   - Container: bg-card, border, rounded-md (8px), p-4 (16px), gap-2 (8px) between cards
       *   - Title row: first column = activation <button> (rowLabel accessible name)
       *   - Field rows: <dl> grid — <dt> = column header (overline/label voice), <dd> = cell value
       *   - Numeric columns: tabular + text-right on <dd>
       *   - rowMenu ⋯: top-right corner of the card, .touch-target
       * Sorting is a desktop-density affordance — not reproduced on cards (sort headers not shown).
       * All columns render in the card (no hidden data) regardless of colClassName responsive-hide.
       *
       * AT scoping: at <768px this card branch is the ONLY structure rendered, so it
       * is fully AT-readable. No aria-hidden is needed (or wanted — it would hide the
       * sole row data from a mobile screen-reader user); the table branch simply isn't
       * in the DOM at this viewport.
       */
      <ul
        data-testid="dt-card-branch"
        role="list"
        className="divide-y divide-border/70"
      >
        {state ? (
          <li className="p-0">{listStateNode}</li>
        ) : (
          rows.map((row) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            const [titleCol, ...restCols] = columns;
            const hasMenu = !!rowMenu;
            const menuItems = hasMenu ? rowMenu!(row) : [];

            return (
              <li
                key={key}
                className={cn(
                  'relative flex flex-col gap-2 p-4 text-[13.5px] transition-colors',
                  onActivate && 'cursor-pointer',
                  selected && 'bg-primary/[0.07]'
                )}
              >
                {/* Title row: first column + rowMenu ⋯ pinned top-right */}
                <div className="flex items-start justify-between gap-3">
                  {/* Card title — activation button if rowLabel+onActivate supplied */}
                  <div className="min-w-0 flex-1 font-semibold">
                    {onActivate && rowLabel ? (
                      <button
                        type="button"
                        aria-label={rowLabel(row)}
                        onClick={() => onActivate(row)}
                        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
                      >
                        {titleCol.cell(row)}
                      </button>
                    ) : (
                      titleCol.cell(row)
                    )}
                  </div>
                  {/* rowMenu ⋯ — top-right of the card, .touch-target for ≥44px on coarse pointer */}
                  {hasMenu && menuItems.length > 0 && (
                    <div className="shrink-0">
                      <RowMenu items={menuItems} />
                    </div>
                  )}
                </div>

                {/* Remaining columns as a definition list */}
                {restCols.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                    {restCols.map((col) => (
                      <React.Fragment key={col.key}>
                        <dt
                          className={cn(
                            'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground self-center',
                            stripHiddenClasses(col.colClassName)
                          )}
                        >
                          {col.header}
                        </dt>
                        <dd
                          className={cn(
                            'text-[13.5px] text-foreground',
                            col.align === 'num' && 'tabular text-right',
                            col.align === 'center' && 'text-center',
                            stripHiddenClasses(col.colClassName)
                          )}
                        >
                          {col.cell(row)}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
              </li>
            );
          })
        )}
      </ul>
      )}
    </div>
  );
}

/**
 * Per-row overflow (⋯) menu.
 *
 * Clip-escape (AC-W6-IXD-MENU): the open `role="menu"` is PORTALED to
 * `document.body` and positioned `fixed` against the trigger's bounding box —
 * so it can never be clipped by the table branch's `overflow-x-auto` or the
 * card wrapper's `overflow-hidden` (the recurring "tests green, render clipped"
 * defect). It is right-aligned to the trigger, flips UP when the trigger sits
 * within the menu's height of the viewport bottom, and is clamped horizontally
 * to the `max-[921px]:px-4` (16px) gutter so it never bleeds off-screen at 375.
 *
 * a11y: focus moves to the first menuitem on open and returns to the trigger on
 * every close (Esc / click-outside / item-activate / toggle-off / Tab);
 * ArrowDown/Up rove (wrap), Home/End jump, Enter/Space activate; the menu is
 * `aria-orientation="vertical"`. Items inherit the global :focus-visible ring.
 *
 * stopPropagation (load-bearing, guards PR-B): the trigger wrapper AND the
 * portaled menu both stopPropagation so neither the ⋯ nor a menu item ever
 * fires the row's onActivate.
 */
const GUTTER = 16; // matches the `max-[921px]:px-4` shell gutter (DESIGN.md spacing.4)
const MENU_GAP = 4; // `mt-1` equivalent between trigger and menu (DESIGN.md spacing.1)

const RowMenu: React.FC<{ items: RowMenuItem[] }> = ({ items }) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // -1 until the menu opens; open() lands focus on index 0.
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // The flat list of menuitem indices (separators are not focusable stops).
  const itemCount = items.length;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setActive(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Position the portaled menu against the trigger: right-aligned, flip-up near
  // the viewport bottom, clamped within the gutters. Runs before paint so the
  // menu never flashes at (0,0).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const compute = () => {
      const t = triggerRef.current;
      const menu = menuRef.current;
      if (!t || !menu) return;
      const r = t.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Right-align the menu's right edge to the trigger's right edge.
      let left = r.right - mw;
      // Clamp horizontally within the gutters.
      left = Math.min(left, vw - GUTTER - mw);
      left = Math.max(left, GUTTER);

      // Open downward by default; flip up if it would overflow the bottom.
      const below = r.bottom + MENU_GAP;
      const flipUp = below + mh > vh - GUTTER && r.top - MENU_GAP - mh >= GUTTER;
      const top = flipUp ? r.top - MENU_GAP - mh : below;

      setPos({ top, left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  // On open, move focus to the first menuitem.
  useEffect(() => {
    if (!open) return;
    setActive(0);
  }, [open]);

  // Keep the DOM focus on the active menuitem as the roving index changes.
  useEffect(() => {
    if (!open || active < 0) return;
    const el = menuRef.current?.querySelector<HTMLButtonElement>(
      `[data-menuitem-index="${active}"]`,
    );
    el?.focus();
  }, [open, active]);

  // Close on outside pointer-down (not on the trigger — that toggles).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false); // outside click: don't yank focus back to the trigger
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + itemCount) % itemCount);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(itemCount - 1);
    } else if (e.key === 'Tab') {
      // Menus are not internal tab-stops: Tab/Shift+Tab close + restore focus.
      close();
    }
    // Enter/Space activate the focused <button> natively (no handler needed).
  };

  const activate = (item: RowMenuItem) => {
    item.onClick();
    close();
  };

  return (
    <div className="contents" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        // B-4 (AC-W2-IXD-006): always-visible trigger — removed `opacity-0 group-hover:opacity-100`
        // which made the ⋯ undiscoverable on touch + keyboard. The trigger is now visible by
        // default so every row's actions are reachable without a hover event. Touch targets ≥44px
        // come from the `.touch-target` utility (coarse-pointer min hit area).
        className="touch-target grid size-7 place-items-center rounded-md text-muted-foreground transition-[opacity,background-color] hover:bg-accent hover:text-foreground"
      >
        <span aria-hidden className="text-base leading-none">
          ⋯
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 820,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="min-w-[160px] rounded-lg border border-border bg-popover p-[5px] shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]"
          >
            {items.map((item, i) => {
              // destructive-nav-separation: spatially separate the first danger item
              // from the non-danger items above it with a hairline divider (matches the
              // crud-companies.html `.menu-sep` above Delete). No separator when the
              // danger item is first/only, or for consecutive danger items.
              const needsSep = item.danger && i > 0 && !items[i - 1].danger;
              return (
                <React.Fragment key={item.label}>
                  {needsSep && <div role="separator" className="my-1 h-px bg-border" />}
                  <button
                    role="menuitem"
                    type="button"
                    tabIndex={i === active ? 0 : -1}
                    data-menuitem-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(item)}
                    className={cn(
                      'flex h-8 w-full items-center rounded-md px-2.5 text-left text-[13.5px] hover:bg-accent',
                      item.danger && 'text-destructive'
                    )}
                  >
                    {item.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};

/** Toolbar seamed to the table top (or `standalone` fully rounded). */
export const Toolbar: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { standalone?: boolean }
> = ({ standalone = false, className, children, ...rest }) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-2 border border-border bg-card px-3 py-2.5',
      standalone ? 'mb-3.5 rounded-lg' : 'rounded-t-lg border-b-0',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

/** Borderless search field shell. */
export const SearchMini: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }
> = ({ containerClassName, className, ...rest }) => (
  <div
    className={cn(
      'flex h-8 min-w-[190px] items-center gap-[7px] rounded-lg border border-input bg-background px-2.5 [&_svg]:size-[15px] [&_svg]:text-muted-foreground',
      containerClassName
    )}
  >
    <Icon name="search" />
    <input
      type="search"
      className={cn(
        'w-full border-none bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground',
        className
      )}
      {...rest }
    />
  </div>
);

/** Totals footer row. */
export const TableFoot: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...rest
}) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-4 border-t-[1.5px] border-border bg-secondary/40 px-3.5 py-[11px] text-[13px] tabular',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);
