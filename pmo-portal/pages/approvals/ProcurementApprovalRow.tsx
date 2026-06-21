/**
 * AC-IFW-PROC-01 / AC-IFW-PROC-02
 *
 * Expand-in-place procurement approval row — mirrors the ApprovalsQueue (timesheet)
 * expand pattern. A disclosure button reveals:
 *   • DecisionSupportPanel (budget impact — lazy, enabled only when expanded)
 *   • Line items from the procurement detail
 *   • Adjacent Approve / Reject actions (staged through ConfirmDialog)
 *
 * No navigation away from the inbox. `transition_procurement` RPC is the SoD
 * authority; `can('transition','procurement')` is the UX-only gate (ADR-0016).
 */
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApprovalRow, Button, ConfirmDialog, Icon, ListState, ProjectNameLink, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import {
  useProcurementDetail,
  useProcurementMutations,
} from '@/src/hooks/useProcurementDetail';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatCurrency } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { DecisionSupportPanel } from '@/pages/procurement/DecisionSupportPanel';
import { useAuth } from '@/src/auth/useAuth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PendingAction = 'Approved' | 'Rejected';

export interface ProcurementApprovalRowProps {
  row: ProcurementWithRefs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whole days since an ISO timestamp — mirrors ProcurementApprovalSection. */
function daysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return 'today';
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ProcurementApprovalRow: React.FC<ProcurementApprovalRowProps> = ({ row }) => {
  const panelId = `proc-approval-panel-${useId()}`;
  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  // Lazy fetch: only enabled when the row is expanded (cost-free while collapsed).
  const detail = useProcurementDetail(expanded ? row.id : undefined);
  const { transition } = useProcurementMutations(row.id);

  const canTransition = may('transition', 'procurement');

  const handleConfirm = () => {
    if (!pending) return;
    transition.mutate(
      { to: pending },
      {
        onSuccess: () => {
          setPending(null);
          // Invalidate list so this row leaves the inbox after approval/rejection.
          queryClient.invalidateQueries({ queryKey: ['procurements', currentUser?.org_id] });
          toast(
            pending === 'Approved' ? 'Request approved' : 'Request rejected',
            pending === 'Approved'
              ? `${row.title} has been approved`
              : `${row.title} has been rejected`,
            'success',
          );
        },
        onError: (err) => {
          setPending(null);
          const { headline, detail: errDetail } = classifyMutationError(err);
          toast(headline, errDetail, 'warning');
        },
      },
    );
  };

  // ---------------------------------------------------------------------------
  // Collapsed row header — rendered through the shared ApprovalRow shell (B,
  // AC-JR-W3B-03) so padding/gap/vertical-alignment + avatar match the timesheet
  // rows. Switching the scope tab no longer shifts row metrics.
  // ---------------------------------------------------------------------------

  // B: subtitle node — request meta in the same text-[12px] style as the timesheet
  // "week · hours h" subtitle. Uses the same slot so the layout is identical.
  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
      <ProjectNameLink
        projectId={row.project_id}
        name={row.project?.name ?? null}
        className="text-[12px]"
      />
      {row.requested_by?.full_name && <span>{row.requested_by.full_name}</span>}
      <span className="tabular font-medium text-foreground">
        {formatCurrency(row.total_value)}
      </span>
      <span>{daysAgo(row.created_at)}</span>
    </span>
  );

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Row summary rendered through the shared ApprovalRow shell.
          AC-ROWCLICK-PROC-APPROVAL: whole-row click TOGGLES the in-place expand
          (the IF-A "decide without leaving the queue" flow) — it never navigates.
          The chevron, ProjectNameLink and (in the panel) action buttons / "Open
          request" are interactive and excluded by the shell's closest() guard. */}
      <ApprovalRow
        name={row.title}
        subtitle={subtitle}
        onActivate={() => setExpanded((v) => !v)}
        disclosure={
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`Show budget impact for ${row.title}`}
            onClick={() => setExpanded((v) => !v)}
            className={
              expanded
                ? '[&_svg]:rotate-90 [&_svg]:transition-transform'
                : '[&_svg]:transition-transform'
            }
          >
            <Icon name="chev" />
          </Button>
        }
        className="border-b-0 px-4"
      />

      {/* Expanded panel */}
      {expanded && (
        <div
          id={panelId}
          className="mx-3.5 mb-3 rounded-lg border border-border bg-secondary/20 p-3"
        >
          {detail.isPending ? (
            <ListState variant="loading" rows={3} />
          ) : detail.isError ? (
            <ListState
              variant="error"
              title="Couldn't load request details"
              sub="Something went wrong fetching the budget impact and line items."
              onRetry={() => detail.refetch()}
            />
          ) : detail.data ? (
            <>
              {/* Budget impact */}
              <DecisionSupportPanel
                projectId={detail.data.project_id}
                totalValue={detail.data.total_value}
                projectName={detail.data.project?.name}
                status={detail.data.status}
              />

              {/* Line items */}
              {detail.data.items.length > 0 && (
                <div className="mb-3">
                  <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    Line items
                  </h4>
                  <ul className="space-y-1" aria-label="Line items">
                    {detail.data.items.map((item) => {
                      const lineTotal = item.amount ?? item.quantity * item.rate;
                      return (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-2 text-[13px]"
                        >
                          <span className="truncate">{item.name}</span>
                          <span className="tabular text-muted-foreground shrink-0">
                            {item.quantity} × {formatCurrency(item.rate)} ={' '}
                            <span className="font-medium text-foreground">
                              {formatCurrency(lineTotal)}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Action footer — "Open request" always visible; Approve/Reject UX-gated by
                  can('transition','procurement') (AC-JR-W2-02). */}
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <Link
                  to={`/procurement/${row.id}`}
                  aria-label="Open request"
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  Open request
                </Link>
                {canTransition && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setPending('Approved')}
                      loading={transition.isPending}
                    >
                      <Icon name="check" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPending('Rejected')}
                      loading={transition.isPending}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Staged confirmation — one click never approves (mirrors ApprovalsQueue T2/T3). */}
      {pending && (
        <ConfirmDialog
          open
          tone={pending === 'Approved' ? 'default' : 'destructive'}
          title={
            pending === 'Approved'
              ? `Approve ${row.title}?`
              : `Reject ${row.title}?`
          }
          description={
            pending === 'Approved'
              ? `Approve ${row.title} — ${formatCurrency(row.total_value)}? This will advance the request to the ordering stage.`
              : `Reject ${row.title}? The requester will be notified and may revise and resubmit.`
          }
          confirmLabel={pending === 'Approved' ? 'Approve' : 'Reject request'}
          loading={transition.isPending}
          onCancel={() => setPending(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
};
