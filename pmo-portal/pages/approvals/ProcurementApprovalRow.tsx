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
import { formatCurrency, formatDate, formatNumberWhole } from '@/src/lib/format';
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
            pending === 'Approved' ? t('work:approvals.requestApproved', 'Request approved') : t('work:approvals.requestRejected', 'Request rejected'),
            pending === 'Approved'
              ? t('work:approvals.requestApprovedDetail', '{{request}} has been approved', { request: row.title })
              : t('work:approvals.requestRejectedDetail', '{{request}} has been rejected', { request: row.title }),
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
        aria-label={t('work:approvals.decision.approveRequest', 'Approve request {{request}}', { request: row.title })}
        className="touch-target"
        onClick={() => setPending('Approved')}
        loading={transition.isPending}
      >
        <Icon name="check" />
        {t('work:approvals.decision.approveRequestLabel', 'Approve request')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={t('work:approvals.decision.rejectRequest', 'Reject request {{request}}', { request: row.title })}
        className="touch-target"
        onClick={() => setPending('Rejected')}
        loading={transition.isPending}
      >
        {t('work:approvals.decision.rejectRequestLabel', 'Reject request')}
      </Button>
    </>
  ) : null;

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="border-b border-border pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span className="break-words">{row.code ?? row.id.slice(0, 8)}</span>
                <span>·</span>
                <ProjectNameLink
                  projectId={row.project_id}
                  name={row.project ? projectDisplayName(row.project) : null}
                  legalName={row.project?.name}
                  className="text-xs font-semibold"
                />
                <span>·</span>
                <span>{formatDate(row.created_at)}</span>
              </div>
              <h2 className="break-words text-xl font-bold">{row.title}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{row.requested_by?.full_name ?? t('approvals.unknownRequester', 'Unknown requester')}</span>
                <StatusPill variant={workflowVariant(row.status)}>{t(`approvals.status.${row.status.toLowerCase()}`, row.status)}</StatusPill>
              </div>
            </div>
          </div>
        </div>

        {detail.data && (
          <section className="mt-4 flex flex-wrap items-baseline justify-between gap-2" aria-label={t('work:approvals.decisionTotal', 'Decision total')}>
            <h3 className="text-xs font-semibold text-muted-foreground">{t('work:approvals.decisionTotal', 'Decision total')} · {row.currency}</h3>
            <p className="text-right text-xl font-bold tabular text-foreground">{formatNumberWhole(detail.data.total_value)}</p>
          </section>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">
          {detail.isPending ? (
            <ListState variant="loading" rows={3} />
          ) : detail.isError ? (
            <ListState
              variant="error"
              title={t('work:approvals.requestLoadError', "Couldn't load request details")}
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
                showCurrency={false}
              />

              {detail.data.items.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xl font-bold text-foreground">
                    {t('work:approvals.lineItems', 'Line items')} · {t('approvals.unitBasis', 'per unit')}
                  </h3>
                  <ul className="space-y-1.5" aria-label="Line items">
                    {detail.data.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-baseline justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 break-words">{item.name}</span>
                        <span className="shrink-0 tabular text-muted-foreground">
                          {t('work:approvals.unitRate', '{{quantity}} × {{rate}}', {
                            quantity: item.quantity,
                            rate: formatNumberWhole(item.rate),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}


            </>
          ) : null}
        </div>

        <div data-testid="approval-decision-actions" className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Link
            to={`/procurement/${row.id}`}
            aria-label={t('work:approvals.openRequest', 'Open request')}
            className="touch-target inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {t('work:approvals.openRequest', 'Open request')}
          </Link>
          {actionCluster}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          open
          tone={pending === 'Approved' ? 'default' : 'destructive'}
          title={pending === 'Approved' ? t('work:approvals.confirmApprove', 'Approve {{request}}?', { request: row.title }) : t('work:approvals.confirmReject', 'Reject {{request}}?', { request: row.title })}
          description={
            pending === 'Approved'
              ? t('work:approvals.confirmApproveBody', 'Approve {{request}} — {{amount}}? This will advance the request to the ordering stage.', { request: row.title, amount: formatCurrency(row.total_value, row.currency) })
              : t('work:approvals.confirmRejectBody', 'Reject {{request}}? The requester will be notified and may revise and resubmit.', { request: row.title })
          }
          confirmLabel={pending === 'Approved' ? t('work:approvals.decision.approveRequestLabel', 'Approve request') : t('work:approvals.decision.rejectRequestLabel', 'Reject request')}
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
      <div className="break-words text-sm font-normal">{row.title}</div>
      <StatusPill variant={workflowVariant(row.status)} className="mt-1">{t(`approvals.status.${row.status.toLowerCase()}`, row.status)}</StatusPill>
      {!selected && (
        <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">{row.currency}</span>
          <span className="tabular font-normal text-foreground">{formatNumberWhole(row.total_value)}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="min-w-0 break-words">{row.project ? projectDisplayName(row.project) : t('approvals.noProjectLinked', 'No project linked')}</span>
        <span aria-hidden="true">·</span>
        <span>{t('work:approvals.waitingSince', 'Waiting since {{date}}', { date: formatDate(row.created_at) })}</span>
      </div>
      <div className="mt-1 break-words font-mono text-xs font-semibold text-muted-foreground">{row.code ?? row.id.slice(0, 8)}</div>
    </button>
  );
};
