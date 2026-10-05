import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { mayDecideRoutedApproval } from '@/src/lib/procurement/approvalRoute';

/**
 * The pending-procurement-approval predicate, hoisted to ONE place (Wave-6 H7).
 * A PR is awaiting the viewer's decision when it is `Requested`, was NOT raised by the viewer (SoD-a),
 * and — #803 — its approval route is flat/unread or names the viewer. Admin break-glass is deliberately
 * NOT applied here: a request routed to named people is not "awaiting" an Admin (DD-APR-5); the Admin
 * still decides it from the request page. UX-only; transition_procurement is the authority.
 * Returns a new array (never mutates input); tolerant of null/undefined.
 */
export function pendingProcurementApprovals(
  list: ProcurementWithRefs[] | null | undefined,
  selfId: string | null | undefined,
): ProcurementWithRefs[] {
  return (list ?? []).filter(
    (p) =>
      p.status === 'Requested' &&
      p.requested_by_id !== selfId &&
      mayDecideRoutedApproval(p.approvalRoute, selfId, false),
  );
}
