import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ListState, ReasonDialog, SelectField, StatusPill, TextField, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { usePoVariations, useSubcontractMutations } from '@/src/hooks/useSubcontract';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';
import type { PoVariationWithLines } from '@/src/lib/db/subcontracts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { matchRefusalReasonKey } from '@/src/lib/procurement/odooOutcome';
import { formatCurrency, formatNumberExact } from '@/src/lib/format';

const DEFAULT_REFUSAL_HEADLINES: Record<string, string> = {
  revision_superseded: 'Revision superseded',
  po_has_submitted_bill: 'Cannot revise billed order',
  revision_not_issued: 'Revision not issued',
  po_not_found: 'Purchase order not found',
  'below-received': 'Quantity below received',
};

const DEFAULT_REFUSAL_DETAILS: Record<string, string> = {
  revision_superseded: 'A newer revision already exists for this purchase order. View the latest revision.',
  po_has_submitted_bill: 'This purchase order has a submitted supplier bill in the ERP and cannot be revised.',
  revision_not_issued: 'This purchase order revision has not been issued yet in PMO.',
  po_not_found: 'The purchase order could not be found.',
  'below-received': 'Ordered quantity cannot be reduced below the quantity already received or billed.',
};

export interface PoVariationsListProps {
  poId: string;
  projectId: string;
  currency: string;
}

