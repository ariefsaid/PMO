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

/** Neutral ramp, dark to light; text flips with the fill so every label stays readable.
 *  Fills are OPAQUE tokens (never an alpha tint): a translucent segment measures as the card
 *  behind it, so its label's contrast cannot be proved. Every ink/fill pair clears 4.5:1 in
 *  both themes — see StackedBar.contrast.test.tsx. */
const NEUTRAL = [
  'bg-foreground text-background',
  'bg-chart-neutral-mid text-background',
  'bg-secondary text-foreground',
  'bg-muted text-foreground',
];
const MIN_LABELLED_SHARE = 25;

/**
 * Parts of a whole as one stacked bar. Narrow segments retain their names and values
 * in a wrapping list so no category disappears when there is little room.
 */
export const StackedBar: React.FC<{
  ariaLabel: string;
  segments: StackedBarSegment[];
  /** Retained for existing call sites; narrow slices now keep their own colour and name. */
  otherLabel: string;
  className?: string;
  minLabelledShare?: number;
}> = ({ ariaLabel, segments, className, minLabelledShare = MIN_LABELLED_SHARE }) => {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) return null;
  const ordered = segments.filter((segment) => segment.value > 0).sort((a, b) => b.value - a.value);
  const big = ordered.filter((segment) => (segment.value / total) * 100 >= minLabelledShare);
  const small = ordered.filter((segment) => !big.includes(segment));
  // Keep every slice separate so the legend swatch always matches its own bar colour.
  const shown = ordered;
  return (
    <div className="min-w-0 space-y-2">
      {small.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground" aria-label={`${ariaLabel} legend`}>
        {small.map((segment) => <li key={segment.key}>{segment.label} {segment.display}</li>)}
      </ul>}
      <div role="img" aria-label={`${ariaLabel}: ${ordered.map((segment) => `${segment.label} ${segment.display}`).join(', ')}`} data-testid="stacked-bar" className={cn('flex h-9 w-full min-w-0 gap-px overflow-hidden rounded-md', className)}>
        {shown.map((segment, index) => {
          const share = (segment.value / total) * 100;
          const tone = segment.accent ? 'bg-destructive text-destructive-foreground' : NEUTRAL[Math.min(index, NEUTRAL.length - 1)];
          return (
            <div key={segment.key} style={{ flexGrow: segment.value, flexBasis: 0 }} title={`${segment.label}${segment.display ? ` ${segment.display}` : ''} · ${Math.round(share)}%`}
              className={cn('flex min-w-0 items-center px-2 text-sm font-medium', tone)}>
              {(share >= minLabelledShare || segment.key === '__other') && <span className="truncate">{segment.label}{segment.display ? ` ${segment.display}` : ''}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
