import { Icon, StatusPill } from '@/src/components/ui';
import { formatInstantDate } from '@/src/lib/format';

/** Statuses that read as an approval: Closed/Superseded are historic approvals (ADR-0071). */
export const APPROVED_STATUSES: ReadonlySet<string> = new Set(['Approved', 'Closed', 'Superseded']);

export interface DocumentDriftBadgeProps {
  status: string;
  driftState: 'clean' | 'drifted' | 'not_verified' | null;
  /** Time of the last SUCCESSFUL content check; a claim or attempt time is never passed here. */
  lastVerifiedAt: string | null;
}

/**
 * Persisted content-drift state for a controlled project file (ADR-0071 §4): exactly three
 * outcomes, never an unbadged "looks fine". A clean result without a recorded successful check
 * is not trusted, and a failed check never reads as clean.
 */
export function DocumentDriftBadge({ status, driftState, lastVerifiedAt }: DocumentDriftBadgeProps) {
  const baseline = APPROVED_STATUSES.has(status) ? 'approval' : 'issue';
  const verifiedOn = lastVerifiedAt ? formatInstantDate(lastVerifiedAt) : null;

  if (driftState === 'drifted') {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusPill variant="warn">{`Changed since ${baseline}`}</StatusPill>
        {verifiedOn && <span className="text-[12px] text-muted-foreground">{`Checked ${verifiedOn}`}</span>}
      </div>
    );
  }
  if (driftState === 'clean' && verifiedOn) {
    return (
      <span className="inline-flex min-w-0 items-start gap-1 break-words text-[12px] text-muted-foreground">
        <Icon name="check" className="mt-0.5 shrink-0" />
        {`Unchanged since ${baseline}. Verified ${verifiedOn}.`}
      </span>
    );
  }
  const reason = driftState === 'not_verified' ? ' Microsoft could not be checked.' : '';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <StatusPill variant="neutral">Not verified</StatusPill>
      <span className="break-words text-[12px] text-muted-foreground">
        {verifiedOn && driftState === 'not_verified' ? `Not verified since ${verifiedOn}.${reason}` : `Not verified yet.${reason}`}
      </span>
    </div>
  );
}