export const PoVariationsList: React.FC<PoVariationsListProps> = ({ poId, projectId, currency }) => {
  const { t } = useTranslation('procurement');
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const currentUserId = currentUser?.id;
  const variations = usePoVariations(poId);
  const workOrders = useProjectWorkOrders(projectId);
  const mutations = useSubcontractMutations(poId);
  const [approving, setApproving] = useState<PoVariationWithLines | null>(null);
  const [rejecting, setRejecting] = useState<PoVariationWithLines | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [revisionFor, setRevisionFor] = useState<PoVariationWithLines | null>(null);
  const [pendingPush, setPendingPush] = useState<Record<string, PendingPushState>>({});
  const [linkChoices, setLinkChoices] = useState<Record<string, string>>({});
  const [linkReasons, setLinkReasons] = useState<Record<string, string>>({});
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});

  const fail = (error: unknown) => {
    const rawCode = (error as { message?: string; details?: string })?.details ?? (error as { message?: string })?.message ?? '';
    const refusalKey = matchRefusalReasonKey(rawCode);
    if (refusalKey) {
      const headline = t(`subcontract.variations.refusal.${refusalKey}.headline`, DEFAULT_REFUSAL_HEADLINES[refusalKey]);
      const detail = t(`subcontract.variations.refusal.${refusalKey}.detail`, DEFAULT_REFUSAL_DETAILS[refusalKey]);
      toast(headline, detail, 'warning');
      return `${headline}. ${detail}`;
    }
    const classified = classifyMutationError(error);
    toast(classified.headline, classified.detail, 'warning');
    return classified.detail ? `${classified.headline}. ${classified.detail}` : classified.headline;
  };
  const canLink = may('link', 'poVariation', { currentUserId });
  const workOrderOptions = [
    { value: '', label: t('subcontract.variations.chooseWorkOrder', 'Choose a work order') },
    ...(workOrders.data ?? []).map((order) => ({ value: order.id, label: `${order.wo_number ?? order.title} · ${order.status}` })),
    { value: 'not-passed', label: t('subcontract.variations.notPassed', 'Not passed on') },
  ];

  if (variations.isPending) return <section aria-label={t('subcontract.variations.title', 'Cost variations')}><ListState variant="loading" shape="table" rows={2} /></section>;
  if (variations.isError) return <section aria-label={t('subcontract.variations.title', 'Cost variations')}>
    <ListState variant="error" title={t('subcontract.variations.loadError', 'Could not load cost variations.')}
      onRetry={() => void variations.refetch()} retryLabel={t('subcontract.lines.retry', 'Retry')} />
  </section>;
  const rows = variations.data ?? [];

  const decide = async (variation: PoVariationWithLines, approve: boolean, notes?: string) => {
    setDecisionError(null);
    try {
      await mutations.decideVariation.mutateAsync({ id: variation.id, approve, ...(notes ? { notes } : {}) });
      toast(approve ? t('subcontract.variations.approved', 'Variation approved') : t('subcontract.variations.rejected', 'Variation rejected'), undefined, 'success');
      setApproving(null);
      setRejecting(null);
    } catch (error) { setDecisionError(fail(error)); }
  };

  const issueRevision = async (variation: PoVariationWithLines) => {
    try {
      await mutations.issueRevision.mutateAsync(variation.id);
      toast(t('subcontract.variations.revised', 'PO revision issued'), undefined, 'success');
    } catch (error) {
      if ((error as { details?: unknown } | null)?.details === 'erp_revise_pending') {
        const headline = t('subcontract.variations.reviseNotSentHeadline', 'Not sent: the ERP revision route is not available yet');
        const detail = t('subcontract.variations.reviseNotSentDetail', 'The approved variation remains in PMO. No purchase order revision was issued.');
        setPendingPush((state) => ({ ...state, [variation.id]: { status: 'not-sent', error: { headline, detail } } }));
      } else {
        const rawCode = (error as { message?: string; details?: string })?.details ?? (error as { message?: string })?.message ?? '';
        const refusalKey = matchRefusalReasonKey(rawCode);
        if (refusalKey) {
          const headline = t(`subcontract.variations.refusal.${refusalKey}.headline`, DEFAULT_REFUSAL_HEADLINES[refusalKey]);
          const detail = t(`subcontract.variations.refusal.${refusalKey}.detail`, DEFAULT_REFUSAL_DETAILS[refusalKey]);
          toast(headline, detail, 'warning');
          setPendingPush((state) => ({ ...state, [variation.id]: { status: 'push-failed', error: { headline, detail } } }));
        } else {
          fail(error);
        }
      }
    }
  };

  const saveLink = async (variation: PoVariationWithLines) => {
    const choice = linkChoices[variation.id] ?? variation.work_order_id ?? (variation.not_passed_reason ? 'not-passed' : '');
    const reason = (linkReasons[variation.id] ?? variation.not_passed_reason ?? '').trim();
    if (!choice) return;
    if (choice === 'not-passed' && !reason) {
      setLinkErrors((state) => ({ ...state, [variation.id]: t('subcontract.variations.notPassedRequired', 'Give a reason this variation was not passed on.') }));
      return;
    }
    setLinkErrors((state) => ({ ...state, [variation.id]: '' }));
    try {
      await mutations.linkVariation.mutateAsync({ variationId: variation.id, workOrderId: choice === 'not-passed' ? null : choice, reason: choice === 'not-passed' ? reason : null });
      toast(t('subcontract.variations.linked', 'Variation link saved'), undefined, 'success');
    } catch (error) { fail(error); }
  };

  return <section aria-label={t('subcontract.variations.title', 'Cost variations')} className="flex flex-col gap-2" data-testid="po-variations">
    <h3 className="text-sm font-semibold text-muted-foreground">{t('subcontract.variations.title', 'Cost variations')}</h3>
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('subcontract.variations.empty', 'No cost variations requested')}</p>
      : <ul className="flex flex-col gap-2">
        {rows.map((variation) => {
          const isRequester = variation.requested_by === currentUserId;
          const isApprover = variation.approved_by === currentUserId;
          const canDecide = variation.status === 'Requested' && !isRequester && may('decide', 'poVariation', { currentUserId });
          const canIssue = variation.status === 'Approved' && !isApprover && may('revise', 'poVariation', { currentUserId });
          const selection = linkChoices[variation.id] ?? variation.work_order_id ?? (variation.not_passed_reason ? 'not-passed' : '');
          const notPassed = selection === 'not-passed';
          return <li key={variation.id} data-testid={`po-variation-${variation.id}`} className="flex flex-col gap-2 rounded-md border border-border p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">{variation.number}</span>
              <StatusPill record="costVariation" state={variation.status} />
              <span className="tabular-nums">{formatCurrency(Number(variation.amount), currency)}</span>
              <span className="text-muted-foreground">{variation.origin === 'post_work'
                ? t('subcontract.variations.postWork', 'Post-work') : t('subcontract.variations.preWork', 'Pre-work')}</span>
              <span className="text-muted-foreground">{variation.reason}</span>
              {pendingPush[variation.id] && <TaskPushBadge state={pendingPush[variation.id]} />}
            </div>
            {variation.lines.length > 0 && <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {variation.lines.map((line) => <li key={line.boq_item_id}>{formatNumberExact(Number(line.additional_quantity))} × {formatCurrency(Number(line.rate), currency)}</li>)}
            </ul>}
            <div className="flex flex-wrap gap-2">
              {canDecide && <>
                <Button variant="outline" size="sm" onClick={() => { setDecisionError(null); setRejecting(variation); }}>{t('subcontract.variations.reject', 'Reject')}</Button>
                <Button variant="primary" size="sm" onClick={() => { setDecisionError(null); setApproving(variation); }}>{t('subcontract.variations.approve', 'Approve')}</Button>
              </>}
              {canIssue && <Button variant="outline" size="sm" onClick={() => setRevisionFor(variation)} disabled={mutations.issueRevision.isPending}>
                {t('subcontract.variations.issueRevision', 'Issue revision')}
              </Button>}
            </div>
            {canLink ? <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
              <div className="min-w-56 flex-1">
                <SelectField id={`variation-link-${variation.id}`} label={t('subcontract.variations.linkLabel', 'Client work order')}
                  value={selection} onChange={(value) => setLinkChoices((state) => ({ ...state, [variation.id]: value }))}
                  options={workOrderOptions} disabled={workOrders.isPending || workOrders.isError} />
              </div>
              {notPassed && <div className="min-w-56 flex-1">
                <TextField id={`variation-not-passed-${variation.id}`} label={t('subcontract.variations.notPassedReason', 'Reason not passed on')}
                  value={linkReasons[variation.id] ?? variation.not_passed_reason ?? ''}
                  onChange={(value) => setLinkReasons((state) => ({ ...state, [variation.id]: value }))}
                  required error={linkErrors[variation.id]} />
              </div>}
              <Button variant="outline" size="sm" onClick={() => void saveLink(variation)} disabled={!selection || mutations.linkVariation.isPending}>
                {t('subcontract.variations.saveLink', 'Save link')}
              </Button>
              {workOrders.isPending && <span role="status" className="text-sm text-muted-foreground">{t('subcontract.variations.workOrdersLoading', 'Loading project work orders…')}</span>}
              {workOrders.isError && <span role="alert" className="text-sm text-warning-foreground">{t('subcontract.variations.workOrdersLoadError', 'Project work orders could not be loaded.')}</span>}
            </div> : <p className="text-sm text-muted-foreground">
              {variation.work_order_id ? t('subcontract.variations.linkedReadOnly', 'Linked to a client work order') : variation.not_passed_reason
                ? t('subcontract.variations.notPassedReadOnly', 'Not passed on: {{reason}}', { reason: variation.not_passed_reason }) : ''}
            </p>}
          </li>;
        })}
      </ul>}
    <ConfirmDialog open={approving !== null} title={t('subcontract.variations.approveTitle', 'Approve this variation?')}
      description={t('subcontract.variations.approveBody', 'Approval increases the purchase commitment by this amount.')}
      confirmLabel={t('subcontract.variations.approve', 'Approve')}
      loading={mutations.decideVariation.isPending}
      error={decisionError}
      onCancel={() => { setApproving(null); setDecisionError(null); }}
      onConfirm={async () => { if (approving) await decide(approving, true); }} />
    <ReasonDialog open={rejecting !== null} kind="reject" subject={rejecting?.number ?? undefined}
      context={rejecting ? `${rejecting.number} · ${formatCurrency(Number(rejecting.amount), currency)}` : undefined}
      loading={mutations.decideVariation.isPending}
      error={decisionError}
      onCancel={() => { setRejecting(null); setDecisionError(null); }}
      onConfirm={async (reason) => { if (rejecting) await decide(rejecting, false, reason); }} />
    <ConfirmDialog open={Boolean(revisionFor)} title={t('subcontract.variations.reviseTitle', 'Issue a new PO revision?')}
      description={t('subcontract.variations.reviseBody', 'This applies the approved quantity change to the purchase order.')}
      confirmLabel={t('subcontract.variations.issueRevision', 'Issue revision')}
      loading={mutations.issueRevision.isPending} onCancel={() => setRevisionFor(null)}
      onConfirm={() => {
        if (!revisionFor) return;
        const target = revisionFor;
        setRevisionFor(null);
        void issueRevision(target);
      }} />
  </section>;
};
