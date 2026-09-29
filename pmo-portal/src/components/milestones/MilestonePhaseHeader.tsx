import React from 'react';
import { useTranslation } from 'react-i18next';
import { pct, formatDayMonth } from '@/src/lib/format';
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
    ? `Target ${formatDayMonth(new Date(`${value}T00:00:00`))}`
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
  // Above the `compact` early return — a hook after it runs conditionally.
  const { t } = useTranslation();
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
          {/* AC-RAM-004 (#688) Discover-pass follow-up (2026-09-29): a long, unbroken milestone
              name (e.g. "Commissioning & Grid Connection") could overflow this flex item's own
              content-derived min-width and render UNDER the `shrink-0` % column to its right
              (15-35px overlap on the 4-column desktop card grid at 1280/1440). `break-words` forces
              a wrap point at any character rather than only at spaces, so the name always stays
              within its own column instead of bleeding into the sibling's. */}
          <span data-testid="milestone-phase-name" className="min-w-0 break-words text-[12px] font-semibold text-foreground">{name}</span>
          {/* AC-RAM-004 (#688): raw text-primary as small text is ~3.5:1 on the dark canvas (sub-AA,
              DESIGN.md accessibility posture). text-primary-text is the AA on-canvas variant, same
              token the "Back to Sales Pipeline" link (PipelineLens) already uses for blue text. */}
          {isCurrent && <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-text">{t('projectDetail.milestones.current', 'Current')}</span>}
          {isOverdue && <StatusPill variant="overdue">{t('projectDetail.milestones.overdue', 'Overdue')}</StatusPill>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {weightShare != null && (
            <span className="text-[11px] text-muted-foreground">
              {t('projectDetail.milestones.weightShare', '{{pct}}% of project', { pct: weightShare })}
            </span>
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
            aria-label={t('projectDetail.milestones.editProgressForName', 'Edit progress for {{name}}', { name })}
            // AC-RAM-004 (#688): text-primary + opacity-60 measured 3.58:1 in dark (sub-AA). Matches
            // MilestoneStrip's own compact-row Edit button: text-primary-text at full opacity, no
            // dimming — hover keeps the underline as the only additional affordance.
            className="mt-1 text-[11px] font-semibold text-primary-text hover:underline"
            onClick={onEditProgress}
          >
            {t('projectDetail.milestones.editProgress', 'Edit progress')}
          </button>
        )}
      </div>

      {/* Right column: effective percentage — a fixed min-width reserves its own column so it
          never shares horizontal space with the (now-wrapping) name column beside it. */}
      <div data-testid="milestone-phase-pct" className="min-w-[44px] shrink-0 text-right">
        <div className="text-[23px] font-bold leading-none tabular text-foreground">{pct(effectivePct)}</div>
      </div>
    </div>
  );
};

export default MilestonePhaseHeader;
