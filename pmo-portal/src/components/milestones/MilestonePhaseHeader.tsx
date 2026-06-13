import React from 'react';
import { pct } from '@/src/lib/format';
import { StatusPill } from '@/src/components/ui';

export type MilestonePhaseHeaderProps = {
  variant: 'stepper' | 'compact';
  name: string;
  targetDate: string | null;
  effectivePct: number;
  /** Milestone weight (from project_milestones.weight). */
  weight?: number;
  /** Sum of all milestone weights in the project. */
  totalWeight?: number;
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
  weight,
  totalWeight,
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

  // Stepper variant: name + status badges on left, effective % on right.
  // Under name: weight share and target date.
  const weightShare =
    weight != null && totalWeight != null && totalWeight > 0
      ? Math.round((weight / totalWeight) * 100)
      : null;

  return (
    <div className="flex justify-between gap-2">
      {/* Left column: name + badges, weight share, target */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-foreground">{name}</span>
          {isCurrent && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Current</span>}
          {isOverdue && <StatusPill variant="overdue">Overdue</StatusPill>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {weightShare != null && (
            <span className="text-[11px] text-muted-foreground">{weightShare}% of project</span>
          )}
          {targetLabel && (
            <span className={`text-[11px] ${isOverdue ? 'text-warning-foreground font-semibold' : 'text-muted-foreground'}`}>
              {targetLabel}
            </span>
          )}
        </div>
        {canEditProgress && onEditProgress && (
          <button
            type="button"
            aria-label={`Edit progress for ${name}`}
            className="mt-1 text-[11px] font-semibold text-primary opacity-60 hover:underline hover:opacity-100 focus-visible:opacity-100"
            onClick={onEditProgress}
          >
            Edit progress
          </button>
        )}
      </div>

      {/* Right column: effective percentage */}
      <div className="shrink-0 text-right">
        <div className="text-[23px] font-bold leading-none tabular text-foreground">{pct(effectivePct)}</div>
      </div>
    </div>
  );
};

export default MilestonePhaseHeader;
