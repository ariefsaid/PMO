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
const MIN_LABELLED_SHARE = 14;

/**
 * Parts of a whole as one stacked bar, labelled on the bar itself (no legend to decode). Segments too thin
 * to carry a label fold into "Other" so every visible segment names itself.
 */
export const StackedBar: React.FC<{
  ariaLabel: string;
  segments: StackedBarSegment[];
  otherLabel: string;
  className?: string;
}> = ({ ariaLabel, segments, otherLabel, className }) => {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) return null;
  const ordered = segments.filter((segment) => segment.value > 0).sort((a, b) => b.value - a.value);
  const big = ordered.filter((segment) => (segment.value / total) * 100 >= MIN_LABELLED_SHARE);
  const small = ordered.filter((segment) => !big.includes(segment));
  const smallValue = small.reduce((sum, segment) => sum + segment.value, 0);
  const shown = [
    ...big,
    ...(small.length > 1 || (small.length === 1 && (smallValue / total) * 100 >= MIN_LABELLED_SHARE)
      ? [{ key: '__other', label: small.length === 1 ? small[0].label : otherLabel, value: smallValue, display: small.length === 1 ? small[0].display : '' } as StackedBarSegment]
      : small),
  ];
  return (
    <div className="min-w-0 space-y-2">
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
      {small.length > 0 && (
        <ul aria-label={`${ariaLabel} legend`} className="flex flex-wrap gap-x-4 gap-y-1 text-control text-muted-foreground">
          {small.map((segment) => {
            const barIndex = shown.findIndex((shownSegment) => shownSegment.key === '__other');
            const colorIndex = barIndex >= 0 ? barIndex : shown.findIndex((shownSegment) => shownSegment.key === segment.key);
            const barSegment = shown[colorIndex];
            const swatch = barSegment?.accent
              ? 'bg-destructive'
              : NEUTRAL[Math.min(Math.max(colorIndex, 0), NEUTRAL.length - 1)]!.split(' ')[0];
            return (
              <li key={segment.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2.5 shrink-0 rounded-sm', swatch)} />
                <span>{segment.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
