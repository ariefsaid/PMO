import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, ListState } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useExpenseClaimsAwaitingDecision } from '@/src/hooks/useExpenseClaims';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { formatCurrencyCents } from '@/src/lib/format';

/** "Expense claims awaiting you" on /approvals (FR-EXP-066). Decisions happen on the record page. Hidden when none;
 *  a failed read shows an error rather than a false "nothing waiting" (the AwaitingApprovalTile lesson). */
export const ExpenseClaimApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const userId = useAuth().currentUser?.id;
  const { realRole } = useEffectiveRole();
  const { data, isPending, isError, refetch } = useExpenseClaimsAwaitingDecision();
  const rows = useMemo(() => claimsAwaitingViewer(data ?? [], userId, realRole), [data, userId, realRole]);
  if (isPending) return null;
  if (isError) {
    return (
      <div className="mb-4">
        <ListState variant="error" title={t('expenses.approvals.errorTitle', "Couldn't load expense claims awaiting you")}
          sub={t('expenses.approvals.errorSub', 'Purchase requests and timesheets below are unaffected.')} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('expenses.approvals.label', 'Expense claims awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('expenses.approvals.heading', 'Expense claims awaiting you ({{count}})', { count: rows.length })}</CardHead>
        <ul className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map(({ claim }) => (
            <li key={claim.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Link to={`/expenses/${claim.id}`} className="font-medium text-primary-text hover:underline">{claim.claim_number ?? claim.title}</Link>
              <span className="truncate">{claim.title}</span>
              <span className="text-muted-foreground">{claim.claimant?.full_name ?? '—'}</span>
              <span className="ml-auto tabular-nums">{formatCurrencyCents(Number(claim.amount), claim.currency)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
