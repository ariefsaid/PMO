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
  /** Columns (default 4). */
  columns?: number;
  className?: string;
}

/**
 * Hairline-gap strip of stat tiles (the 1px `border` shows through as separators).
 *
 * Responsive (polish #5): on a narrow viewport a fixed `repeat(N,1fr)` grid crushes
 * each tile below a legible width and clips money figures mid-number, reading as
 * broken. Below `sm` the strip becomes a horizontal scroll region — each tile keeps
 * a `min-w` floor so figures stay whole and the next tile peeks past the edge, and a
 * trailing `mask-image` fade signals "there's more to scroll". Scroll-snap makes it
 * land cleanly per tile. From `sm:` up the equal-width grid is restored (no clip at
 * tablet/desktop, no fade). The fade uses `mask-image` (compositor-only, no repaint).
 */
export const StatTiles: React.FC<StatTilesProps> = ({ tiles, columns = 4, className }) => (
  <div
    data-testid="stat-tiles"
    className={cn(
      'rounded-lg border border-border bg-border',
      // mobile: horizontal scroll with snap + a trailing fade affordance
      'flex snap-x snap-mandatory gap-px overflow-x-auto overflow-y-hidden',
      '[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]',
      // sm+: equal-width grid, no scroll, no fade
      'sm:grid sm:snap-none sm:gap-px sm:overflow-visible sm:[mask-image:none]',
      className
    )}
    style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
  >
    {tiles.map((t, i) => (
      <div
        key={i}
        data-testid="stat-tile"
        className="shrink-0 snap-start basis-[44%] bg-card px-3.5 py-[13px] min-w-[150px] sm:shrink sm:basis-auto sm:min-w-0 first:rounded-l-lg last:rounded-r-lg sm:rounded-none"
      >
        <div className="mb-1 text-[11.5px] text-muted-foreground">{t.label}</div>
        <div
          className={cn(
            'text-[17px] font-bold tracking-[-0.01em] tabular',
            t.tone === 'pos' && 'text-success',
            t.tone === 'neg' && 'text-destructive'
          )}
        >
          {t.value}
        </div>
        {t.sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{t.sub}</div>}
      </div>
    ))}
  </div>
);
