import React from 'react';
import { cn } from '@/src/components/ui/cn';

export interface SplitBarPart {
  /** Stable key for this part. */
  key: string;
  /** Known amount in the smallest currency unit; a part with no amount draws nothing and is not named. */
  amount: number;
  /** The part's fill, as a colour that resolves from a token (`chartTheme.series.primary`, `hsl(var(--warning) / 0.72)`). */
  color: string;
  /** The part's name in words ("Overdue", "Over 90 days"), used in the bar's text alternative. */
  label: string;
  /** The same part's amount as the reader sees it ("$100K", "IDR 200"), currency included. */
  amountLabel: string;
  /** Optional test id for the painted segment, for the caller's own tests. */
  testId?: string;
  /** Optional `data-*` attributes the segment carries (a caller's tests may read them). */
  data?: Record<string, string | number | undefined>;
}

export interface SplitBarProps {
  /** What the bar is, in words; the text alternative starts with it ("USD balance distribution by age"). */
  label: string;
  /** One part per slice, in left-to-right order. */
  parts: SplitBarPart[];
  /** The bar's box: its height and rounding. Its width is the column it sits in, and it fills that exactly. */
  className?: string;
  /** An inner track the parts paint in, when the paint is shorter than its box (a 24px bar in a 36px row). */
  trackClassName?: string;
  /** Space between parts, in px. At 0 neighbouring parts share one edge, so no lighter seam shows between them. */
  gapPx?: number;
  /** Painted instead of nothing when no part has a known amount: a caller's empty track, which names nothing. */
  emptyClassName?: string;
  /** Test id for the bar's box (a caller's own tests read it). */
  testId?: string;
  /** Optional `data-*` attributes the bar's box carries (a caller's tests may read them). */
  data?: Record<string, string | number | undefined>;
}

/**
 * A percentage along the bar, at the four decimals the bar is painted at. Neighbouring parts read the
 * same edge from this one number, so their painted edges coincide; a value rounded down on one side and
 * up on the other leaves a sub-pixel gap at a join, showing the surface behind as a 1px lighter sliver.
 */
const barPercent = (value: number) => Number(Math.max(value, 0).toFixed(4));

/**
 * One row, split into parts of a known whole: a picture with a text alternative that names each painted
 * part and its amount. A part with no known amount paints nothing and is not named; when no part is
 * known there is no bar to draw. The paint is derived from one contiguous run of edges (not from each
 * part's own rounded share), so the parts tile the column exactly and share every join.
 */
export const SplitBar: React.FC<SplitBarProps> = ({ label, parts, className, trackClassName = 'absolute inset-0', gapPx = 0, emptyClassName, testId, data }) => {
  const painted = parts.filter((part) => part.amount > 0);
  const total = painted.reduce((sum, part) => sum + part.amount, 0);
  const boxData = { ...(data ?? {}) };

  if (painted.length === 0 || total <= 0) {
    // Nothing known to draw: no picture, so no text alternative and no painted part. A caller that keeps
    // an empty track on screen passes `emptyClassName`; that track claims nothing.
    return emptyClassName ? <div data-testid={testId} {...boxData} className={cn(className, emptyClassName)} /> : null;
  }

  // One contiguous run of edges across the bar: part i starts on edge i and ends on edge i+1, so each
  // width comes from the edge it shares with its neighbour rather than from its own rounded share. The
  // final edge is closed on exactly 100, absorbing any rounding remainder at the bar's end.
  const edges: number[] = [];
  let paintedShare = 0;
  painted.forEach((part) => {
    paintedShare += (part.amount / total) * 100;
    edges.push(barPercent(paintedShare));
  });
  edges[edges.length - 1] = 100;

  const lastIndex = painted.length - 1;
  const segments = painted.map((part, index) => {
    const start = index === 0 ? 0 : (edges[index - 1] ?? 0);
    const end = edges[index] ?? 0;
    // A gap is a deliberate sliver of the surface between parts: each part stops that far short of its
    // right edge, and the last part closes on the box's own right edge so the bar still spans it exactly.
    const width = gapPx > 0
      ? index === lastIndex ? `calc(100% - ${start}%)` : `calc(${barPercent(end - start)}% - ${gapPx}px)`
      : `${barPercent(end - start)}%`;
    return { part, start, width };
  });

  return (
    <div role="img" aria-label={`${label}. ${painted.map((part) => `${part.label} ${part.amountLabel}`).join(', ')}`} data-testid={testId} {...boxData} className={cn('relative min-w-0 overflow-hidden', className)}>
      <div className={trackClassName}>
        {segments.map(({ part, start, width }) => (
          <span
            key={part.key}
            data-testid={part.testId}
            {...(part.data ?? {})}
            aria-hidden="true"
            title={`${part.label} · ${part.amountLabel}`}
            className="absolute inset-y-0"
            style={{
              left: `${start}%`,
              width,
              background: part.color,
              // A hairline of the part's own colour past its right edge, which the next part paints over:
              // whichever way the browser rounds the two edges, part colour meets part colour. Where a gap
              // is asked for, the gap is the point, so nothing is overhung into it.
              boxShadow: gapPx > 0 ? undefined : `1px 0 0 ${part.color}`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
