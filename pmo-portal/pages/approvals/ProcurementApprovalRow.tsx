import { projectDisplayName } from '@/src/lib/projectDisplayName';
/**
 * AC-IFW-PROC-01 / AC-IFW-PROC-02
 *
 * Selected procurement evidence in the unified approvals inbox:
 *   • DecisionSupportPanel (budget impact)
 *   • Line items from the procurement detail
 *   • Adjacent Approve / Reject actions (staged through ConfirmDialog)
 *
 * No navigation away from the inbox. `transition_procurement` RPC is the SoD
 * authority; `can('transition','procurement')` is the UX-only gate (ADR-0016).
 */
import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
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
  selected: boolean;
  onSelect: () => void;
}

export interface ProcurementApprovalPreviewProps {
  row: ProcurementWithRefs;
}

/** Whole days since an ISO timestamp. */
function daysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return 'today';
  return `${days}d ago`;
}

export const ProcurementApprovalPreview: React.FC<ProcurementApprovalPreviewProps> = ({ row }) => {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detail = useProcurementDetail(row.id);
  const { transition } = useProcurementMutations(row.id);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const canTransition = may('transition', 'procurement');

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

  const actionCluster = canTransition && detail.data ? (
    <>
      <Button
        variant="primary"
        size="sm"
        aria-label={`Approve request ${row.title}`}
        className="touch-target"
        onClick={() => setPending('Approved')}
        loading={transition.isPending}
      >
        <Icon name="check" />
        Approve
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Reject request ${row.title}`}
        className="touch-target"
        onClick={() => setPending('Rejected')}
        loading={transition.isPending}
      >
        Reject
      </Button>
    </>
  ) : null;

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="border-b border-border pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
                <span>·</span>
                <ProjectNameLink
                  projectId={row.project_id}
                  name={row.project ? projectDisplayName(row.project) : null}
                  legalName={row.project?.name}
                  className="text-[12px]"
                />
                <span>·</span>
                <span>{daysAgo(row.created_at)}</span>
              </div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">{row.title}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                <span>{row.requested_by?.full_name ?? t('approvals.unknownRequester', 'Unknown requester')}</span>
                <StatusPill variant={workflowVariant(row.status)}>{row.status}</StatusPill>
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">
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
                projectName={detail.data.project ? projectDisplayName(detail.data.project) : undefined}
                projectLegalName={detail.data.project?.name}
                status={detail.data.status}
                currency={detail.data.currency}
                showProjectContext={false}
                showRequestValue={false}
              />

              {detail.data.items.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {t('approvals.lineItems', 'Line items')}
                  </h3>
                  <ul className="space-y-1.5" aria-label="Line items">
                    {detail.data.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-baseline justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-[13px]"
                      >
                        <span className="min-w-0 break-words">{item.name}</span>
                        <span className="shrink-0 tabular text-muted-foreground">
                          {t('approvals.unitRate', '{{quantity}} × {{rate}} per unit', {
                            quantity: item.quantity,
                            rate: formatCurrency(item.rate, row.currency),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3">
                <h3 className="text-[12px] font-semibold text-muted-foreground">
                  {t('approvals.decisionTotal', 'Decision total')}
                </h3>
                <p className="tabular text-base font-semibold text-foreground">
                  {formatCurrency(detail.data.total_value, detail.data.currency)}
                </p>
              </section>
            </>
          ) : null}
        </div>

        <div data-testid="approval-decision-actions" className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Link
            to={`/procurement/${row.id}`}
            aria-label="Open request"
            className="touch-target inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {t('approvals.openRequest', 'Open request')}
          </Link>
          {actionCluster}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          open
          tone={pending === 'Approved' ? 'default' : 'destructive'}
          title={pending === 'Approved' ? `Approve ${row.title}?` : `Reject ${row.title}?`}
          description={
            pending === 'Approved'
              ? `Approve ${row.title} — ${formatCurrency(row.total_value, row.currency)}? This will advance the request to the ordering stage.`
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

export const ProcurementApprovalRow: React.FC<ProcurementApprovalRowProps> = ({ row, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`approval-item-procurement-${row.id}`}
      className={[
        'w-full min-h-11 rounded-lg border px-3 py-3 text-left transition-colors',
        selected ? 'border-foreground/20 bg-secondary/70' : 'border-transparent hover:border-border hover:bg-secondary/40',
      ].join(' ')}
    >
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {t('approvals.group.procurement.title', 'Purchase requests')}
      </div>
      <div className="break-words text-sm font-medium">{row.title}</div>
      <StatusPill variant={workflowVariant(row.status)} className="mt-1">{row.status}</StatusPill>
      <div className="mt-2 font-mono text-xs text-muted-foreground">{row.code ?? row.id.slice(0, 8)}</div>
    </button>
  );
};
