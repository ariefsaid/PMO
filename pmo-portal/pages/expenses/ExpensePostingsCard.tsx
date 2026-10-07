import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Card, CardHead, CardPad, ListState, StatusPill, type StatusVariant } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import type { ExpensePostingKind, ExpensePostingRow, ExpensePushState } from '@/src/lib/repositories/expensePostings';

const STATE_VARIANT: Readonly<Record<ExpensePushState, StatusVariant>> = {
  pending: 'progress', failed: 'warn', held: 'overdue', pushed: 'won',
};

/**
 * The recorded reason is a machine code (`<code>` or `<code>: <detail>`, from the sweep's gate, resolver or outbox).
 * The reader gets a translated sentence; the code and its detail stay in the Admin/Finance notification.
 */
function postingReason(t: TFunction, pushError: string): string {
  const code = pushError.split(':', 1)[0].trim();
  switch (code) {
    case 'expense-posting-actor-inactive':
    case 'expense-posting-actor-not-authorized':
    case 'expense-posting-no-recorded-actor':
    case 'expense-posting-actor-cross-org':
      return t('expenses.postings.reason.actor', 'The person who approved or paid this can no longer post it.');
    case 'expense-posting-claim-cancelled':
      return t('expenses.postings.reason.claimCancelled', 'The claim was cancelled before this was posted.');
    case 'expense-posting-precondition-failed':
      return t('expenses.postings.reason.changed', 'The claim changed after this posting was queued.');
    case 'employee-unlinked':
      return t('expenses.postings.reason.employeeUnlinked', 'The claimant is not linked to an ERPNext employee yet.');
    case 'expense-account-unmapped':
      return t('expenses.postings.reason.accountUnmapped', 'An expense account is not mapped yet (Administration › Accounting).');
    case 'expense-account-invalid':
      return t('expenses.postings.reason.accountInvalid', 'A mapped account is not valid in ERPNext.');
    case 'project-unmapped':
      return t('expenses.postings.reason.projectUnmapped', 'The claim’s project is not linked to an ERPNext project.');
    case 'expense-cash-account-unconfigured':
      return t('expenses.postings.reason.cashAccount', 'The ERPNext connection has no cash or bank account.');
    case 'config-rejected':
      return t('expenses.postings.reason.config', 'The ERPNext connection settings do not allow this posting.');
    case 'expense-approval-journal-cancelled':
      return t('expenses.postings.reason.approvalCancelled', 'The approval journal was cancelled in ERPNext.');
    case 'command-held':
    case 'expense-posting-attempts-exhausted':
    case 'expense-posting-mirror-diverged':
      return t('expenses.postings.reason.operator', 'PMO cannot tell what ERPNext recorded. An operator must check it.');
    case 'external-unreachable':
      return t('expenses.postings.reason.unreachable', 'ERPNext could not be reached. It is retried automatically.');
    default:
      return t('expenses.postings.reason.other', 'The posting could not be completed. Admins were notified with the details.');
  }
}

/**
 * #775 phase B (FR-EXP-117, ADR-0059 §6) — what this claim posted to ERPNext. Supplementary: renders NOTHING when the
 * claim has no postings (a standalone org, or an event before the org employed expenses), never blocks the page.
 * State is text plus a dot (Quiet-Status Rule), never colour alone.
 */
export const ExpensePostingsCard: React.FC<{ claimId: string }> = ({ claimId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useQuery<ExpensePostingRow[]>({
    queryKey: ['expense-postings', claimId],
    queryFn: () => repositories.expensePostings.listForClaim(claimId),
  });
  const postingLabel: Record<ExpensePostingKind, string> = {
    approval: t('expenses.postings.kind.approval', 'Approval journal'),
    'claim-payment': t('expenses.postings.kind.claimPayment', 'Cash payment'),
    settlement: t('expenses.postings.kind.settlement', 'Advance settlement'),
    'advance-payment': t('expenses.postings.kind.advancePayment', 'Advance payout'),
    'advance-return': t('expenses.postings.kind.advanceReturn', 'Cash returned'),
    'approval-cancel': t('expenses.postings.kind.approvalCancel', 'Approval cancelled'),
  };
  const stateLabel: Record<ExpensePushState, string> = {
    pending: t('expenses.postings.state.pending', 'Queued'),
    failed: t('expenses.postings.state.failed', 'Failed'),
    held: t('expenses.postings.state.held', 'Needs an operator'),
    pushed: t('expenses.postings.state.pushed', 'Posted'),
  };

  if (isPending) return null;
  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('expenses.postings.errorTitle', "Couldn't load ledger postings")}
        sub={t('expenses.postings.errorSub', 'The claim itself is unaffected. Try again.')}
        retryLabel={t('admin.retry', 'Retry')}
        onRetry={() => refetch()}
      />
    );
  }
  if (!data || data.length === 0) return null;
  return (
    // The same shell as the Receipts card beside it; the title is a real heading for screen-reader navigation.
    <Card variant="bare" className="mb-4" aria-labelledby="expense-postings-heading" role="region">
      <CardHead>
        <h2 id="expense-postings-heading" className="text-sm font-semibold">{t('expenses.postings.title', 'Ledger postings')}</h2>
      </CardHead>
      <CardPad>
        <ul className="flex flex-col gap-2">
          {data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
              <span className="font-medium">{postingLabel[row.posting]}</span>
              {row.erpCancelledAt
                ? <StatusPill variant="superseded">{t('expenses.postings.state.cancelledInErp', 'Cancelled in ERPNext')}</StatusPill>
                : <StatusPill variant={STATE_VARIANT[row.pushState]}>{stateLabel[row.pushState]}</StatusPill>}
              {row.erpName && <span className="break-all text-muted-foreground">{row.erpName}</span>}
              {row.pushError && row.pushState !== 'pushed'
                && <span className="break-words text-muted-foreground">{postingReason(t, row.pushError)}</span>}
            </li>
          ))}
        </ul>
      </CardPad>
    </Card>
  );
};
