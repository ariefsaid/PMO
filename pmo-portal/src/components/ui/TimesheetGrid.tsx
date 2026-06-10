import React from 'react';
import { cn } from './cn';
import { Button } from './Button';
import { Icon } from './icons';
import { computeTotals, type EditRow } from '@/src/lib/timesheet-edit';

export interface TimesheetDay {
  /** Short weekday label, e.g. "Mon". */
  label: string;
  /** Day-of-month number, e.g. "2". */
  dateNum: string;
  /** Weekend day → quiet tint. */
  weekend: boolean;
}

export interface TimesheetGridRow {
  id: string;
  project: string;
  code: string | null;
  /** Hours per day, parallel to `days` (length 7). */
  hours: number[];
}

export interface TimesheetGridProps {
  days: TimesheetDay[];
  rows: TimesheetGridRow[];
  className?: string;
  /**
   * Editable mode (timesheet-entry FR-TSE-001): each cell becomes a labelled
   * numeric input, a per-row note input and a per-row delete control appear, and
   * totals derive from the edited (string) state. When false/omitted the grid is
   * the shipped read-only surface — byte-for-byte unchanged.
   */
  editable?: boolean;
  /** Per-row note text, keyed by row id (editable mode). */
  notes?: Record<string, string>;
  /**
   * Raw, as-typed cell strings keyed by row id (editable mode), length-7 each.
   * When present these are shown verbatim so in-progress values ("7.", a typed
   * "0", a leading blank) are preserved instead of round-tripping through a
   * numeric parse. Falls back to the numeric `rows[].hours` when absent.
   */
  rawHours?: Record<string, string[]>;
  /** "<rowId>:<dayIdx>" of cells that fail client validation (editable mode). */
  invalidCells?: Set<string>;
  /** Fired on each keystroke into an hour cell (rowId, dayIndex 0–6, raw string). */
  onCellChange?: (rowId: string, dayIndex: number, raw: string) => void;
  /** Fired on each keystroke into a row's note input. */
  onNoteChange?: (rowId: string, note: string) => void;
  /** Fired when a row's delete control is activated (page stages a ConfirmDialog). */
  onDeleteRow?: (rowId: string) => void;
}

/** Format hours with a tabular figure; trims trailing zeros (8 not 8.00). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

/**
 * Weekly hours grid (DESIGN.md `tsgrid`): project rows × 7 day cells, weekend
 * tinting, per-row + per-day + grand totals. In read-only mode cells are static
 * (a faint `primary` wash on filled cells, a centred dot on empty) and carry
 * per-cell `aria-label`s. In editable mode each cell is a labelled numeric input
 * (NFR-TSE-A11Y-001), a per-row note input and a delete control appear, and totals
 * track the edited values live via `computeTotals` (FR-TSE-012/013).
 */
