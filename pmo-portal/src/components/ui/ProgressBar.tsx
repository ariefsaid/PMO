import React from 'react';
import { cn } from './cn';

export type ProgressTone = 'success' | 'warning' | 'destructive' | 'primary';

export interface ProgressBarProps {
  /** 0-100 (values >100 clamp the bar to 100% and force the over-budget tone). */
  value: number;
  /** Override the threshold-computed tone with a fixed series color. */
  tone?: ProgressTone;
  /** Render the trailing tabular percent. */
  showValue?: boolean;
  className?: string;
  'aria-label'?: string;
}

const TONE_CLASS: Record<ProgressTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  primary: 'bg-primary',
};

/** ≥70 → success · ≥40 → warning · else destructive (win% / utilization). */
function thresholdTone(pct: number): ProgressTone {
  if (pct >= 70) return 'success';
  if (pct >= 40) return 'warning';
  return 'destructive';
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  tone,
  showValue = false,
  className,
  'aria-label': ariaLabel,
}) => {
  const over = value > 100;
  const width = Math.max(0, Math.min(100, value));
  const resolvedTone: ProgressTone = over ? 'destructive' : (tone ?? thresholdTone(value));

  return (
    <span className={cn('inline-flex min-w-[120px] items-center gap-2', className)}>
      <span
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[7px] min-w-[70px] flex-1 overflow-hidden rounded-full bg-secondary"
      >
        <span
          data-testid="progress-fill"
          className={cn('block h-full rounded-full', TONE_CLASS[resolvedTone])}
          style={{ width: `${width}%` }}
        />
      </span>
      {showValue && (
        <span className="w-10 text-right text-[12.5px] font-bold tabular">{value}%</span>
      )}
    </span>
  );
};
