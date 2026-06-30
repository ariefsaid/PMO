import React from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Button } from './Button';

interface ActionSpec {
  label: string;
  onClick: () => void;
}

export interface ListStateProps {
  variant: 'loading' | 'empty' | 'error';
  /** Empty/error heading. */
  title?: string;
  /** Empty/error supporting copy (≤44ch). String or ReactNode (e.g. a Link). */
  sub?: React.ReactNode;
  /** Empty-state icon (defaults to `inbox`). */
  icon?: IconName;
  /** Empty-state populating action (empty-states guideline). */
  action?: ActionSpec;
  /** Error-state retry handler (error-recovery: cause + fix + retry). */
  onRetry?: () => void;
  /** Number of skeleton rows for the loading variant. */
  rows?: number;
  className?: string;
  /** Override the default `liststate-loading` testid for the loading skeleton wrapper. */
  testId?: string;
}

/**
 * The single source of truth for the three async list states. Consumers render
 * exactly one ListState in place of their content — never hand-roll a spinner
 * or an ad-hoc empty message.
 */
export const ListState: React.FC<ListStateProps> = ({
  variant,
  title,
  sub,
  icon = 'inbox',
  action,
  onRetry,
  rows = 5,
  className,
  testId,
}) => {
  if (variant === 'loading') {
    return (
      <div
        data-testid={testId ?? 'liststate-loading'}
        aria-busy="true"
        aria-live="polite"
        className={cn('p-4', className)}
      >
        <span className="sr-only">Loading…</span>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skel skel-line" style={{ width: `${90 - (i % 3) * 12}%` }} />
        ))}
      </div>
    );
  }

  if (variant === 'error') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-4 py-3.5',
          className
        )}
      >
        <Icon name="alert" className="size-5 shrink-0 text-destructive" />
        <div className="flex-1">
          {title && (
            <div className="text-[13.5px] font-semibold" style={{ color: 'hsl(0 72% 42%)' }}>
              {title}
            </div>
          )}
          {sub && <div className="mt-px text-[12.5px] text-muted-foreground">{sub}</div>}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <Icon name="refresh" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  // empty
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className
      )}
    >
      <span className="grid size-[52px] place-items-center rounded-[14px] bg-secondary text-muted-foreground">
        <Icon name={icon} className="size-6" strokeWidth={1.75} />
      </span>
      {title && <div className="text-[15px] font-semibold">{title}</div>}
      {sub && <div className="max-w-[44ch] text-[13px] text-muted-foreground">{sub}</div>}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
};
