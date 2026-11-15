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
import React, { useEffect, useState } from 'react';
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
import { formatDay, formatNumberExact, formatTableMoney } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { DecisionSupportPanel } from '@/pages/procurement/DecisionSupportPanel';
import { useAuth } from '@/src/auth/useAuth';
import { InlineReturn } from './InlineReturn';
import { ApprovalChainStrip } from './ApprovalChainStrip';
import { procurementApprovalChain } from '@/src/lib/selectors/approvalChain';

type PendingAction = 'Approved' | 'Rejected';

export interface ProcurementApprovalPreviewProps {
  row: ProcurementWithRefs;
  /** `panel` = the desktop decision column; `sheet` = the phone full-screen sheet (title in the sheet header,
   *  Return/Approve fixed at the bottom); `inline` = an embedded card that keeps the Return dialog. */
  surface?: 'panel' | 'inline' | 'sheet';
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
  // A decision started on one request never carries over to the next one opened.
  useEffect(() => { setPending(null); setDecisionError(null); }, [row.id]);

  const canTransition = may('transition', 'procurement');
  const isInline = surface === 'inline';
  const isSheet = surface === 'sheet';
  // Panel and sheet ask for the Return reason in place, beside the evidence; the inline card keeps the dialog.
  const returnsInPlace = !isInline;

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
        className={isSheet ? 'min-h-11 flex-1' : 'max-sm:min-h-11'}
        onClick={() => { setDecisionError(null); setPending('Rejected'); }}
        loading={transition.isPending}
      >
        {t('approvalRow.returnShort', 'Return')}
      </Button>
      <Button
        variant="primary"
        className={isSheet ? 'min-h-11 flex-1' : 'max-sm:min-h-11'}
        onClick={() => { setDecisionError(null); setPending('Approved'); }}
        loading={transition.isPending}
      >
        <Icon name="check" />
        {t('approvalRow.approve', 'Approve')}
      </Button>
    </>
  ) : null;

  const inlineReturn = (bare = false) => (
    <InlineReturn
      bare={bare}
      key={row.id}
      subject={t('approvalRow.rejectSubject', 'purchase request')}
      context={`${row.title} · ${money(row.total_value)}`}
      loading={transition.isPending}
      error={decisionError}
      onConfirm={(reason) => handleConfirm(reason)}
      onCancel={() => { setPending(null); setDecisionError(null); }}
    />
  );

  return (
    <>
      <div className={isInline ? 'space-y-3' : 'flex h-full flex-col'}>
        <div className={isInline ? 'space-y-3' : isSheet ? 'pb-3' : 'border-b border-border pb-4'}>
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
              {!isSheet && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h2 className="min-w-0 text-lg font-semibold tracking-[-0.01em]">{row.title}</h2>
                  {/* Record actions live in the header's action slot, level with the title. */}
                  {!isInline && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Link
                        to={`/procurement/${row.id}`}
                        aria-label={t('approvalRow.open', 'Open procurement')}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 py-1.5 text-control text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring lg:min-h-0"
                      >
                        {t('approvalRow.open', 'Open procurement')}
                      </Link>
                      {pending !== 'Rejected' && actionCluster}
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-control text-muted-foreground">
                <span>{row.requested_by?.full_name ?? t('approvalRow.unknownRequester', 'Unknown requester')}</span>
                <span className="tabular font-medium text-foreground">
                  {money(row.total_value)}
                </span>
                <StatusPill record="procurement" state={row.status} />
                {/* Phone sheet: the way to the full record rides on the facts line, not on a row of its own. */}
                {isSheet && (
                  <Link
                    to={`/procurement/${row.id}`}
                    aria-label={t('approvalRow.open', 'Open procurement')}
                    className="inline-flex min-h-11 items-center text-control font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    {t('approvalRow.open', 'Open procurement')}
                  </Link>
                )}
              </div>
              {/* Who it waits on and how long, from the route and the timeline already read for this item. */}
              {detail.data && <ApprovalChainStrip steps={procurementApprovalChain(detail.data)} className="pt-1" />}
            </div>
          </div>
          {!isSheet && returnsInPlace && pending === 'Rejected' && (
            <div className="mt-3">{inlineReturn()}</div>
          )}
        </div>

        <div className={isInline ? 'space-y-3' : isSheet ? 'space-y-8 pb-24' : 'min-h-0 flex-1 space-y-8 overflow-y-auto pt-4'}>
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
                flush
              />

              {detail.data.items.length > 0 && (
                <section>
                  <h3 className="mb-3 text-control font-semibold text-muted-foreground">
                    {t('approvalRow.lineItems', 'Line items')}
                  </h3>
                  {/* One table, rows flush with the section's left edge; the quantity, rate and total stay on one line. */}
                  <table className="w-full text-control" aria-label={t('approvalRow.lineItems', 'Line items')}>
                    <tbody className="divide-y divide-border">
                      {detail.data.items.map((item) => {
                        const lineTotal = item.amount ?? item.quantity * item.rate;
                        return (
                          <tr key={item.id}>
                            <td className="min-w-0 py-2 pr-3 text-left align-baseline">{item.name}</td>
                            <td className="whitespace-nowrap py-2 text-right align-baseline tabular text-muted-foreground">
                              {/* #2089: the quantity renders in the viewer's locale, grouped. */}
                              {formatNumberExact(item.quantity)} × {money(item.rate)} ={' '}
                              <span className="font-medium text-foreground">{money(lineTotal)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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

        {/* Phone: the decision is fixed at the thumb, with the evidence scrolling above it. */}
        {isSheet && actionCluster && (
          <div
            data-testid="sheet-decision-bar"
            className="sticky bottom-[calc(-1*var(--space-content-inset))] -mx-[var(--space-content-inset)] -mb-[var(--space-content-inset)] mt-4 border-t border-border bg-popover px-[var(--space-content-inset)] pt-3 pb-[calc(var(--space-content-inset)+env(safe-area-inset-bottom))]"
          >
            {pending === 'Rejected' ? inlineReturn(true) : <div className="flex items-center gap-2">{actionCluster}</div>}
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
        open={pending === 'Rejected' && !returnsInPlace}
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

