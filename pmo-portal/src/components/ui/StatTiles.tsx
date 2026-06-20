import React from 'react';
import { cn } from './cn';

export interface StatTile {
  label: string;
  value: React.ReactNode;
  /** Positive → success, negative → destructive coloring on the value. */
  tone?: 'pos' | 'neg';
  sub?: React.ReactNode;
}

export interface StatTilesProps {
  tiles: StatTile[];
  /** Columns at sm+ breakpoint (default 4). Mobile is always 2-col. */
  columns?: number;
  className?: string;
}

/**
 * Stat-tile column count map: for each columns value, the Tailwind `sm:grid-cols-*`
 * class that overrides the mobile 2-col base at the sm+ breakpoint.
 * Hardcoded so Tailwind's JIT can statically detect these classes.
 * Covers 1–6 columns; add entries here if larger counts are ever needed.
 */
const SM_COLS_CLASS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
};

/**
 * Hairline-gap strip of stat tiles (the 1px `border` shows through as separators).
 *
 * Responsive (I6 fix): on mobile the strip renders as a 2-col grid so all KPIs are
 * visible at a glance — the previous horizontal-scroll carousel pushed KPIs off-screen
 * (design-review I6). At the `sm:` breakpoint and above the strip switches to the
 * equal-width grid driven by the `columns` prop. No snap, no overflow-x.
 */
export const StatTiles: React.FC<StatTilesProps> = ({ tiles, columns = 4, className }) => {
  const smColsClass = SM_COLS_CLASS[columns] ?? `sm:grid-cols-${columns}`;
  return (
    <div
      data-testid="stat-tiles"
      className={cn(
        'rounded-lg border border-border bg-border',
        // mobile: 2-col grid — all tiles visible at a glance (I6, no carousel)
        'grid grid-cols-2 gap-px',
        // sm+: N-col equal-width grid per the columns prop
        smColsClass,
        className,
      )}
    >
      {tiles.map((t, i) => (
        <div
          key={i}
          data-testid="stat-tile"
          className="bg-card px-3.5 py-[13px] first:rounded-l-lg last:rounded-r-lg"
        >
          <div className="mb-1 text-[11.5px] text-muted-foreground">{t.label}</div>
          <div
            className={cn(
              'text-[17px] font-bold tracking-[-0.01em] tabular',
              t.tone === 'pos' && 'text-success',
              t.tone === 'neg' && 'text-destructive',
            )}
          >
            {t.value}
          </div>
          {t.sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
};
