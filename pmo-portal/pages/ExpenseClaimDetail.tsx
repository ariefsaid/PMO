import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ListState, RecordHeader, StatusPill } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjects } from '@/src/hooks/useProjects';
import {
  useExpenseAdvanceOutstanding, useExpenseClaim, useExpenseClaimLines, useExpenseClaimMutations, useExpenseClaimRoute,
} from '@/src/hooks/useExpenseClaims';
import { availableExpenseActions, settlementPreview } from '@/src/lib/expenses/expenseRules';
import { approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyCents } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { ExpenseDecisionBar } from './expenses/ExpenseDecisionBar';
import { ExpenseLinesCard } from './expenses/ExpenseLinesCard';
import { ExpenseReceiptsCard } from './expenses/ExpenseReceiptsCard';
import { ExpensePostingsCard } from './expenses/ExpensePostingsCard';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';

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
  const { update } = useExpenseClaimMutations();
  const { data: projects } = useProjects();
  const advanceOptions = useOwnAdvanceOptions(claim?.advance_id ?? null);
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: p.name })), [projects]);
  const [editOpen, setEditOpen] = useState(false);
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
  const outstanding = outstandingQuery.data ?? null;
  const actions = availableExpenseActions({
    claim, userId, realRole, route, advanceOutstanding: claim.kind === 'advance' ? outstanding : null,
  });
  const canEdit = may('edit', 'expenseClaim', { currentUserId: userId, record: { claimant_id: claim.claimant_id, status: claim.status } });
  const showRouteNote = claim.status === 'Submitted' && route !== null && route.route !== 'flat'
    && claim.claimant_id !== userId && !actions.includes('approve');
  const amount = Number(claim.amount);
  const paidSplit = settlementPreview(amount, Number(claim.advance_applied));

  return (
    <div>
      <div className="hidden max-[920px]:block"><BackBar label={backLabel} onBack={goBack} /></div>
      <RecordHeader
        name={claim.title}
        icon={claim.kind === 'advance' ? 'A' : 'E'}
        status={
          <span data-testid="expense-status" data-status={claim.status}>
            <StatusPill variant={workflowVariant(claim.status)}>{expenseStatusLabel(claim.status, t)}</StatusPill>
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{claim.claim_number ?? t('expenses.draftNumber', 'Draft')}</span>
            <span>{expenseKindLabel(claim.kind, t)}</span>
            <span>{claim.claimant?.full_name ?? '—'}</span>
            {claim.project_id ? (
              <Link to={`/projects/${claim.project_id}`} className="text-primary-text hover:underline">{claim.project?.name ?? '—'}</Link>
            ) : (
              <span>{t('expenses.overhead', 'Overhead')}</span>
            )}
            {claim.budget_category && <span>{budgetCategoryLabel(claim.budget_category, t)}</span>}
          </span>
        }
        actions={canEdit ? <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>{t('expenses.detail.editDetails', 'Edit details')}</Button> : undefined}
      />

      <Card variant="bare" className="mb-4">
        <CardHead>{t('expenses.detail.summary', 'Summary')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('expenses.detail.amount', 'Amount')}</dt>
              <dd className="font-semibold tabular-nums" data-testid="expense-amount">{formatCurrencyCents(amount, claim.currency)}</dd>
            </div>
            {claim.kind === 'claim' && claim.status === 'Paid' && (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('expenses.detail.advanceApplied', 'Advance applied')}</dt>
                  <dd className="tabular-nums">{formatCurrencyCents(paidSplit.applied, claim.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('expenses.detail.cashPaid', 'Cash paid')}</dt>
                  <dd className="tabular-nums">{formatCurrencyCents(paidSplit.cash, claim.currency)}</dd>
                </div>
              </>
            )}
            {claim.kind === 'advance' && claim.status === 'Paid' && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('expenses.detail.outstanding', 'Outstanding')}</dt>
                <dd className="tabular-nums">{outstanding === null ? '—' : formatCurrencyCents(outstanding, claim.currency)}</dd>
              </div>
            )}
            {claim.payment_reference && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('expenses.detail.reference', 'Payment reference')}</dt>
                <dd>{claim.payment_reference}</dd>
              </div>
            )}
          </dl>
          {claim.advance_id && (
            <p className="mt-3 text-sm">
              <Link to={`/expenses/${claim.advance_id}`} className="text-primary-text hover:underline">
                {t('expenses.detail.linkedAdvance', 'Settles a cash advance')}
              </Link>
            </p>
          )}
          {claim.purpose && <p className="mt-3 text-sm">{claim.purpose}</p>}
          {claim.rejection_notes && (claim.status === 'Rejected' || claim.status === 'Draft') && (
            <p role="note" className="mt-3 text-sm">
              {t('expenses.detail.rejectionNote', 'Rejected: {{note}}', { note: claim.rejection_notes })}
            </p>
          )}
        </CardPad>
      </Card>

      {showRouteNote && route && (
        <p data-testid="approval-route-note" className="mb-4 text-sm">{approvalRouteNote(route, claim.budget_category, t, realRole)}</p>
      )}

      <ExpenseDecisionBar claim={claim} actions={actions} advanceOutstanding={outstanding} />

      {claim.kind === 'claim' && (
        <ExpenseLinesCard claimId={claim.id} lines={linesQuery.data ?? []} isPending={linesQuery.isPending}
          isError={linesQuery.isError} currency={claim.currency} editable={canEdit} />
      )}
      <ExpenseReceiptsCard claimId={claim.id} canWrite={canEdit} />
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
