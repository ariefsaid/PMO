import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

/**
 * The pending-procurement-approval predicate, hoisted to ONE place (Wave-6 H7).
 * A PR is awaiting the viewer's decision when it is `Requested` AND was NOT raised
 * by the viewer (SoD-a: approver != author — the same guard the detail screen's
 * `!isRequester` enforces, and the server enforces in 0018). UX-only; RLS is the
 * authority. Returns a new array (never mutates input); tolerant of null/undefined.
 */
export function pendingProcurementApprovals(
  list: ProcurementWithRefs[] | null | undefined,
  selfId: string | null | undefined,
): ProcurementWithRefs[] {
  return (list ?? []).filter(
    (p) => p.status === 'Requested' && p.requested_by_id !== selfId,
  );
}
