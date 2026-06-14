/**
 * AC-IFW-PROC-01 — Procurement section of the `/approvals` inbox.
 *
 * Replaces the navigate-only DataTable with expand-in-place rows
 * (`ProcurementApprovalRow`), closing the Lens-D asymmetry with the
 * timesheet queue. Each row expands to show budget impact + line items and
 * surfaces Approve/Reject adjacent — no navigation away from the inbox.
 *
 * SoD-a filter (`pendingProcurementApprovals`: Requested + not raised by me)
 * and the loading/empty/error states are unchanged.
 * `useNavigate` is intentionally removed — the asymmetry is gone.
 *
 * Strictly DESIGN.md tokens.
 */
import React, { useMemo } from 'react';
import {
  Card,
  CardHead,
  ListState,
} from '@/src/components/ui';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useAuth } from '@/src/auth/useAuth';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { ProcurementApprovalRow } from './ProcurementApprovalRow';

export const ProcurementApprovalSection: React.FC = () => {
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  const { data, isPending, isError, refetch } = useProcurements();

  // SoD-a: Requested + not raised by me (H7 — single source of truth).
  const rows = useMemo(
    () =>
      pendingProcurementApprovals(data, selfId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [data, selfId],
  );

  const countLabel = isPending ? '…' : String(rows.length);

  return (
    <Card seam>
      <CardHead className="rounded-t-lg">
        Purchase requests awaiting you ({countLabel})
      </CardHead>

      {isPending && (
        <ListState
          variant="loading"
          rows={3}
          className="rounded-b-lg"
        />
      )}

      {!isPending && isError && (
        <ListState
          variant="error"
          title="Couldn't load purchase requests"
          sub="Something went wrong fetching requests awaiting you."
          onRetry={() => refetch()}
          className="rounded-b-lg"
        />
      )}

      {!isPending && !isError && rows.length === 0 && (
        <ListState
          variant="empty"
          icon="inbox"
          title="No requests awaiting your decision"
          sub="Purchase requests that need your approval will appear here."
          className="rounded-b-lg"
        />
      )}

      {!isPending && !isError && rows.length > 0 && (
        <div className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map((row: ProcurementWithRefs) => (
            <ProcurementApprovalRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </Card>
  );
};
