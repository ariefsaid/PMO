/**
 * AC-IXD-PROC-W5-3 — Procurement section of the `/approvals` inbox (N6).
 *
 * Lists PRs in `Requested` status that the viewer's REAL role may approve and did
 * NOT raise (SoD-a: requested_by_id !== self, matching the detail screen's
 * `!isRequester` gate). Rows ROUTE to `/procurement/:id` (the reordered decision
 * screen) — they NEVER approve inline (OD-W5-3: a PR approval needs full evidence).
 *
 * Budget remaining per row is intentionally NOT computed here: it would require a
 * budget + committed-spend query PER ROW (hooks-in-a-loop). The full committed-basis
 * budget impact lives on the detail screen's DecisionSupportPanel — this inbox shows
 * the value and a one-line note pointing there (the plan's sanctioned fallback).
 *
 * Strictly DESIGN.md tokens. The DataTable carries row semantics + keyboard activation.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  CardHead,
  DataTable,
  type Column,
} from '@/src/components/ui';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';

/** Whole days since an ISO timestamp (for the "age" cell). */
function daysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return 'today';
  return `${days}d ago`;
}

export const ProcurementApprovalSection: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  const { data, isPending, isError, refetch } = useProcurements();

  // SoD-a: Requested + not raised by me. The role-level can('transition','procurement')
  // gate is applied by the parent (the section only renders for approver roles).
  // pendingProcurementApprovals is the single source of truth for this predicate (H7).
  const rows = useMemo(
    () =>
      pendingProcurementApprovals(data, selfId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [data, selfId],
  );

  const columns: Column<ProcurementWithRefs>[] = [
    {
      key: 'request',
      header: 'Request',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold" title={r.title}>
            {r.title}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {r.code ?? r.id.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: 'project',
      header: 'Project',
      cell: (r) => <span className="text-muted-foreground">{r.project?.name ?? '—'}</span>,
    },
    {
      key: 'requester',
      header: 'Requested by',
      cell: (r) => <span className="truncate">{r.requested_by?.full_name ?? 'Unknown'}</span>,
    },
    {
      key: 'value',
      header: 'Value',
      align: 'num',
      cell: (r) => formatCurrency(r.total_value),
    },
    {
      key: 'age',
      header: 'Age',
      align: 'num',
      cell: (r) => <span className="text-muted-foreground">{daysAgo(r.created_at)}</span>,
    },
  ];

  const state: 'loading' | 'empty' | 'error' | undefined =
    isPending ? 'loading' : isError ? 'error' : rows.length === 0 ? 'empty' : undefined;

  return (
    <Card seam>
      <CardHead className="rounded-t-lg">
        Purchase requests awaiting you ({isPending ? '…' : rows.length})
      </CardHead>
      <DataTable<ProcurementWithRefs>
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={(r) => navigate(`/procurement/${r.id}`)}
        rowLabel={(r) => `Open ${r.title}`}
        state={state}
        className="rounded-t-none border-t-0"
        emptyTitle="No requests awaiting your decision"
        emptySub="Purchase requests that need your approval will appear here."
        errorTitle="Couldn't load purchase requests"
        errorSub="Something went wrong fetching requests awaiting you."
        onRetry={() => refetch()}
      />
      {state === undefined && (
        <p className="border-t border-border bg-card px-3.5 py-2 text-[12px] text-muted-foreground">
          Open a request to see its full budget impact and approve or reject it.
        </p>
      )}
    </Card>
  );
};
