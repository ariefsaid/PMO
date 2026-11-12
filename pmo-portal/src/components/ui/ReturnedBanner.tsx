import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatDecisionDateTime } from '@/src/lib/format';
import { statusLabel, statusTone, type StatusRecord } from '@/src/lib/status/statusMap';
import { Button } from './Button';
import { cn } from './cn';
import { Icon } from './icons';

type ReturnRecord = Extract<StatusRecord, 'timesheet' | 'expense' | 'equipmentUsage' | 'imprest'>;

export interface ReturnedBannerProps {
  record: ReturnRecord;
  reason?: string | null;
  /** Resolved from the record's existing profile foreign-key embed, like procurement history. */
  person?: string | null;
  at?: string | null;
  /** What the person must do next (e.g. the resubmit instruction); rendered under the reason. */
  instruction?: string | null;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  className?: string;
}

/** One decision summary for reversible returns and terminal rejections. */
export const ReturnedBanner: React.FC<ReturnedBannerProps> = ({ record, reason, person, at, instruction, action, className }) => {
  const { t } = useTranslation(['common', 'status']);
  const stateName = statusLabel(record, 'Rejected', t);
  const isWaiting = statusTone(record, 'Rejected') === 'waiting';
  const actorName = person?.trim() || null;
  const instant = at ? new Date(at) : null;
  const decisionTime = instant && Number.isFinite(instant.getTime()) ? formatDecisionDateTime(instant) : null;
  const title = [
    actorName ? `${stateName} ${t('status:decision.by', 'by')} ${actorName}` : stateName,
    decisionTime,
  ].filter(Boolean).join(' · ');
  const decisionReason = reason?.trim() ? reason : t('status:decision.reasonUnavailable', 'Reason unavailable');

  return (
    <div
      role="status"
      className={cn(
        'mb-3.5 flex flex-wrap items-start gap-2.5 rounded-lg border px-3.5 py-3',
        isWaiting ? 'border-warning/30 bg-waiting-surface' : 'border-destructive/30 bg-destructive/[0.07]',
        className,
      )}
    >
      <Icon name="alert" className={cn('mt-px size-[17px] shrink-0', isWaiting ? '[color:hsl(var(--warning-icon))]' : 'text-destructive-text')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className={cn('break-words text-control font-semibold', isWaiting ? 'text-warning-foreground' : 'text-destructive-text')}>{title}</div>
        <div className="break-words text-control text-foreground">{decisionReason}</div>
        {instruction?.trim() ? (
          <div className="break-words text-control text-muted-foreground">{instruction}</div>
        ) : null}
      </div>
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick} disabled={action.disabled} className="touch-target shrink-0">
          {action.label}
        </Button>
      )}
    </div>
  );
};
