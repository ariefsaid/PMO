import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { mayDecideRoutedApproval } from '@/src/lib/procurement/approvalRoute';

export type ApprovalKind = 'procurement' | 'timesheets' | 'expense' | 'invoice';
export type ApprovalScope = 'all' | ApprovalKind;

export interface ApprovalPopulationEntry<T = unknown> {
  /** Prefix keys with the kind so equal database IDs from distinct entities stay distinct. */
  key: string;
  kind: ApprovalKind;
  createdAt: string;
  row: T;
}

/** Combine already-eligible kind adapters into one deterministic, de-duplicated inbox population. */
export function approvalPopulation<T>(
  entries: readonly ApprovalPopulationEntry<T>[],
  scope: ApprovalScope,
): ApprovalPopulationEntry<T>[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (scope !== 'all' && entry.kind !== scope) return false;
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    })
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * The pending-procurement-approval predicate, hoisted to ONE place (Wave-6 H7).
 * A PR is awaiting the viewer's decision when it is `Requested`, was NOT raised by the viewer (SoD-a),
 * and — #803 — its approval route is flat/unread or names the viewer. Admin break-glass is deliberately
 * NOT applied here: a request routed to named people is not "awaiting" an Admin (DD-APR-5); the Admin
 * still decides it from the request page. A request routed to `admin` (DD-APR-4: no senior approver is
 * eligible) IS awaiting every Admin. UX-only; transition_procurement is the authority.
 * Returns a new array (never mutates input); tolerant of null/undefined.
 */
export function pendingProcurementApprovals(
  list: ProcurementWithRefs[] | null | undefined,
  selfId: string | null | undefined,
  isAdmin = false,
): ProcurementWithRefs[] {
  return (list ?? []).filter(
    (p) =>
      p.status === 'Requested' &&
      p.requested_by_id !== selfId &&
      mayDecideRoutedApproval(p.approvalRoute, selfId, isAdmin && p.approvalRoute?.route === 'admin'),
  );
}
