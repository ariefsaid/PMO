import React from 'react';
import { cn } from './cn';

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped' | 'paid';

export interface LifecycleStep {
  label: string;
  state: StepState;
  /** Optional mono doc reference (e.g. a PO number) shown under a bar step. */
  ref?: string;
}

export interface LifecycleStepperProps {
  steps: LifecycleStep[];
  /**
   * `inline` = 9px pips + links (the compact in-row form used in table cells);
   * `bar` = the canonical even-flex BAR stepper (DESIGN.md §5 — the ONE stepper).
   * The numbered-circle `node` variant was retired in the Coherence Wave.
   */
  variant?: 'inline' | 'bar';
  className?: string;
  'aria-label'?: string;
}

const PIP_CLASS: Record<StepState, string> = {
  done: 'bg-primary',
  current: 'bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]',
  upcoming: 'bg-secondary',
  skipped: 'bg-secondary',
  paid: 'bg-success',
};

/**
 * Even-flex BAR-stepper fill per state (DESIGN.md §5). `done`/`paid` → `success`;
 * `current` → `primary`; `upcoming`/`skipped` leave the `secondary` track bare.
 */
const BAR_FILL_CLASS: Record<StepState, string> = {
  done: 'bg-success',
  current: 'bg-primary',
  upcoming: 'bg-transparent',
  skipped: 'bg-transparent',
  paid: 'bg-success',
};

/**
 * Lifecycle / stage stepper (DESIGN.md §5 signature pattern) — the ONE stepper.
 *
 * `bar` is the canonical even-flex BAR stepper: equal-flex steps, each a 6px rounded
 * `jbar` over a `secondary` track + a label (+ optional mono doc ref). It drives the
 * project stage journey, the budget-version lifecycle, AND the procurement
 * PR→VQ→PO→GR→VI→Paid lifecycle. `inline` is its compact in-row pip form (table cells).
 *
 * The bar variant wraps its scrollable region in a `relative` container and adds the
 * mobile scroll-fade affordance (AC-IXD-MOBILE-W4-PR3-C4):
 *   - `data-testid="stepper-scroll-container"` on the scrollable div
 *   - a decorative right-edge fade (`data-testid="stepper-fade"`, aria-hidden +
 *     pointer-events-none) signalling "scroll for more steps".
 */
export const LifecycleStepper: React.FC<LifecycleStepperProps> = ({
  steps,
  variant = 'inline',
  className,
  'aria-label': ariaLabel = 'Lifecycle',
}) => {
  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center', className)} role="list" aria-label={ariaLabel}>
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'inline-block h-0.5 w-2.5 align-middle',
                  steps[i - 1].state === 'done' || steps[i - 1].state === 'paid'
                    ? 'bg-primary/50'
                    : 'bg-border'
                )}
              />
            )}
            <span
              role="listitem"
              aria-label={`${s.label}: ${s.state}`}
              className={cn('size-[9px] shrink-0 rounded-full', PIP_CLASS[s.state])}
            />
          </React.Fragment>
        ))}
      </span>
    );
  }

  // bar variant — even-flex journey bars + the scroll-fade affordance.
  return (
    <div className={cn('relative', className)}>
      {/* Scrollable step track */}
      <div
        data-testid="stepper-scroll-container"
        className="flex items-start gap-2 overflow-x-auto px-2 pb-1.5 pt-1"
        role="list"
        aria-label={ariaLabel}
      >
        {steps.map((s, i) => (
          <div
            key={i}
            role="listitem"
            aria-label={`${s.label}: ${s.state}`}
            aria-current={s.state === 'current' ? 'step' : undefined}
            className={cn(
              'jstep flex min-w-[88px] flex-1 flex-col gap-1.5',
              s.state,
            )}
          >
            {/* 6px rounded jbar over the secondary track (DESIGN.md §5). */}
            <span aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <span className={cn('block h-full w-full rounded-full', BAR_FILL_CLASS[s.state])} />
            </span>
            <span
              className={cn(
                'text-[11.5px] font-semibold leading-tight',
                s.state === 'upcoming' || s.state === 'skipped'
                  ? 'text-muted-foreground'
                  : 'text-foreground',
              )}
            >
              {s.label}
            </span>
            {s.ref && (
              <span className="font-mono text-[10px] text-muted-foreground">{s.ref}</span>
            )}
          </div>
        ))}
      </div>

      {/* Right-edge scroll-fade affordance (AC-IXD-MOBILE-W4-PR3-C4).
          Decorative: aria-hidden + pointer-events-none. Same gradient pattern as
          StatTiles and the Tabs strip — compositor-only, no repaint. */}
      <div
        data-testid="stepper-fade"
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-card to-transparent"
      />
    </div>
  );
};
