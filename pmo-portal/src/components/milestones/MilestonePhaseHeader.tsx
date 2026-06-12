import React from 'react';
import { pct } from '@/src/lib/format';
import { StatusPill } from '@/src/components/ui';

export type MilestonePhaseHeaderProps = {
  variant: 'stepper' | 'compact';
  name: string;
  targetDate: string | null;
  effectivePct: number;
  calculatedPct: number | null;
  isCurrent?: boolean;
  isOverdue?: boolean;
  canEditProgress?: boolean;
  onEditProgress?: () => void;
};

const formatTargetDate = (value: string | null) =>
  value
    ? `Target ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`))}`
    : null;

export const MilestonePhaseHeader: React.FC<MilestonePhaseHeaderProps> = ({
  variant,
  name,
  targetDate,
  effectivePct,
  calculatedPct,
  isCurrent = false,
  isOverdue = false,
  canEditProgress = false,
  onEditProgress,
}) => {
  const targetLabel = formatTargetDate(targetDate);

  if (variant === 'compact') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold">{name}</span>
        {targetLabel && <span className="text-[11.5px] text-muted-foreground">{targetLabel}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] font-semibold text-foreground">{name}</div>
      <div className="text-[24px] font-bold leading-none tabular text-foreground">{pct(effectivePct)}</div>
      {targetLabel && (
        <div className={`text-[11.5px] ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
          {targetLabel}
        </div>
      )}
      <div className="text-[11.5px] text-muted-foreground">From tasks {pct(calculatedPct)}</div>
      <div className="flex flex-wrap items-center gap-2">
        {isCurrent && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Current</span>}
        {isOverdue && <StatusPill variant="overdue">Overdue</StatusPill>}
        {canEditProgress && onEditProgress && (
          <button
            type="button"
            aria-label={`Edit progress for ${name}`}
            className="text-[12px] font-semibold text-primary opacity-60 hover:underline hover:opacity-100 focus-visible:opacity-100"
            onClick={onEditProgress}
          >
            Edit progress
          </button>
        )}
      </div>
    </div>
  );
};

export default MilestonePhaseHeader;
