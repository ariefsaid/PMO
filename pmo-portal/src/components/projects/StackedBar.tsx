import React from 'react';
import { cn } from '@/src/components/ui/cn';

export interface StackedBarSegment {
  key: string;
  label: string;
  value: number;
  /** The segment's value as the reader sees it ("$3.6M", "12 tasks"); the share is added. */
  display: string;
  /** The one accent (an exception: blocked, over budget). Everything else is neutral. */
  accent?: boolean;
}

/** Neutral ramp, dark to light; text flips with the fill so every label stays readable. */
const NEUTRAL = [
  'bg-foreground/85 text-background',
  'bg-foreground/70 text-background',
  'bg-secondary text-foreground',
  'bg-muted text-foreground',
];
const NEUTRAL_SWATCHES = [
  { fill: 'hsl(var(--foreground))', opacity: 0.85 },
  { fill: 'hsl(var(--foreground))', opacity: 0.7 },
  { fill: 'hsl(var(--secondary))' },
  { fill: 'hsl(var(--muted))' },
];
const MIN_LABELLED_SHARE = 14;
const LEGEND_WIDTH = 320;
const LEGEND_ROW_HEIGHT = 18;

/**
 * Parts of a whole as one stacked bar, labelled on the bar itself (no legend to decode). Segments too thin
 * to carry a label fold into "Other" so every visible segment names itself.
 */
export const StackedBar: React.FC<{
  ariaLabel: string;
  segments: StackedBarSegment[];
  /** Retained for existing call sites; narrow slices now keep their own colour and name. */
  otherLabel: string;
  className?: string;
}> = ({ ariaLabel, segments, className }) => {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) return null;
  const ordered = segments.filter((segment) => segment.value > 0).sort((a, b) => b.value - a.value);
  const big = ordered.filter((segment) => (segment.value / total) * 100 >= MIN_LABELLED_SHARE);
  const small = ordered.filter((segment) => !big.includes(segment));
  // Keep every slice separate so the legend swatch always matches its own bar colour.
  const shown = ordered;
  let legendX = 0;
  let legendY = 0;
  const legendItems = small.map((segment) => {
    const textWidth = Math.ceil(segment.label.length * 7.5);
    const itemWidth = 16 + textWidth + 12;
    if (legendX > 0 && legendX + itemWidth > LEGEND_WIDTH) {
      legendX = 0;
      legendY += LEGEND_ROW_HEIGHT;
    }
    const item = { segment, x: legendX, y: legendY, colorIndex: shown.findIndex((shownSegment) => shownSegment.key === segment.key) };
    legendX += itemWidth;
    return item;
  });
  const legendHeight = legendItems.length ? legendY + LEGEND_ROW_HEIGHT : 0;
  return (
    <div className="min-w-0 space-y-2">
      {small.length > 0 && (
        <svg
          role="img"
          aria-label={`${ariaLabel} legend: ${small.map((segment) => segment.label).join(', ')}`}
          focusable="false"
          viewBox={`0 0 ${LEGEND_WIDTH} ${legendHeight}`}
          preserveAspectRatio="none"
          className="block max-w-full text-muted-foreground"
          style={{ width: LEGEND_WIDTH, height: legendHeight }}
        >
          {legendItems.map(({ segment, x, y, colorIndex }) => {
            const swatch = segment.accent
              ? { fill: 'hsl(var(--destructive))' }
              : NEUTRAL_SWATCHES[Math.min(Math.max(colorIndex, 0), NEUTRAL_SWATCHES.length - 1)]!;
            return (
              <g key={segment.key}>
                <rect x={x} y={y + 4} width="10" height="10" rx="2" fill={swatch.fill} fillOpacity={swatch.opacity ?? 1} />
                <text x={x + 16} y={y + 14} fill="currentColor" fontSize="14" fontFamily="inherit">{segment.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      <div role="img" aria-label={`${ariaLabel}: ${ordered.map((segment) => `${segment.label} ${segment.display}`).join(', ')}`} data-testid="stacked-bar" className={cn('flex h-9 w-full min-w-0 gap-px overflow-hidden rounded-md', className)}>
        {shown.map((segment, index) => {
          const share = (segment.value / total) * 100;
          const tone = segment.accent ? 'bg-destructive text-white' : NEUTRAL[Math.min(index, NEUTRAL.length - 1)];
          return (
            <div key={segment.key} style={{ flexGrow: segment.value, flexBasis: 0 }} title={`${segment.label}${segment.display ? ` ${segment.display}` : ''} · ${Math.round(share)}%`}
              className={cn('flex min-w-0 items-center px-2 text-sm font-medium', tone)}>
              {(share >= MIN_LABELLED_SHARE || segment.key === '__other') && <span className="truncate">{segment.label}{segment.display ? ` ${segment.display}` : ''}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
