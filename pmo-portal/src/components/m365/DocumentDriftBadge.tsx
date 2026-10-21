import { useTranslation } from 'react-i18next';
import { Icon, StatusPill } from '@/src/components/ui';
import { formatInstantDate } from '@/src/lib/format';
import { APPROVED_STATUSES } from '@/src/lib/m365/reference';

export interface DocumentDriftBadgeProps {
  status: string;
  driftState: 'clean' | 'drifted' | 'not_verified' | null;
  /** Time of the last SUCCESSFUL content check; a claim or attempt time is never passed here. */
  lastVerifiedAt: string | null;
  /** Register rows: one short pill, the full sentence kept for assistive tech and the tooltip. */
  compact?: boolean;
}

/**
 * Persisted content-drift state for a controlled project file (ADR-0071 §4): exactly three
 * outcomes, never an unbadged "looks fine". A clean result without a recorded successful check
 * is not trusted, and a failed check never reads as clean.
 */
export function DocumentDriftBadge({ status, driftState, lastVerifiedAt, compact = false }: DocumentDriftBadgeProps) {
  const { t } = useTranslation();
  const approval = APPROVED_STATUSES.has(status);
  const verifiedOn = lastVerifiedAt ? formatInstantDate(lastVerifiedAt) : null;
  const since = approval ? t('m365Documents.drift.sinceApproval', 'since approval') : t('m365Documents.drift.sinceIssue', 'since issue');

  if (driftState === 'drifted') {
    // Compact keeps the as-of date: it only shows on the rare changed file, so rows stay short.
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusPill variant="warn">
          {compact ? <>{t('m365Documents.drift.changed', 'Changed')}<span className="sr-only">{since}</span></> : approval ? t('m365Documents.drift.changedSinceApproval', 'Changed since approval') : t('m365Documents.drift.changedSinceIssue', 'Changed since issue')}
        </StatusPill>
        {verifiedOn && <span className="text-[12px] text-muted-foreground">{t('m365Documents.drift.checked', 'Checked {{date}}', { date: verifiedOn })}</span>}
      </div>
    );
  }
  if (driftState === 'clean' && verifiedOn) {
    const full = approval
      ? t('m365Documents.drift.unchangedSinceApproval', 'Unchanged since approval. Verified {{date}}.', { date: verifiedOn })
      : t('m365Documents.drift.unchangedSinceIssue', 'Unchanged since issue. Verified {{date}}.', { date: verifiedOn });
    return (
      <span className="inline-flex min-w-0 items-start gap-1 break-words text-[12px] text-muted-foreground" title={compact ? full : undefined}>
        <Icon name="check" className="mt-0.5 shrink-0" />
        {compact ? <>{t('m365Documents.drift.unchanged', 'Unchanged')}<span className="sr-only">{since}</span></> : full}
      </span>
    );
  }
  const failed = driftState === 'not_verified';
  const detail = verifiedOn && failed
    ? t('m365Documents.drift.notVerifiedSince', 'Not verified since {{date}}. Microsoft could not be checked.', { date: verifiedOn })
    : failed
      ? t('m365Documents.drift.notVerifiedYetFailed', 'Not verified yet. Microsoft could not be checked.')
      : t('m365Documents.drift.notVerifiedYet', 'Not verified yet.');
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={compact ? detail : undefined}>
      <StatusPill variant="neutral">{t('m365Documents.drift.notVerified', 'Not verified')}</StatusPill>
      {!compact && <span className="break-words text-[12px] text-muted-foreground">{detail}</span>}
    </div>
  );
}