export const TimesheetGrid: React.FC<TimesheetGridProps> = ({
  days,
  rows,
  className,
  editable = false,
  notes,
  rawHours,
  invalidCells,
  onCellChange,
  onNoteChange,
  onDeleteRow,
}) => {
  // Read-only totals: the shipped numeric reduce. Editable totals: derive from
  // the (string) edited state via the pure, memo-friendly computeTotals selector.
  const editTotals = React.useMemo(() => {
    if (!editable) return null;
    const editRows: EditRow[] = rows.map((r) => ({
      project_id: r.id,
      project: r.project,
      code: r.code,
      hours: r.hours.map((h) => String(h)),
      note: notes?.[r.id] ?? '',
    }));
    return computeTotals(editRows);
  }, [editable, rows, notes]);

  const dailyTotals = editTotals
    ? editTotals.perDay
    : days.map((_, i) => rows.reduce((sum, r) => sum + (r.hours[i] ?? 0), 0));
  const grandTotal = editTotals
    ? editTotals.weekly
    : dailyTotals.reduce((a, b) => a + b, 0);

  return (
    // Scroll container: overflow-x-auto (contained scroll, not page scroll).
    // scroll-fade-x (PR-3, AC-IXD-MOBILE-W4-PR3-C1b): right-edge mask-image gradient
    // signals "more to scroll" so it's clear the grid extends beyond the viewport.
    // The fade is CSS-only (mask-image, compositor), no extra DOM node needed here.
    // A sibling fade overlay element is added for the testid + aria-hidden signal.
    <div className={cn('relative', className)}>
      <div
        data-testid="tsgrid-scroll"
        className={cn(
          'overflow-x-auto',
          // Right-edge fade: same mask-image pattern as StatTiles and Tabs strip.
          // `[mask-image:…]` is a Tailwind arbitrary value — compositor-only, no repaint.
          '[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent_100%)]',
        )}
      >
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr>
            <th
              data-testid="tsgrid-project-header"
              scope="col"
              className="sticky left-0 z-[1] h-[38px] min-w-[220px] max-md:min-w-[160px] border-b border-border bg-card px-3 text-left text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground"
            >
              Project
            </th>
            {days.map((d, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  'h-[38px] min-w-[64px] border-b border-border px-2 text-center text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground',
                  d.weekend && 'weekend bg-secondary/60'
                )}
              >
                {d.label}
                <span className="mt-0.5 block text-[11px] font-normal tabular text-muted-foreground">
                  {d.dateNum}
                </span>
              </th>
            ))}
            <th
              scope="col"
              className="h-[38px] min-w-[64px] border-b border-border bg-secondary/40 px-2 text-center text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, rowIdx) => {
            const rowTotal = editTotals
              ? editTotals.perRow[rowIdx]
              : r.hours.reduce((a, b) => a + b, 0);
            return (
              <tr key={r.id} className="border-b border-border/70">
                <td className="sticky left-0 z-[1] bg-card px-3 py-2.5 align-middle">
                  {editable ? (
                    // Editable: name/code/note on the left, delete on the RIGHT of the same sticky
                    // (always-visible) cell — so the delete stays reachable at 375px without the
                    // horizontal scroll that pushes a trailing column off-screen on a phone.
                    // One delete control, one accessible name.
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={r.project}>
                          {r.project}
                        </div>
                        {r.code && (
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {r.code}
                          </div>
                        )}
                        {/* AC-W6-IXD-NOTE (B-4): demote the per-row note. Collapse-on-demand —
                            an empty note is a quiet "+ Note" button; existing content renders
                            expanded so content is never hidden. The expanded input is a single
                            bottom hairline (quieter than the bordered hour cells). */}
                        <NoteCell
                          rowId={r.id}
                          project={r.project}
                          value={notes?.[r.id] ?? ''}
                          onNoteChange={onNoteChange}
                        />
                      </div>
                      <Button
                        className="touch-target shrink-0"
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${r.project} row`}
                        onClick={() => onDeleteRow?.(r.id)}
                      >
                        <Icon name="x" />
                      </Button>
                    </div>
                  ) : (
                    // Read-only branch — byte-for-byte unchanged from the shipped surface.
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" title={r.project}>
                        {r.project}
                      </div>
                      {r.code && (
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {r.code}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                {r.hours.map((h, i) => {
                  const weekend = days[i]?.weekend;
                  if (editable) {
                    const invalid = invalidCells?.has(`${r.id}:${i}`) ?? false;
                    // Prefer the raw as-typed string so in-progress values survive;
                    // fall back to the numeric (blank for 0) when no raw map is given.
                    const raw = rawHours?.[r.id]?.[i];
                    const value = raw !== undefined ? raw : h === 0 ? '' : fmt(h);
                    return (
                      <td
                        key={i}
                        className={cn('p-1 align-middle', weekend && 'bg-secondary/60')}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`${r.project}, ${days[i]?.label} hours`}
                          aria-invalid={invalid || undefined}
                          value={value}
                          onChange={(e) => onCellChange?.(r.id, i, e.target.value)}
                          className={cn(
                            'touch-target mx-auto block h-9 min-w-[44px] w-full max-w-[64px] rounded-md border bg-card text-center text-[13.5px] tabular text-foreground',
                            invalid ? 'border-destructive' : 'border-border'
                          )}
                        />
                        {invalid && (
                          <span
                            role="alert"
                            // Darkened destructive text variant (the system's error-text value,
                            // shared with ErrBanner/ListState) — ~6.5:1 on white, clears WCAG-AA.
                            // Base `text-destructive` (60.2% L) is only ~3.76:1 and fails for text.
                            style={{ color: 'hsl(0 72% 42%)' }}
                            className="mt-0.5 block text-center text-[11px] leading-tight"
                          >
                            0–24 only
                          </span>
                        )}
                      </td>
                    );
                  }
                  const filled = h > 0;
                  return (
                    <td
                      key={i}
                      className={cn('p-1 text-center align-middle', weekend && 'bg-secondary/60')}
                    >
                      <div
                        aria-label={`${r.project}, ${days[i]?.label} hours`}
                        className={cn(
                          'mx-auto grid h-9 min-w-[44px] place-items-center rounded-md text-[13.5px] tabular',
                          filled
                            ? 'bg-primary/[0.07] font-semibold text-foreground'
                            : 'text-muted-foreground/45'
                        )}
                      >
                        {filled ? fmt(h) : '·'}
                      </div>
                    </td>
                  );
                })}
                <td
                  data-testid={`tsgrid-row-total-${r.id}`}
                  className="bg-secondary/30 px-2 py-2.5 text-center align-middle text-sm font-semibold tabular"
                >
                  {rowTotal > 0 ? fmt(rowTotal) : '·'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-[1.5px] border-border bg-secondary/40">
            <td className="sticky left-0 z-[1] bg-card px-3 py-3 text-right text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
              Daily total
            </td>
            {dailyTotals.map((t, i) => (
              <td
                key={i}
                data-testid={`tsgrid-daily-total-${i}`}
                className={cn(
                  'px-2 py-3 text-center text-sm font-semibold tabular',
                  days[i]?.weekend && 'bg-secondary/60'
                )}
              >
                {t > 0 ? fmt(t) : '·'}
              </td>
            ))}
            <td
              data-testid="tsgrid-grand-total"
              className="bg-secondary/60 px-2 py-3 text-center text-sm font-bold tabular"
            >
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>
      {/* Decorative scroll-fade overlay (aria-hidden + pointer-events-none).
          Provides a testid for the test assertion confirming the fade is present.
          The visual fade is already on the parent via mask-image; this element
          exists solely for the aria-hidden assertion and does not double the effect. */}
      <div
        data-testid="tsgrid-fade"
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-full w-7"
      />
    </div>
  );
};

/**
 * AC-W6-IXD-NOTE (B-4): the demoted per-row note cell.
 * - Collapsed (default, empty note): a quiet, real labelled `<button>` "+ Note"
 *   (`Add note to <project>`, `.touch-target`, keyboard-operable). Clicking it
 *   reveals the input and moves focus to it.
 * - Expanded (note has content OR the user clicked "+ Note"): the input, demoted
 *   to a single bottom hairline (`border-0 border-b border-border bg-transparent
 *   rounded-none`) so it reads quieter than the bordered hour cells. Existing note
 *   content is always rendered expanded on mount — content is never hidden.
 */
const NoteCell: React.FC<{
  rowId: string;
  project: string;
  value: string;
  onNoteChange?: (rowId: string, note: string) => void;
}> = ({ rowId, project, value, onNoteChange }) => {
  const hasContent = value.trim().length > 0;
  const [expanded, setExpanded] = React.useState(hasContent);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Tracks a user-driven expand (the "+ Note" click) so we focus the input only then,
  // never when content-driven expansion happens on mount/hydration.
  const focusOnExpand = React.useRef(false);

  // Existing content always shows expanded (the always-editable invariant) even if
  // the parent later hydrates a note into a row that started empty.
  React.useEffect(() => {
    if (hasContent) setExpanded(true);
  }, [hasContent]);

  // After the input mounts from a user "+ Note" click, move focus to it.
  React.useLayoutEffect(() => {
    if (expanded && focusOnExpand.current) {
      inputRef.current?.focus();
      focusOnExpand.current = false;
    }
  }, [expanded]);

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label={`Add note to ${project}`}
        onClick={() => {
          focusOnExpand.current = true;
          setExpanded(true);
        }}
        className="touch-target mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="plus" className="size-3" />
        Note
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={`${project} note`}
      placeholder="Add a note"
      value={value}
      onChange={(e) => onNoteChange?.(rowId, e.target.value)}
      // Demoted to a single bottom hairline (Single-Border Rule) so the note reads
      // quieter than the bordered hour cells; touch-target keeps a ≥44px hit-area.
      className="touch-target mt-1 h-8 w-full rounded-none border-0 border-b border-border bg-transparent px-0 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring"
    />
  );
};
