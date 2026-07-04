/**
 * AC-IFW-PROC-01 / AC-IFW-PROC-02
 *
 * Expand-in-place procurement approval row — mirrors the ApprovalsQueue (timesheet)
 * expand pattern. A disclosure button reveals:
 *   • DecisionSupportPanel (budget impact)
 *   • Line items from the procurement detail
 *   • Adjacent Approve / Reject actions (staged through ConfirmDialog)
 *
 * No navigation away from the inbox. `transition_procurement` RPC is the SoD
 * authority; `can('transition','procurement')` is the UX-only gate (ADR-0016).
 */
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApprovalRow,
  Button,
  ConfirmDialog,
  Icon,
  ListState,
  ProjectNameLink,
  StatusPill,
  useToast,
} from '@/src/components/ui';
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
import { workflowVariant } from '@/src/lib/status/statusVariants';

type PendingAction = 'Approved' | 'Rejected';

export interface ProcurementApprovalRowProps {
  row: ProcurementWithRefs;
}

export interface ProcurementApprovalPreviewProps {
  row: ProcurementWithRefs;
  surface?: 'panel' | 'inline';
}

/** Whole days since an ISO timestamp — mirrors ProcurementApprovalSection. */
function daysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return 'today';
  return `${days}d ago`;
}

export const ProcurementApprovalPreview: React.FC<ProcurementApprovalPreviewProps> = ({
  row,
  surface = 'panel',
}) => {
  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detail = useProcurementDetail(row.id);
  const { transition } = useProcurementMutations(row.id);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const canTransition = may('transition', 'procurement');
  const isInline = surface === 'inline';

  const handleConfirm = () => {
    if (!pending) return;
    transition.mutate(
      { to: pending },
      {
        onSuccess: () => {
          setPending(null);
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

  const actionCluster = canTransition ? (
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
  ) : null;

  return (
    <>
      <div className={isInline ? 'space-y-3' : 'flex h-full flex-col'}>
        <div className={isInline ? 'space-y-3' : 'border-b border-border pb-4'}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
                <span>·</span>
                <ProjectNameLink
                  projectId={row.project_id}
                  name={row.project?.name ?? null}
                  className="text-[12px]"
                />
                <span>·</span>
                <span>{daysAgo(row.created_at)}</span>
              </div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">{row.title}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                <span>{row.requested_by?.full_name ?? 'Unknown requester'}</span>
                <span className="tabular font-medium text-foreground">
                  {formatCurrency(row.total_value)}
                </span>
                <StatusPill variant={workflowVariant(row.status)}>{row.status}</StatusPill>
              </div>
            </div>
            {!isInline && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Link
                  to={`/procurement/${row.id}`}
                  aria-label="Open request"
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  Open request
                </Link>
                {actionCluster}
              </div>
            )}
          </div>
          {!isInline && (
            <p className="max-w-[68ch] text-[13px] text-muted-foreground">
              Approval actions remain permission-gated in the UI and server-enforced via the
              procurement transition RPC.
            </p>
          )}
        </div>

        <div className={isInline ? 'space-y-3' : 'min-h-0 flex-1 space-y-4 overflow-y-auto pt-4'}>
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
              <DecisionSupportPanel
                projectId={detail.data.project_id}
                totalValue={detail.data.total_value}
                projectName={detail.data.project?.name}
                status={detail.data.status}
              />

              {detail.data.items.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    Line items
                  </h3>
                  <ul className="space-y-1.5" aria-label="Line items">
                    {detail.data.items.map((item) => {
                      const lineTotal = item.amount ?? item.quantity * item.rate;
                      return (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-[13px]"
                        >
                          <span className="min-w-0 truncate">{item.name}</span>
                          <span className="shrink-0 tabular text-muted-foreground">
                            {item.quantity} × {formatCurrency(item.rate)} ={' '}
                            <span className="font-medium text-foreground">
                              {formatCurrency(lineTotal)}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Request details
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      Requested by
                    </dt>
                    <dd className="mt-1 text-[13px] font-medium">
                      {row.requested_by?.full_name ?? 'Unknown requester'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      Project
                    </dt>
                    <dd className="mt-1 text-[13px] font-medium">
                      {row.project?.name ?? 'No project linked'}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      Requested
                    </dt>
                    <dd className="mt-1 text-[13px] font-medium">{daysAgo(row.created_at)}</dd>
                  </div>
                  <div className="rounded-lg border border-border/70 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                      Total value
                    </dt>
                    <dd className="mt-1 tabular text-[13px] font-medium">
                      {formatCurrency(row.total_value)}
                    </dd>
                  </div>
                </dl>
              </section>
            </>
          ) : null}
        </div>

        {isInline && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Link
              to={`/procurement/${row.id}`}
              aria-label="Open request"
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              Open request
            </Link>
            {actionCluster}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          open
          tone={pending === 'Approved' ? 'default' : 'destructive'}
          title={pending === 'Approved' ? `Approve ${row.title}?` : `Reject ${row.title}?`}
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
    </>
  );
};

export const ProcurementApprovalRow: React.FC<ProcurementApprovalRowProps> = ({ row }) => {
  const panelId = `proc-approval-panel-${useId()}`;
  const [expanded, setExpanded] = useState(false);

  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
      <ProjectNameLink
        projectId={row.project_id}
        name={row.project?.name ?? null}
        className="text-[12px]"
      />
      {row.requested_by?.full_name && <span>{row.requested_by.full_name}</span>}
      <span className="tabular font-medium text-foreground">{formatCurrency(row.total_value)}</span>
      <span>{daysAgo(row.created_at)}</span>
    </span>
  );

  return (
    <div className="border-b border-border last:border-b-0">
      <ApprovalRow
        name={row.title}
        subtitle={subtitle}
        status={<StatusPill variant={workflowVariant(row.status)}>{row.status}</StatusPill>}
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

      {expanded && (
        <div id={panelId} className="mx-3.5 mb-3 rounded-lg border border-border bg-secondary/20 p-3">
          <ProcurementApprovalPreview row={row} surface="inline" />
        </div>
      )}
    </div>
  );
};
