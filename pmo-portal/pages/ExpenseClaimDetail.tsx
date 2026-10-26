import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, StatusPill } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjects } from '@/src/hooks/useProjects';
import { useRecordContext } from '@/src/hooks/useRecordContext';
import {
  useExpenseAdvanceOutstanding, useExpenseClaim, useExpenseClaimLines, useExpenseClaimMutations, useExpenseClaimRoute,
} from '@/src/hooks/useExpenseClaims';
import { availableExpenseActions, settlementPreview } from '@/src/lib/expenses/expenseRules';
import { approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatNumber, formatShortMoney } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { ExpenseDecisionBar } from './expenses/ExpenseDecisionBar';
import { ExpenseLinesCard } from './expenses/ExpenseLinesCard';
import { ExpenseReceiptsCard } from './expenses/ExpenseReceiptsCard';
import { ExpensePostingsCard } from './expenses/ExpensePostingsCard';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';
import { MoneyOutPageHeader } from './procurement/MoneyOutHeader';

/** `/expenses/:claimId` (FR-EXP-063..065). Shows only the actions the server would allow; the RPCs decide. */
const ExpenseClaimDetail: React.FC = () => {
  const { t } = useTranslation(['common', 'expenseClaims']);
  const { claimId } = useParams<{ claimId: string }>();
  const location = useLocation();
  const { closeRecord } = useRecordContext('/expenses', claimId);
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const query = useExpenseClaim(claimId);
  const claim = query.data ?? null;
  const linesQuery = useExpenseClaimLines(claimId);
  const routeQuery = useExpenseClaimRoute(claimId, claim?.status);
  const outstandingQuery = useExpenseAdvanceOutstanding(claim?.kind === 'advance' ? claim.id : claim?.advance_id ?? null);
  const { update } = useExpenseClaimMutations();
  const { data: projects } = useProjects();
  const advanceOptions = useOwnAdvanceOptions(claim?.advance_id ?? null);
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);
  const [editOpen, setEditOpen] = useState(false);
  const returnAction = { label: t('expenseClaims:record.backToRegister', 'Back to expenses'), onReturn: closeRecord, phoneOnly: true };

  if (query.isPending) {
    return <><MoneyOutPageHeader title={t('expenses.title', 'Expenses')} returnAction={returnAction} /><ListState variant="loading" rows={5} /></>;
  }
  if (query.isError) {
    return (
      <>
        <MoneyOutPageHeader title={t('expenses.title', 'Expenses')} returnAction={returnAction} />
        <ListState variant="error" title={t('expenses.detail.errorTitle', "Couldn't load this record")}
          sub={t('expenses.detail.errorSub', 'Something went wrong fetching it. Try again.')} onRetry={() => void query.refetch()} />
      </>
    );
  }
  if (!claim) {
    return (
      <>
        <MoneyOutPageHeader title={t('expenses.title', 'Expenses')} returnAction={returnAction} />
        <ListState variant="empty" icon="doc" title={t('expenses.detail.notFoundTitle', 'Not found')}
          sub={t('expenses.detail.notFoundSub', "It doesn't exist, or it isn't yours and you don't approve spend.")} />
      </>
    );
  }

  const route = routeQuery.data ?? null;
  const outstanding = outstandingQuery.data ?? null;
  const actions = availableExpenseActions({
    claim, userId, realRole, route, advanceOutstanding: claim.kind === 'advance' ? outstanding : null,
  });
  const canEdit = may('edit', 'expenseClaim', { currentUserId: userId, record: { claimant_id: claim.claimant_id, status: claim.status } });
  const showRouteNote = claim.status === 'Submitted' && route !== null && route.route !== 'flat'
    && claim.claimant_id !== userId && !actions.includes('approve');
  const amount = Number(claim.amount);
  const paidSplit = settlementPreview(amount, Number(claim.advance_applied));
  const outstandingIsPrimary = claim.kind === 'advance' && claim.status === 'Paid';
  const amountFacts = [
    ...(outstandingIsPrimary ? [{ label: t('expenses.detail.outstanding', 'Outstanding'), value: outstanding, primary: true }] : []),
    { label: t('expenses.detail.amount', 'Amount'), value: amount, primary: !outstandingIsPrimary },
    ...(claim.kind === 'claim' && claim.status === 'Paid' ? [
      { label: t('expenses.detail.advanceApplied', 'Advance applied'), value: paidSplit.applied, primary: false },
      { label: t('expenses.detail.cashPaid', 'Cash paid'), value: paidSplit.cash, primary: false },
    ] : []),
  ];
  const primaryAmount = amountFacts.find((fact) => fact.primary) ?? amountFacts[0];
  const amountHeading = primaryAmount.value === null
    ? t('expenseClaims:record.primaryAmountUnavailable', '{{label}} · Not available', { label: primaryAmount.label })
    : t('expenseClaims:record.primaryAmount', '{{label}} · {{compact}}', {
      label: primaryAmount.label,
      compact: formatShortMoney(primaryAmount.value, claim.currency, { code: true }),
    });

  return (
    <div>
      <MoneyOutPageHeader
        title={claim.title}
        returnAction={returnAction}
        status={
          <span data-testid="expense-status" data-status={claim.status}>
            <StatusPill variant={workflowVariant(claim.status)}>{expenseStatusLabel(claim.status, t)}</StatusPill>
          </span>
        }
        scope={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{claim.claim_number ?? t('expenses.draftNumber', 'Draft')}</span>
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
        primaryAction={canEdit ? <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEditOpen(true)}>{t('expenses.detail.editDetails', 'Edit details')}</Button> : undefined}
      />

      <section aria-labelledby="expense-evidence-heading" className="mb-8 border-b border-border pb-4">
        <h2 id="expense-evidence-heading" className="mb-4 break-words text-xl font-bold">{amountHeading}</h2>
        <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {amountFacts.map((fact, index) => (
            <div key={`${fact.label}-${index}`} className="min-w-0">
              <dt className="break-words text-xs font-semibold text-muted-foreground">{fact.label}</dt>
              <dd className="mt-2 break-words text-sm font-normal tabular-nums" data-testid={fact.label === t('expenses.detail.amount', 'Amount') ? 'expense-amount' : undefined}>
                {fact.value === null ? t('expenseClaims:record.outstandingUnavailable', 'Not available — refresh this record to check again.') : formatNumber(fact.value)}
              </dd>
            </div>
          ))}
          {claim.payment_reference && (
            <div>
              <dt className="break-words text-xs font-semibold text-muted-foreground">{t('expenses.detail.reference', 'Payment reference')}</dt>
              <dd className="mt-2 break-words text-sm">{claim.payment_reference}</dd>
            </div>
          )}
        </dl>
        {claim.purpose && <p className="mt-3 whitespace-pre-wrap text-sm">{claim.purpose}</p>}
        {claim.advance_id && (
          <p className="mt-3 text-sm">
            <Link to={`/expenses/${claim.advance_id}${location.search}`} state={location.state} className="text-primary-text hover:underline">
              {t('expenses.detail.linkedAdvance', 'Settles a cash advance')}
            </Link>
          </p>
        )}
        {claim.rejection_notes && (claim.status === 'Rejected' || claim.status === 'Draft') && (
          <p role="note" className="mt-3 break-words text-sm">
            {t('expenses.detail.rejectionNote', 'Rejected: {{note}}', { note: claim.rejection_notes })}
          </p>
        )}
      </section>

      {claim.kind === 'claim' && (
        <ExpenseLinesCard claimId={claim.id} lines={linesQuery.data ?? []} isPending={linesQuery.isPending}
          isError={linesQuery.isError} currency={claim.currency} editable={canEdit} />
      )}
      <ExpenseReceiptsCard claimId={claim.id} canWrite={canEdit} />
      {showRouteNote && route && (
        <p data-testid="approval-route-note" className="mb-4 text-sm">{approvalRouteNote(route, claim.budget_category, t, realRole)}</p>
      )}
      <ExpenseDecisionBar claim={claim} actions={actions} advanceOutstanding={outstanding} />
      <ExpensePostingsCard claimId={claim.id} />

      {editOpen && (
        <ExpenseClaimFormModal
          kind={claim.kind}
          projectOptions={projectOptions}
          advanceOptions={advanceOptions}
          initial={{
            title: claim.title, projectId: claim.project_id, budgetCategory: claim.budget_category,
            purpose: claim.purpose, amount, advanceId: claim.advance_id,
          }}
          onClose={() => setEditOpen(false)}
          onSubmit={async (input) => {
            await update.mutateAsync({
              id: claim.id, kind: claim.kind,
              patch: {
                title: input.title, purpose: input.purpose, projectId: input.projectId, budgetCategory: input.budgetCategory,
                amount: input.amount, advanceId: input.advanceId ?? null,
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
