import { useTranslation } from 'react-i18next';
import { Button, Icon, StatusPill } from '@/src/components/ui';
import { formatInstantDate } from '@/src/lib/format';
import { APPROVED_STATUSES } from '@/src/lib/m365/reference';

export interface DocumentDriftBadgeProps {
  status: string;
  driftState: 'clean' | 'drifted' | 'not_verified' | null;
  /** Time of the last SUCCESSFUL content check; a claim or attempt time is never passed here. */
  lastVerifiedAt: string | null;
  /** Register rows: one short pill, the full sentence kept for assistive tech and the tooltip. */
  compact?: boolean;
  /** Live state from the parent register's shared display-triggered check. */
  checking?: boolean;
  checkFailed?: boolean;
  onRetry?: () => void;
}

/**
 * Persisted content-drift state for a controlled project file (ADR-0071 §4): exactly three
 * outcomes, never an unbadged "looks fine". A clean result without a recorded successful check
 * is not trusted, and a failed check never reads as clean.
 */
export function DocumentDriftBadge({
  status,
  driftState,
  lastVerifiedAt,
  compact = false,
  checking = false,
  checkFailed = false,
  onRetry,
}: DocumentDriftBadgeProps) {
  const { t } = useTranslation();
  const { t: tp } = useTranslation('project');
  const approval = APPROVED_STATUSES.has(status);
  const verifiedOn = lastVerifiedAt ? formatInstantDate(lastVerifiedAt) : null;
  const since = approval
    ? t('m365Documents.drift.sinceApproval', 'compared with the issue-time baseline')
    : t('m365Documents.drift.sinceIssue', 'compared with the issue-time baseline');
  const verificationFeedback = (drift: typeof driftState) => {
    const showRetry = !checking && Boolean(onRetry) && (checkFailed || drift === 'not_verified');
    if (!checking && !checkFailed && !showRetry) return null;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        {checking && <span role="status" className="text-[12px] text-muted-foreground">{tp('m365Documents.verification.checking', 'Checking Microsoft file content…')}</span>}
        {!checking && checkFailed && <span role="status" className="break-words text-[12px] text-muted-foreground">{tp('m365Documents.verification.failed', "Couldn't check with Microsoft. This status may be out of date.")}</span>}
        {showRetry && <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onRetry?.(); }}>{tp('m365Documents.verification.retry', 'Retry check')}</Button>}
      </div>
    );
  };

  if (driftState === 'drifted') {
    // Compact keeps the as-of date: it only shows on the rare changed file, so rows stay short.
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusPill variant="warn">
          {compact ? <>{t('m365Documents.drift.changed', 'Changed')}<span className="sr-only">{since}</span></> : approval ? t('m365Documents.drift.changedSinceApproval', 'File content differs from its issue-time baseline.') : t('m365Documents.drift.changedSinceIssue', 'File content differs from its issue-time baseline.')}
        </StatusPill>
        {verifiedOn && <span className="text-[12px] text-muted-foreground">{t('m365Documents.drift.checked', 'Checked {{date}}', { date: verifiedOn })}</span>}
        {verificationFeedback(driftState)}
      </div>
    );
  }
  if (driftState === 'clean' && verifiedOn) {
    const full = approval
      ? t('m365Documents.drift.unchangedSinceApproval', 'File content matches its issue-time baseline. Verified {{date}}.', { date: verifiedOn })
      : t('m365Documents.drift.unchangedSinceIssue', 'File content matches its issue-time baseline. Verified {{date}}.', { date: verifiedOn });
    const unchanged = (
      <span className="inline-flex min-w-0 items-start gap-1 break-words text-[12px] text-muted-foreground" title={compact ? full : undefined}>
        <Icon name="check" className="mt-0.5 shrink-0" />
        {compact ? <>{t('m365Documents.drift.unchanged', 'Unchanged')}<span className="sr-only">{since}</span></> : full}
      </span>
    );
    if (!checking && !checkFailed) return unchanged;
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        {unchanged}
        {compact && verifiedOn && <span className="text-[12px] text-muted-foreground">{t('m365Documents.drift.checked', 'Checked {{date}}', { date: verifiedOn })}</span>}
        {verificationFeedback(driftState)}
      </div>
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
      {verificationFeedback(driftState)}
    </div>
  );
}
