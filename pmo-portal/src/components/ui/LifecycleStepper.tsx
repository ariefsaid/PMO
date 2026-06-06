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

  return (
    <div
      className={cn('flex items-start overflow-x-auto px-2 pb-1.5 pt-[18px]', className)}
      role="list"
      aria-label={ariaLabel}
    >
      {steps.map((s, i) => (
        <div
          key={i}
          role="listitem"
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
              (s.state === 'upcoming' || s.state === 'paid') &&
                'border-border bg-background text-muted-foreground'
            )}
          >
            {s.state === 'done' ? <Icon name="check" strokeWidth={2.5} /> : i + 1}
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
  );
};
