import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatCurrencyCents } from '@/src/lib/format';
import { AGING_BUCKETS, agingTotals } from '@/src/lib/expenses/expenseRules';
import { AGING_LIMIT } from '@/src/lib/db/expenseClaims';
import { agingBucketLabel } from './expenseLabels';

/** Advances outstanding (FR-EXP-062, DD-EXP-7). RLS scopes the rows: a claimant sees their own; approval rank sees
 *  all. Hidden when nothing is outstanding; a failed read is an error, never a fabricated empty. */
export const AdvanceAgingCard: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useExpenseAdvanceAging();
  if (isPending) return null;
  if (isError || !data) {
    return (
      <div className="mb-4">
        <ListState
          variant="error"
          title={t('expenses.aging.errorTitle', "Couldn't load outstanding advances")}
          sub={t('expenses.aging.errorSub', 'The list below is unaffected. Try again.')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (data.rows.length === 0) return null;
  const totals = agingTotals(data.rows);
  return (
    <section aria-label={t('expenses.aging.title', 'Advances outstanding')} className="mb-4">
      <Card variant="bare">
        <CardHead>{t('expenses.aging.title', 'Advances outstanding')}</CardHead>
        <CardPad>
          {Object.entries(totals).map(([currency, buckets]) => (
            <dl key={currency} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AGING_BUCKETS.map((bucket) => (
                <div key={bucket}>
                  <dt className="text-xs text-muted-foreground">{agingBucketLabel(bucket, t)}</dt>
                  <dd className="font-semibold tabular-nums" data-testid={`aging-${currency}-${bucket}`}>
                    {formatCurrencyCents(buckets[bucket], currency)}
                  </dd>
                </div>
              ))}
            </dl>
          ))}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">{t('expenses.aging.columns.advance', 'Advance')}</th>
                <th className="py-1 font-medium">{t('expenses.aging.columns.claimant', 'Claimant')}</th>
                <th className="py-1 font-medium">{t('expenses.aging.columns.project', 'Project')}</th>
                <th className="py-1 text-right font-medium">{t('expenses.aging.columns.outstanding', 'Outstanding')}</th>
                <th className="py-1 text-right font-medium">{t('expenses.aging.columns.age', 'Age (days)')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.advanceId} className="border-t border-border">
                  <td className="py-1.5">
                    <Link to={`/expenses/${r.advanceId}`} className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {r.claimNumber ?? '—'}
                    </Link>
                  </td>
                  <td className="py-1.5">{r.claimantName ?? '—'}</td>
                  <td className="py-1.5">{r.projectName ?? t('expenses.overhead', 'Overhead')}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrencyCents(r.outstanding, r.currency)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.ageDays ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t('expenses.aging.truncated', 'Showing the oldest {{count}} advances.', { count: AGING_LIMIT })}
            </p>
          )}
        </CardPad>
      </Card>
    </section>
  );
};
