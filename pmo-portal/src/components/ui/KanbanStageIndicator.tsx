import React from 'react';
import { cn } from './cn';

export interface KanbanStageItem {
  /** Display title for the stage. */
  title: string;
  /** Stage dot color — a DESIGN.md `hsl(var(--…))` token. */
  dotColor: string;
}

export interface KanbanStageIndicatorProps {
  stages: KanbanStageItem[];
  /** Index (0-based) of the currently-visible column. */
  activeIndex: number;
  /** Called when the user taps a stage button to request scrolling to that column. */
  onStageClick?: (index: number) => void;
  className?: string;
}

/**
 * Sticky stage-progress indicator for the mobile kanban (OD-W4-2, AC-IXD-MOBILE-W4-PR3-C5).
 *
 * Renders a horizontal strip of labelled stage buttons so a phone user knows which column is
 * in view and can jump to any column. Only shown below `md` (768px) via `md:hidden`; on desktop
 * the full column headers are visible and this strip is unnecessary. Each button:
 *   - has an accessible label (stage title)
 *   - has `aria-current="true"` on the active stage
 *   - has an `aria-hidden` decorative dot for the stage color
 *   - is ≥44px tall via `.touch-target` (WCAG 2.5.5)
 *
 * Tokens: `primary` active dot, `muted-foreground` inactive text, `border` divider,
 * `card` bg, `secondary` active tint — all from DESIGN.md. No new tokens.
 */
export const KanbanStageIndicator: React.FC<KanbanStageIndicatorProps> = ({
  stages,
  activeIndex,
  onStageClick,
  className,
}) => {
  return (
    <nav
      aria-label="Pipeline stage navigation"
      className={cn(
        // scroll-fade-x: right-edge mask-image fade for parity with Tabs/Stepper/TimesheetGrid
        // (signals "scroll for more" when the strip overflows at narrow widths).
        'scroll-fade-x mb-2 flex items-center gap-0 overflow-x-auto rounded-lg border border-border bg-card md:hidden',
        className,
      )}
    >
      {stages.map((stage, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={stage.title}
            type="button"
            aria-current={isActive ? 'true' : undefined}
            aria-label={stage.title}
            onClick={() => onStageClick?.(i)}
            className={cn(
              // Touch target — ≥44px height on coarse pointers (WCAG 2.5.5)
              'touch-target relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2 text-[11px] font-semibold leading-tight transition-colors',
              isActive
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
              // Left border separator (except first)
              i > 0 && 'border-l border-border',
            )}
          >
            {/* Decorative dot — aria-hidden, color-not-only (label also present) */}
            <span
              data-stage-dot
              aria-hidden="true"
              className={cn(
                'size-[7px] shrink-0 rounded-full transition-transform',
                isActive ? 'scale-110' : 'opacity-60',
              )}
              style={{ background: stage.dotColor }}
            />
            <span className="max-w-[52px] truncate text-center">{stage.title}</span>
            {/* Active underline */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-primary"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
