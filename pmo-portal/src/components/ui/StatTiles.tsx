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

/** Hairline-gap grid of stat tiles (border shows through as 1px separators). */
export const StatTiles: React.FC<StatTilesProps> = ({ tiles, columns = 4, className }) => (
  <div
    className={cn(
      'grid gap-px overflow-hidden rounded-lg border border-border bg-border',
      className
    )}
    style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
  >
    {tiles.map((t, i) => (
      <div key={i} className="bg-card px-3.5 py-[13px]">
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
