import type { IncidentRow } from '@/src/lib/db/incidents';

/**
 * An issue is overdue when it is not Closed and its due time has passed — computed from `due_at` and the clock,
 * never from whether the escalation job has run (FR-SIL-022). A row with no due time is never overdue.
 */
export function isIncidentOverdue(
  incident: Pick<IncidentRow, 'status' | 'due_at'>,
  now: Date = new Date(),
): boolean {
  if (incident.status === 'Closed' || !incident.due_at) return false;
  return new Date(incident.due_at).getTime() < now.getTime();
}

/** High and Critical issues need a close photo before they close (enforced in the database; this only tells the form). */
export function needsCloseProof(severity: IncidentRow['severity']): boolean {
  return severity === 'High' || severity === 'Critical';
}
