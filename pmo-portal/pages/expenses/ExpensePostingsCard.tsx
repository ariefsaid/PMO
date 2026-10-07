import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHead, CardPad, ListState, StatusPill, type StatusVariant } from '@/src/components/ui';
import {
  listExpensePostings,
  type ExpensePostingKind,
  type ExpensePostingRow,
  type ExpensePushState,
} from '@/src/lib/repositories/expensePostings';

const STATE_VARIANT: Readonly<Record<ExpensePushState, StatusVariant>> = {
  pending: 'progress', failed: 'warn', held: 'overdue', pushed: 'won',
};

/**
 * #775 phase B (FR-EXP-117, ADR-0059 §6) — what this claim posted to ERPNext. Supplementary: renders NOTHING when the
 * claim has no postings (a standalone org, or an event before the org employed expenses), never blocks the page.
 * State is text plus a dot (Quiet-Status Rule), never colour alone.
 */
export const ExpensePostingsCard: React.FC<{ claimId: string }> = ({ claimId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useQuery<ExpensePostingRow[]>({
    queryKey: ['expense-postings', claimId],
    queryFn: () => listExpensePostings(claimId),
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
              {row.pushError && row.pushState !== 'pushed' && <span className="break-words text-muted-foreground">{row.pushError}</span>}
            </li>
          ))}
        </ul>
      </CardPad>
    </Card>
  );
};
