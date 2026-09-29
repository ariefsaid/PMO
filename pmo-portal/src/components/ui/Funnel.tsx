import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';

export interface FunnelStage {
  name: string;
  dotColor?: string;
  prob?: string;
  value: React.ReactNode;
  weighted?: React.ReactNode;
  /** 0-100 bar fill. */
  barPct?: number;
  barColor?: string;
}

export interface FunnelProps {
  stages: FunnelStage[];
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  className?: string;
}

/** Connected stage-summary band (macro analog of the stepper).
 *  Owns its own local horizontal scroll viewport so narrow hosts (Sales Pipeline at phone width,
 *  dashboard panels) keep every stage's exact value readable inside its own stage instead of
 *  clipping/overlapping a neighbour or widening the page (FR-SFA-001/004).
 *
 *  ⚑ Track sizing (Discover fix, #687 follow-up, 2026-09-28): each column's MIN is the stage's
 *  own `max-content` — an intrinsic sizing function, so the grid track-sizing algorithm treats
 *  it as a hard content-derived floor that grows for a long, unbreakable amount (an IDR figure
 *  can reach trillions and never wraps — `Intl.NumberFormat('id-ID', …)` joins the symbol to the
 *  digits with a NBSP and there is no space-based break inside the grouped digits). A *fixed*
 *  `10rem` floor cannot grow past its own value, so a longer amount just overflowed into the
 *  neighbouring stage. The MAX stays `1fr` (not `max-content`) so a wide desktop viewport still
 *  distributes its leftover width evenly across stages, keeping them equal-looking when every
 *  amount already fits — `max-content` on both ends would leave stages bunched left with dead
 *  space on the right instead. */
export const Funnel: React.FC<FunnelProps> = ({ stages, selectedIndex, onSelect, className }) => {
  const { t } = useTranslation();
  const interactive = !!onSelect;
  // A non-interactive Funnel (e.g. a dashboard panel with no onSelect) has NO focusable stage —
  // the scroll viewport itself must be the focusable target, or a keyboard user simply cannot
  // reach its overflow (axe `scrollable-region-focusable`). When stages ARE interactive they are
  // already focusable buttons, so adding a second wrapper tab stop would only be redundant.
  const scrollAreaA11yProps = interactive
    ? {}
    : {
        role: 'group' as const,
        'aria-label': t('funnel.scrollableRegion', 'Stage summary, scrollable horizontally'),
        tabIndex: 0,
      };

  return (
    <div
      data-testid="funnel-scroll-area"
      className={cn(
        'max-w-full min-w-0 overflow-x-auto',
        !interactive &&
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className
      )}
      {...scrollAreaA11yProps}
    >
      <div
        data-testid="funnel-stage-grid"
        className="grid min-w-full"
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(max-content, 1fr))` }}
      >
        {stages.map((s, i) => {
          const selected = i === selectedIndex;
          return (
            <div
              key={i}
              data-funnel-stage
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-pressed={interactive ? selected : undefined}
              onClick={() => onSelect?.(i)}
              onKeyDown={(e) => {
                if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onSelect?.(i);
                }
              }}
              onFocus={(e) => {
                // Discover fix: Tab to a partly off-screen stage previously left it clipped by
                // the scroll viewport's edge. `inline`/`block: 'nearest'` moves only as far as
                // needed to reveal the stage, never re-centering or scrolling the whole page.
                if (interactive) e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' });
              }}
              className={cn(
                'relative flex flex-col border border-r-0 border-border px-3.5 pb-3 pt-[13px] first:rounded-l-lg last:rounded-r-lg last:border-r',
                interactive && 'cursor-pointer',
                // Discover fix I-1 (2026-09-28): the global `*:focus-visible` ring draws OUTWARD
                // (2px width, 2px offset) from the stage, but the scroll viewport's own
                // `overflow-x-auto` clips vertical overflow too (per the CSS overflow spec, one
                // non-visible axis forces the other to `auto`), slicing the ring's top/bottom
                // edge off. A negative outline-offset pulls the ring back inside the stage's own
                // border box instead — same 2px width/color token, just drawn inward — so it
                // never crosses into the ancestor's clip region on any side.
                interactive && 'focus-visible:outline-offset-[-2px]',
                selected && 'bg-primary/[0.06] shadow-[inset_0_-2px_0_hsl(var(--primary))]'
              )}
            >
              <div className="mb-2 flex items-center gap-[7px]">
                <span
                  aria-hidden
                  className="size-[9px] shrink-0 rounded-full"
                  style={{ background: s.dotColor ?? 'hsl(var(--primary))' }}
                />
                <span className="text-xs font-semibold">{s.name}</span>
                {s.prob && (
                  <span className="ml-auto text-[11px] font-bold text-muted-foreground">{s.prob}</span>
                )}
              </div>
              <div data-funnel-stage-amount className="text-[17px] font-bold leading-none tracking-[-0.02em] tabular">
                {s.value}
              </div>
              {s.weighted && (
                <div data-funnel-stage-weighted className="mt-[7px] text-[11px] text-muted-foreground">
                  {s.weighted}
                </div>
              )}
              {s.barPct !== undefined && (
                // Discover fix (round 3): `mt-auto` alone aligns bars across a stretched grid row,
                // but resolves to a 0px gap whenever every stage's natural content height is
                // already equal (the common case — nothing wraps), since a flex column with no
                // imposed extra height gives `margin-top: auto` no free space to consume. `pt-2`
                // on this OUTER (transparent) wrapper enforces the design's 8px floor
                // unconditionally, while the inner track div keeps its own background/height
                // unchanged — padding on the track itself would have painted `bg-secondary`
                // through the gap. `mt-auto` still does the cross-stage alignment: every stage's
                // wrapper contributes the same fixed pt-2, so the alignment math is unaffected.
                <div className="mt-auto pt-2">
                  <div data-funnel-stage-bar className="h-[5px] overflow-hidden rounded-full bg-secondary">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, s.barPct))}%`,
                        background: s.barColor ?? 'hsl(var(--primary))',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
