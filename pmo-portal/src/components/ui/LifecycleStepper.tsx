import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped' | 'paid';

export interface LifecycleStep {
  label: string;
  state: StepState;
  /** Optional mono doc reference (e.g. a PO number) shown under node steps. */
  ref?: string;
}

export interface LifecycleStepperProps {
  steps: LifecycleStep[];
  /** `inline` = 9px pips + links (table rows); `node` = 32px numbered nodes. */
  variant?: 'inline' | 'node';
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
 * Lifecycle / stage stepper (DESIGN.md signature pattern).
 *
 * The `node` variant wraps its scrollable region in a `relative` container and adds:
 *   - `data-testid="stepper-scroll-container"` on the scrollable div (for tests)
 *   - A decorative right-edge fade element (`data-testid="stepper-fade"`, `aria-hidden`)
 *     that uses the same `mask-image` gradient pattern as StatTiles/Tabs — signalling
 *     "scroll for more steps" without breaking the existing overflow-x-auto behaviour.
 *     The fade element is `pointer-events-none` so it does not interfere with mouse/touch.
 *
 * PR-3 mobile hardening (AC-IXD-MOBILE-W4-PR3-C4): adds the scroll-fade affordance.
 * Desktop is unchanged — the stepper already had overflow-x-auto px-2 pb-1.5 pt-[18px].
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

  // node variant — wrap in a relative container for the scroll-fade affordance
  return (
    <div className={cn('relative', className)}>
      {/* Scrollable step track */}
      <div
        data-testid="stepper-scroll-container"
        className="flex items-start overflow-x-auto px-2 pb-1.5 pt-[18px]"
        role="list"
        aria-label={ariaLabel}
      >
        {steps.map((s, i) => (
          <div
            key={i}
            role="listitem"
            aria-label={`${s.label}: ${s.state}`}
            className={cn(
              'pstep relative flex min-w-[96px] flex-1 flex-col items-center gap-2',
              s.state
            )}
          >
            <span
              className={cn(
                'z-[1] grid size-8 place-items-center rounded-full border-2 text-xs font-bold [&_svg]:size-[15px]',
                s.state === 'done' && 'border-success bg-success text-success-foreground',
                s.state === 'current' &&
                  'border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.15)]',
                s.state === 'skipped' && 'border-dashed border-border bg-secondary text-muted-foreground',
                s.state === 'upcoming' && 'border-border bg-background text-muted-foreground',
                s.state === 'paid' && 'border-success bg-success text-success-foreground'
              )}
            >
              {(s.state === 'done' || s.state === 'paid') ? <Icon name="check" strokeWidth={2.5} /> : i + 1}
            </span>
            <span
              className={cn(
                'text-center text-[11.5px] font-semibold leading-tight',
                s.state === 'upcoming' && 'text-muted-foreground'
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
          Decorative: aria-hidden + pointer-events-none. Uses the same gradient
          pattern as StatTiles and the Tabs strip — compositor-only, no repaint.
          Positioned absolute over the scroll container's right edge. */}
      <div
        data-testid="stepper-fade"
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-card to-transparent"
      />
    </div>
  );
};
