import { ReturnedBanner } from '@/src/components/ui/ReturnedBanner';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordHeader, RecordStack, type PageStat, StatusPill, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectChoices } from './expenses/useProjectChoices';
import {
  useExpenseAdvanceOutstanding, useExpenseClaim, useExpenseClaimLines, useExpenseClaimMutations, useExpenseClaimRoute,
} from '@/src/hooks/useExpenseClaims';
import { availableExpenseActions, settlementPreview } from '@/src/lib/expenses/expenseRules';
import { approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency, formatDay } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { statusLabel } from '@/src/lib/status/statusMap';
import { ExpenseDecisionBar } from './expenses/ExpenseDecisionBar';
import { ExpenseLinesCard } from './expenses/ExpenseLinesCard';
import { ExpenseReceiptsCard } from './expenses/ExpenseReceiptsCard';
import { ExpensePostingNote, ExpensePostingsCard } from './expenses/ExpensePostingsCard';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel } from './expenses/expenseLabels';

/** `/expenses/:claimId` (FR-EXP-063..065). Shows only the actions the server would allow; the RPCs decide. */
const ExpenseClaimDetail: React.FC = () => {
  const { t } = useTranslation();
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const query = useExpenseClaim(claimId);
  const claim = query.data ?? null;
  const linesQuery = useExpenseClaimLines(claimId);
  const routeQuery = useExpenseClaimRoute(claimId, claim?.status);
  const outstandingQuery = useExpenseAdvanceOutstanding(claim?.kind === 'advance' ? claim.id : claim?.advance_id ?? null);
  const { update, transition } = useExpenseClaimMutations();
  const { toast } = useToast();
  const projectChoices = useProjectChoices();
  const ownAdvances = useOwnAdvanceOptions(claim?.advance_id ?? null);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const backLabel = t('expenses.detail.back', 'Expenses');
  const goBack = () => navigate('/expenses');

  if (query.isPending) {
    return (<><BackBar label={backLabel} phoneOnly onBack={goBack} /><ListState variant="loading" rows={5} /></>);
  }
  if (query.isError) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <ListState variant="error" title={t('expenses.detail.errorTitle', "Couldn't load this record")}
          sub={t('expenses.detail.errorSub', 'Something went wrong fetching it. Try again.')} onRetry={() => void query.refetch()} />
      </>
    );
  }
  if (!claim) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <ListState variant="empty" icon="doc" title={t('expenses.detail.notFoundTitle', 'Not found')}
          sub={t('expenses.detail.notFoundSub', "It doesn't exist, or it isn't yours and you don't approve spend.")} />
      </>
    );
  }

  const route = routeQuery.data ?? null;
  const outstanding = outstandingQuery.isError ? null : outstandingQuery.data ?? null;
  const allActions = availableExpenseActions({
    claim, userId, realRole, route, advanceOutstanding: claim.kind === 'advance' ? outstanding : null,
    // DD-IMP-7: the float's custodian (null when this float is not visible to the viewer: the ordinary rule shows, the RPC decides).
    floatCustodianId: claim.imprest_float_id ? claim.float?.custodian_id ?? null : null,
  });
  const actions = allActions;
  const canEdit = may('edit', 'expenseClaim', { currentUserId: userId, record: { claimant_id: claim.claimant_id, status: claim.status } });
  const showRouteNote = claim.status === 'Submitted' && route !== null && route.route !== 'flat'
    && claim.claimant_id !== userId && !actions.includes('approve');
  const amount = Number(claim.amount);
  const paidSplit = settlementPreview(amount, Number(claim.advance_applied));
  const hasReturnDetails = claim.status === 'Rejected' || (claim.status === 'Draft' && !!(claim.rejected_at || claim.rejection_notes || claim.rejected_by));
  const canReopenFromBanner = claim.status === 'Rejected' && actions.includes('reopen');
  const reopenForEditing = async () => {
    try {
      await transition.mutateAsync({ id: claim.id, to: 'Draft' });
      toast(t('expenses.toast.reopened', 'Back to Draft'), claim.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };
  const returnedToastLabel = statusLabel('expense', 'Rejected', t);
  // The record's one finding, under the title: where the claim is and who has it next (from fields and the route the page already reads).
  const lineCount = linesQuery.data?.length ?? 0;
  const approverNames = route && route.route !== 'admin' && route.approvers.length > 0
    ? route.approvers.map((a) => a.fullName).join(t('expenseClaims:detail.statusLine.joiner', ' or ')) : null;
  const statusLine = claim.status === 'Draft' && !hasReturnDetails
    ? (claim.kind === 'claim' ? t('expenseClaims:detail.statusLine.draft', { defaultValue: 'Not sent yet · {{count}} lines', count: lineCount }) : t('expenseClaims:detail.statusLine.draftAdvance', 'Not sent yet'))
    : claim.status === 'Submitted' && claim.submitted_at
      ? approverNames
        ? t('expenseClaims:detail.statusLine.with', { defaultValue: 'With {{names}} since {{date}} · lines locked', names: approverNames, date: formatDay(claim.submitted_at) })
        : t('expenseClaims:detail.statusLine.waiting', { defaultValue: 'Waiting for approval since {{date}} · lines locked', date: formatDay(claim.submitted_at) })
      : claim.status === 'Approved' && claim.approved_at
        ? t('expenseClaims:detail.statusLine.approved', { defaultValue: 'Approved {{date}} · waiting for payment', date: formatDay(claim.approved_at) })
        : claim.status === 'Paid' && (claim.paid_on ?? claim.paid_at)
          ? t('expenseClaims:detail.statusLine.paid', { defaultValue: 'Paid {{date}}', date: formatDay((claim.paid_on ?? claim.paid_at) as string) })
          : null;
  const menuItems = [
    ...(canEdit ? [{ key: 'edit', label: t('expenses.detail.editDetails', 'Edit details'), onSelect: () => setEditOpen(true) }] : []),
    ...(actions.includes('cancel') ? [{
      key: 'cancel', danger: true, onSelect: () => setCancelOpen(true),
      label: claim.kind === 'claim' ? t('expenseClaims:actions.cancelClaim', 'Cancel claim') : t('expenses.actions.cancel', 'Cancel'),
    }] : []),
  ];
  const money = (v: number) => formatCurrency(v, claim.currency, { precision: 'minor' });
  // Facts that no other part of the screen states. A claim's amount is its Lines total, so only an advance (no lines) shows it here.
  const stats: PageStat[] = [
    ...(claim.kind === 'advance' ? [{ label: t('expenses.detail.amount', 'Amount'), value: <span data-testid="expense-amount">{money(amount)}</span> }] : []),
    ...(claim.kind === 'claim' && claim.status === 'Paid' ? [
      { label: t('expenses.detail.advanceApplied', 'Advance applied'), value: money(paidSplit.applied) },
      { label: t('expenses.detail.cashPaid', 'Cash paid'), value: money(paidSplit.cash) },
    ] : []),
    ...(claim.kind === 'advance' && claim.status === 'Paid' ? [{ label: t('expenses.detail.outstanding', 'Outstanding'), value: outstanding === null ? '—' : money(outstanding) }] : []),
    ...(claim.payment_reference ? [{ label: t('expenses.detail.reference', 'Payment reference'), value: claim.payment_reference }] : []),
  ];

  return (
    // Phone: the sticky action bar covers the page's foot, so the page reserves its height (published by the bar).
    <div className="max-sm:pb-[var(--mobile-action-bar-height,0px)]">
      <div className="hidden max-[920px]:block"><BackBar label={backLabel} onBack={goBack} /></div>
      <RecordHeader
        panelInset
        actionsOnTitleRow
        name={claim.title}
        status={
          <span data-testid="expense-status" data-status={claim.status}>
            <StatusPill record="expense" state={claim.status} />
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {claim.claim_number && <span>{claim.claim_number}</span>}
            <span>{expenseKindLabel(claim.kind, t)}</span>
            <span>{claim.claimant?.full_name ?? '—'}</span>
            {claim.project_id ? (
              <Link to={`/projects/${claim.project_id}`} className="text-primary-text hover:underline" title={claim.project?.name}>{claim.project ? projectDisplayName(claim.project) : '—'}</Link>
            ) : (
              <span>{t('expenses.overhead', 'Overhead')}</span>
            )}
            {claim.budget_category && <span>{budgetCategoryLabel(claim.budget_category, t)}</span>}
          </span>
        }
        stats={stats}
        actions={<ExpenseDecisionBar claim={claim} actions={actions} advanceOutstanding={outstanding} hideReopen={canReopenFromBanner} returnedToastLabel={returnedToastLabel}
          cancelOpen={cancelOpen} onCancelOpenChange={setCancelOpen} />}
        menuItems={menuItems.length > 0 ? menuItems : undefined}
      >
        {statusLine && <p data-testid="expense-status-line" className="font-medium text-foreground">{statusLine}</p>}
        {claim.advance_id && (
          <p>
            <Link to={`/expenses/${claim.advance_id}`} className="text-primary-text hover:underline">
              {t('expenses.detail.linkedAdvance', 'Settles a cash advance')}
            </Link>
          </p>
        )}
        {claim.purpose && <p className="text-foreground">{claim.purpose}</p>}
        {showRouteNote && route && (
          <p data-testid="approval-route-note">{approvalRouteNote(route, claim.budget_category, t, realRole)}</p>
        )}
        {((claim.is_plan_exception && claim.status !== 'Draft') || route?.isException) && (
          <p data-testid="imprest-exception-note" role="note">
            <StatusPill variant="warn">{t('imprest:plan.exception', 'Out of plan')}</StatusPill>{' '}
            {route === null ? t('imprest:exception.noRoute', 'This is outside the approved site cash plan, so a senior approver decides it.')
              : route.route === 'admin' ? t('imprest:exception.admin', 'This is outside the approved site cash plan. No senior approver can act on it, so an Admin decides it.')
              : t('imprest:exception.deciders', 'This is outside the approved site cash plan. Decided by: {{names}}.', { names: route.approvers.map((a) => a.fullName).join(t('imprest:exception.joiner', ', ')) })}
          </p>
        )}
        <ExpensePostingNote claimId={claim.id} />
      </RecordHeader>

      <RecordStack>
        {hasReturnDetails && (
          <ReturnedBanner
            record="expense"
            reason={claim.rejection_notes}
            person={claim.rejecter?.full_name}
            at={claim.rejected_at}
            action={canReopenFromBanner ? {
              label: t('expenses.actions.reopen', 'Edit and resubmit'),
              onClick: reopenForEditing,
              disabled: transition.isPending,
            } : undefined}
          />
        )}
        {claim.kind === 'claim' && (
          <ExpenseLinesCard claimId={claim.id} lines={linesQuery.data ?? []} isPending={linesQuery.isPending}
            isError={linesQuery.isError} currency={claim.currency} editable={canEdit} />
        )}
        <ExpenseReceiptsCard claimId={claim.id} canWrite={canEdit} />
        <ExpensePostingsCard claimId={claim.id} noteInHeader />
      </RecordStack>

      {editOpen && (
        <ExpenseClaimFormModal
          kind={claim.kind}
          projectOptions={projectChoices.options}
          projectLoad={projectChoices}
          advanceOptions={ownAdvances.options}
          advanceLoad={ownAdvances}
          initial={{
            title: claim.title, projectId: claim.project_id, budgetCategory: claim.budget_category,
            purpose: claim.purpose, amount, advanceId: claim.advance_id, imprestFloatId: claim.imprest_float_id,
          }}
          onClose={() => setEditOpen(false)}
          onSubmit={async (input) => {
            await update.mutateAsync({
              id: claim.id, kind: claim.kind,
              patch: {
                title: input.title, purpose: input.purpose, projectId: input.projectId, budgetCategory: input.budgetCategory,
                amount: input.amount, advanceId: input.advanceId ?? null, imprestFloatId: input.imprestFloatId ?? null,
              },
            });
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default ExpenseClaimDetail;
