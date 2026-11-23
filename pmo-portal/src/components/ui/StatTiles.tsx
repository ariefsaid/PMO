import React from 'react';
import { cn } from './cn';
import { FigureContent, FIGURE_LINE_CLASS } from './FigureContent';
import { useFigureReport, type HiddenFigure } from './useFigureScope';

export interface StatTile {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Exact money value when the visible figure is compact. */
  exactValue?: string;
  /**
   * Why the figure is unknown. The tile is then not drawn: inside a `FigureScope` it is counted in the page's
   * one "N figures hidden" line; outside one it shows the reason in place. A tile with no `value` is unknown too.
   */
  unavailableReason?: string;
  /** A short word drawn in the tile in place of `unavailableReason` (one line); the reason still goes to the hidden-figures line. */
  unavailableShort?: string;
  /** Where the unknown figure is fixed ("Set up"); the link in the hidden-figures line. */
  hiddenLink?: { to: string; label: string };
  /** Positive → success, negative → destructive coloring on the value. */
  tone?: 'pos' | 'neg';
  /** The tile's ONE caption (at most 6 words, one truncated line). */
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
  /**
   * The strip carries money in the billions ("Rp 126.856.000.000" is 248px at the metric size): three across then
   * waits for a 52rem strip (3 x 262px + gaps) instead of 28rem, so a figure never outgrows its tile.
   */
  wideFigures?: boolean;
  /** Labels on one line and figures on one line across each row, with equal row gaps (see the tile classes). */
  alignRows?: boolean;
  /** Classes for the strip's frame: how the strip sits in ITS parent (a grid span, a margin). `className` styles the grid. */
  frameClassName?: string;
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

/** The 3-col layout for wide figures: see `wideFigures`. Static class so Tailwind's JIT sees it. */
const WIDE_FIGURES_3_COLS = '@[52rem]:grid-cols-3';
const WIDE_FIGURES_3_SPAN_RESET = '@[52rem]:col-span-1';

/** When the N-col layout activates, the odd-count last tile stops spanning the row. */
const CONTAINER_SPAN_RESET: Record<number, string> = {
  3: '@xl:col-span-1',
  4: '@3xl:col-span-1',
  5: '@5xl:col-span-1',
  6: '@5xl:col-span-1',
};

/**
 * A figure this wide (e.g. "US$1.000.000", "$10,000,000") does not fit half a phone row at the metric size,
 * and it must not wrap (rule 15), so its tile takes the whole row there (until the pane is `@md`, 28rem: two
 * ~13rem tiles fit abreast again). Width is the character count with
 * separators at half weight ("$1,000,000" fits half a row, "US$210.000" does not).
 * ponytail: calibrated on a 155px phone tile ("US$210.000" overflows, "$6,900,000" fits); re-measure if the metric font changes.
 */
const WIDE_FIGURE_UNITS = 9.25;
const isWideFigure = (tile: StatTile, units = WIDE_FIGURE_UNITS) =>
  tile.unavailableReason == null
  && typeof tile.value === 'string'
  && tile.value.length - 0.5 * (tile.value.match(/[.,\s]/g)?.length ?? 0) > units;
// alignRows draws narrow figures at the group size (1rem, not 1.875rem), so a figure is wide only past 1.875x the units.
const GROUP_FIGURE_UNITS = WIDE_FIGURE_UNITS * 1.875;

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
  tiles: allTiles,
  columns = 4,
  className,
  variant = 'framed',
  wideFigures = false,
  alignRows = false,
  frameClassName,
}) => {
  const isUnknown = (tile: StatTile) => tile.unavailableReason != null || tile.value == null;
  const unknownTiles = allTiles.filter(isUnknown);
  const inScope = useFigureReport(unknownTiles.map<HiddenFigure>((tile) => ({
    label: typeof tile.label === 'string' ? tile.label : '',
    reason: tile.unavailableReason ?? '',
    ...(tile.hiddenLink ? { link: tile.hiddenLink } : {}),
  })));
  // Inside a scope an unknown tile is not drawn at all (the page's one line reports it).
  const tiles = inScope ? allTiles.filter((tile) => !isUnknown(tile)) : allTiles;
  if (tiles.length === 0) return null;
  const wide3 = wideFigures && columns === 3;
  const smColsClass = wide3 ? WIDE_FIGURES_3_COLS : CONTAINER_COLS_CLASS[columns] ?? '';
  const spanReset = wide3 ? WIDE_FIGURES_3_SPAN_RESET : CONTAINER_SPAN_RESET[columns] ?? '';
  const isOdd = tiles.length % 2 !== 0;
  // Phone 2-col flow: a wide tile takes its row; a tile left alone in the row before it, or at the end,
  // takes its row too, so no row is half empty.
  const rowSpan: boolean[] = [];
  let col = 0;
  tiles.forEach((t, i) => {
    if (isWideFigure(t, alignRows ? GROUP_FIGURE_UNITS : WIDE_FIGURE_UNITS)) { if (col === 1) rowSpan[i - 1] = true; rowSpan[i] = true; col = 0; }
    else col = col === 0 ? 1 : 0;
  });
  if (col === 1) rowSpan[tiles.length - 1] = true;
  // alignRows: each tile's label, figure and caption share row tracks with its neighbours (subgrid), so labels and
  // figures in a row sit on one line whatever wraps; figures step down below @md so two fit abreast.
  const isBare = variant === 'bare';
  return (
    // The frame is the container the grid's column queries measure: a container query never resolves against the
    // element that declares it, so `@container` on the grid itself left every strip at two columns (#2805).
    <div className={cn('@container min-w-0', frameClassName)}>
    <div
      data-testid="stat-tiles"
      className={cn(
        // mobile: 2-col grid — all tiles visible at a glance (I6, no carousel).
        // Container query: the N-col layout is driven by the strip's OWN width, so the
        // same tiles sit 2-up in a narrow pane and N-up on a wide canvas (tidy fix).
        'grid grid-cols-2',
        // N-col equal-width grid per the columns prop once the container fits it
        smColsClass,
        // framed = the hairline-gap card strip; bare = borderless on the canvas
        isBare
          ? alignRows ? 'gap-x-[var(--space-group)]' : 'gap-[var(--space-group)]'
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
              // a wide figure's row span ends at @md (two tiles fit abreast), before any N-col layout starts, so it
              // never spans 2 of 3 columns beside a gap; the odd last tile keeps the N-col reset
              rowSpan[i] && cn('col-span-2', isLastOdd ? spanReset : '@md:col-span-1'),
              alignRows && 'row-span-3 grid grid-rows-subgrid content-start pb-[var(--space-group)]',
            )}
          >
            <div className={cn('mb-1 text-control font-medium text-foreground', alignRows && 'self-end')}>{t.label}</div>
            <div
              className={cn(
                FIGURE_LINE_CLASS,
                alignRows ? 'text-group @md:text-metric font-semibold' : 'text-metric font-semibold',
                !t.tone && 'text-foreground',
                // AC-RAM-004 (#688): raw text-success failed color-contrast in dark theme —
                // the same class of gap the 'neg' tone below was already fixed for. text-success-text
                // uses --success-text (the AA on-canvas variant), same move as destructive-text.
                t.tone === 'pos' && 'text-success-text',
                // text-destructive (#ef4444) is 3.76:1 on white — below AA 4.5:1.
                // text-destructive-text uses --destructive-text (≈6.2:1 on white, WCAG AA).
                t.tone === 'neg' && 'text-destructive-text',
              )}
            >
              <FigureContent value={t.value} exactValue={t.exactValue} unavailableReason={t.unavailableReason} unavailableShort={t.unavailableShort} />
            </div>
            {t.sub && <div className="mt-0.5 break-words text-control text-muted-foreground">{t.sub}</div>}
          </div>
        );
      })}
    </div>
    </div>
  );
};
