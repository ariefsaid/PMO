import { projectDisplayName } from '@/src/lib/projectDisplayName';
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
import React, { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmDialog,
  Icon,
  ListState,
  ProjectNameLink,
  ReasonDialog,
  StatusPill,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import {
  useProcurementDetail,
  useProcurementMutations,
} from '@/src/hooks/useProcurementDetail';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatDay, formatTableMoney } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { DecisionSupportPanel } from '@/pages/procurement/DecisionSupportPanel';
import { useAuth } from '@/src/auth/useAuth';

type PendingAction = 'Approved' | 'Rejected';

export interface ProcurementApprovalPreviewProps {
  row: ProcurementWithRefs;
  surface?: 'panel' | 'inline';
}

export const ProcurementApprovalPreview: React.FC<ProcurementApprovalPreviewProps> = ({
  row,
  surface = 'panel',
}) => {
  const { t } = useTranslation('procurement');
  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detail = useProcurementDetail(row.id);
  const { transition } = useProcurementMutations(row.id);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const canTransition = may('transition', 'procurement');
  const isInline = surface === 'inline';

  const money = (amount: number) => formatTableMoney(amount, row.currency) ?? '—';

  const handleConfirm = async (reason?: string) => {
    if (!pending) return;
    const action = pending;
    setDecisionError(null);
    try {
      await transition.mutateAsync(
        { to: action, ...(action === 'Rejected' ? { notes: (reason ?? '').trim() } : {}) },
      );
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ['procurements', currentUser?.org_id] });
      toast(
        action === 'Approved'
          ? t('approvalRow.approved', 'Procurement approved')
          : t('approvalRow.returned', 'Procurement returned'),
        action === 'Approved'
          ? t('approvalRow.approvedDetail', '{{title}} has been approved', { title: row.title })
          : t('approvalRow.returnedDetail', '{{title}} has been returned', { title: row.title }),
        'success',
      );
    } catch (err) {
      const { headline, detail: errDetail } = classifyMutationError(err);
      setDecisionError(errDetail ? `${headline}. ${errDetail}` : headline);
      toast(headline, errDetail, 'warning');
    }
  };

  const actionCluster = canTransition ? (
    <>
      <Button
        variant="outline"
        className="max-sm:min-h-11"
        onClick={() => { setDecisionError(null); setPending('Rejected'); }}
        loading={transition.isPending}
      >
        {t('approvalRow.returnShort', 'Return')}
      </Button>
      <Button
        variant="primary"
        className="max-sm:min-h-11"
        onClick={() => { setDecisionError(null); setPending('Approved'); }}
        loading={transition.isPending}
      >
        <Icon name="check" />
        {t('approvalRow.approve', 'Approve')}
      </Button>
    </>
  ) : null;

  return (
    <>
      <div className={isInline ? 'space-y-3' : 'flex h-full flex-col'}>
        {/* Phone: the title and the decision stay in view while the evidence scrolls. */}
        <div className={isInline ? 'space-y-3' : 'border-b border-border bg-background pb-4 max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:pt-2'}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-control text-muted-foreground">
                <span className="font-mono">{row.code ?? row.id.slice(0, 8)}</span>
                <span>·</span>
                <ProjectNameLink
                  projectId={row.project_id}
                  name={row.project ? projectDisplayName(row.project) : null}
                  legalName={row.project?.name}
                  className="text-control"
                />
                <span>·</span>
                <span>{formatDay(row.created_at)}</span>
              </div>
              <h2 className="text-lg font-semibold tracking-[-0.01em]">{row.title}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-control text-muted-foreground">
                <span>{row.requested_by?.full_name ?? t('approvalRow.unknownRequester', 'Unknown requester')}</span>
                <span className="tabular font-medium text-foreground">
                  {money(row.total_value)}
                </span>
                <StatusPill record="procurement" state={row.status} />
              </div>
            </div>
            {!isInline && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Link
                  to={`/procurement/${row.id}`}
                  aria-label={t('approvalRow.open', 'Open procurement')}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-control text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  {t('approvalRow.open', 'Open procurement')}
                </Link>
                {actionCluster}
              </div>
            )}
          </div>
        </div>

        <div className={isInline ? 'space-y-3' : 'min-h-0 flex-1 space-y-4 overflow-y-auto pt-4'}>
          {detail.isPending ? (
            <ListState variant="loading" rows={3} />
          ) : detail.isError ? (
            <ListState
              variant="error"
              title={t('approvalRow.loadError', "Couldn't load procurement details")}
              sub={t('approvalRow.loadErrorSub', 'Something went wrong fetching the budget impact and line items.')}
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
              />

              {detail.data.items.length > 0 && (
                <section>
                  <h3 className="mb-2 text-control font-semibold text-muted-foreground">
                    {t('approvalRow.lineItems', 'Line items')}
                  </h3>
                  <ul className="space-y-1.5" aria-label={t('approvalRow.lineItems', 'Line items')}>
                    {detail.data.items.map((item) => {
                      const lineTotal = item.amount ?? item.quantity * item.rate;
                      return (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-control"
                        >
                          <span className="min-w-0 truncate">{item.name}</span>
                          <span className="shrink-0 tabular text-muted-foreground">
                            {item.quantity} × {money(item.rate)} ={' '}
                            <span className="font-medium text-foreground">
                              {money(lineTotal)}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

            </>
          ) : null}
        </div>

        {isInline && (
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Link
              to={`/procurement/${row.id}`}
              aria-label={t('approvalRow.open', 'Open procurement')}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-control text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {t('approvalRow.open', 'Open procurement')}
            </Link>
            {actionCluster}
          </div>
        )}
      </div>

      {pending === 'Approved' && (
        <ConfirmDialog
          open
          title={t('approvalRow.approveTitle', 'Approve {{title}}?', { title: row.title })}
          description={t('approvalRow.approveDescription', 'Approve {{title}} ({{amount}})? This will advance the procurement to the ordering stage.', {
            title: row.title,
            amount: money(row.total_value),
          })}
          confirmLabel={t('approvalRow.approve', 'Approve')}
          loading={transition.isPending}
          error={decisionError}
          onCancel={() => { setPending(null); setDecisionError(null); }}
          onConfirm={() => handleConfirm()}
        />
      )}
      {/* The one Return dialog. A refused purchase can be revised and resubmitted, so it reads "Return"; the stored state and the transition payload stay "Rejected". */}
      <ReasonDialog
        open={pending === 'Rejected'}
        kind="return"
        subject={t('approvalRow.rejectSubject', 'purchase request')}
        context={`${row.title} · ${money(row.total_value)}`}
        loading={transition.isPending}
        error={decisionError}
        onConfirm={(reason) => handleConfirm(reason)}
        onCancel={() => { setPending(null); setDecisionError(null); }}
      />
    </>
  );
};

