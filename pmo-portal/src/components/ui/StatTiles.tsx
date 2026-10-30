import React from 'react';
import { cn } from './cn';
import { FigureContent } from './FigureContent';

export interface StatTile {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Exact money value when the visible figure is compact. */
  exactValue?: string;
  /** Unavailable reason; omit the number and show this in plain words. */
  unavailableReason?: string;
  /** Positive → success, negative → destructive coloring on the value. */
  tone?: 'pos' | 'neg';
  sub?: React.ReactNode;
}

export interface StatTilesProps {
  tiles: StatTile[];
  /** Columns once the strip's container fits N tiles (default 4). Narrow containers stay 2-col. */
  columns?: number;
  className?: string;
  /**
   * Visual treatment:
   *  • `framed` (default) — the hairline-gap strip in a bordered card frame.
   *  • `bare`              — borderless: the KPIs sit directly on the canvas,
   *                          separated by whitespace. Used on record-page finance
   *                          strips so the page reads as content-over-containers.
   * Responsive behavior (mobile 2-col, sm:grid-cols-n, odd-count clip) is identical.
   */
  variant?: 'framed' | 'bare';
}

/**
 * Stat-tile column map: for each columns value, the container-query classes that
 * grow the grid from the 2-col mobile base as the STRIP's container widens.
 * Hardcoded so Tailwind's JIT can statically detect these classes.
 * Covers 1–6 columns; add entries here if larger counts are ever needed.
 *
 * Container queries, not viewport breakpoints: the strip lives in wide canvases AND in
 * narrow hosts (the approvals pane is ~650px at 1440), and a 5-up viewport grid in a
 * narrow host broke a currency figure mid-number ("$6,900,00 / 0", tidy sweep 2026-10-30).
 * Sizing rule of thumb: a tile needs ~12rem for a 24px tabular amount.
 */
const CONTAINER_COLS_CLASS: Record<number, string> = {
  1: '',
  2: '',
  3: '@xl:grid-cols-3',
  4: '@3xl:grid-cols-4',
  5: '@2xl:grid-cols-3 @5xl:grid-cols-5',
  6: '@2xl:grid-cols-3 @5xl:grid-cols-6',
};

/** When the N-col layout activates, the odd-count last tile stops spanning the row. */
const CONTAINER_SPAN_RESET: Record<number, string> = {
  3: '@xl:col-span-1',
  4: '@3xl:col-span-1',
  5: '@5xl:col-span-1',
  6: '@5xl:col-span-1',
};

/**
 * Hairline-gap strip of stat tiles (the 1px `border` shows through as separators).
 *
 * Responsive (I6 fix): on mobile the strip renders as a 2-col grid so all KPIs are
 * visible at a glance — the previous horizontal-scroll carousel pushed KPIs off-screen
 * (design-review I6). At the `sm:` breakpoint and above the strip switches to the
 * equal-width grid driven by the `columns` prop. No snap, no overflow-x.
 *
 * AC-METRIC-TILE-CLIP-001 (metric-tile-clip-mobile fix): when the tile count is odd,
 * the last tile spans both mobile columns (col-span-2) so the bottom row is never a
 * half-empty visual "clipped" cell — e.g. 5 tiles → 2+2+1 (orphaned) becomes 2+2+full.
 * sm:col-span-1 resets the span at the sm+ breakpoint where the N-col grid takes over.
 * Desktop behavior is unchanged.
 *
 * `variant="bare"`: drops the card frame + cell fills so the
 * strip is a quiet row of KPIs on the canvas — fewer boxes, more air. Layout + clip
 * behavior is identical to `framed`.
 */
export const StatTiles: React.FC<StatTilesProps> = ({
  tiles,
  columns = 4,
  className,
  variant = 'framed',
}) => {
  const smColsClass = CONTAINER_COLS_CLASS[columns] ?? '';
  const spanReset = CONTAINER_SPAN_RESET[columns] ?? '';
  const isOdd = tiles.length % 2 !== 0;
  const isBare = variant === 'bare';
  return (
    <div
      data-testid="stat-tiles"
      className={cn(
        // mobile: 2-col grid — all tiles visible at a glance (I6, no carousel).
        // Container query: the N-col layout is driven by the strip's OWN width, so the
        // same tiles sit 2-up in a narrow pane and N-up on a wide canvas (tidy fix).
        '@container grid grid-cols-2',
        // N-col equal-width grid per the columns prop once the container fits it
        smColsClass,
        // framed = the hairline-gap card strip; bare = borderless on the canvas
        isBare
          ? 'gap-[var(--space-group)]'
          : 'rounded-lg border border-border bg-border gap-px',
        className,
      )}
    >
      {tiles.map((t, i) => {
        // AC-METRIC-TILE-CLIP-001: the last tile of an odd-count set spans both mobile
        // columns so the bottom row fills completely (no half-empty right cell).
        // sm:col-span-1 resets this at the sm+ breakpoint where N-col grid takes over.
        const isLastOdd = isOdd && i === tiles.length - 1;
        return (
          <div
            key={i}
            data-testid="stat-tile"
            className={cn(
              isBare
                ? 'py-1'
                : 'bg-card px-[var(--space-content-inset)] py-3 first:rounded-l-lg last:rounded-r-lg',
              isLastOdd && cn('col-span-2', spanReset),
            )}
          >
            <div className="mb-1 text-control text-muted-foreground">{t.label}</div>
            <div
              className={cn(
                'min-w-0 break-words text-metric font-semibold tabular',
                // AC-RAM-004 (#688): raw text-success failed color-contrast in dark theme —
                // the same class of gap the 'neg' tone below was already fixed for. text-success-text
                // uses --success-text (the AA on-canvas variant), same move as destructive-text.
                t.tone === 'pos' && 'text-success-text',
                // text-destructive (#ef4444) is 3.76:1 on white — below AA 4.5:1.
                // text-destructive-text uses --destructive-text (≈6.2:1 on white, WCAG AA).
                t.tone === 'neg' && 'text-destructive-text',
              )}
            >
              <FigureContent value={t.value} exactValue={t.exactValue} unavailableReason={t.unavailableReason} />
            </div>
            {t.sub && <div className="mt-0.5 text-support text-muted-foreground">{t.sub}</div>}
          </div>
        );
      })}
    </div>
  );
};
