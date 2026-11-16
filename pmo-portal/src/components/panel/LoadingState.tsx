/**
 * LoadingState — a 3x3 pixel grid with a travelling wavefront and a shimmering label.
 * Presentation only: carries no live region and no counter, so a caller decides what a screen
 * reader hears (Thinking announces once; the grid and the shimmer are aria-hidden).
 * Adapted from MIT-licensed sources; notice in ./THIRD_PARTY_NOTICE.md.
 */
import React from 'react';

// Wavefront delays (ms) for a 3x3 grid: each cell lights after the column to its left.
const DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

export const LoadingState: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center gap-2.5 text-sm">
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {DELAYS.map((delay, i) => (
        <span
          key={i}
          className="loading-cell size-1 rounded-[1px] bg-muted-foreground"
          style={{ '--cell-delay': `${delay}ms` } as React.CSSProperties}
        />
      ))}
    </span>
    <span className="loading-label">{label}</span>
  </span>
);
