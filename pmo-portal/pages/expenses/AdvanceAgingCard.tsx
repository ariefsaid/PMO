import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, DataTable, ListState, type Column } from '@/src/components/ui';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatCurrencyCents } from '@/src/lib/format';
import { AGING_BUCKETS, agingTotals } from '@/src/lib/expenses/expenseRules';
import { AGING_LIMIT, type ExpenseAdvanceAgingRow } from '@/src/lib/db/expenseClaims';
import { agingBucketLabel } from './expenseLabels';

/** Advances outstanding (FR-EXP-062, DD-EXP-7). RLS scopes the rows: a claimant sees their own; approval rank sees
 *  all. Hidden when nothing is outstanding; a failed read is an error, never a fabricated empty. */
export const AdvanceAgingCard: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useExpenseAdvanceAging();
  const columns = useMemo<Column<ExpenseAdvanceAgingRow>[]>(() => [
    { key: 'advance', header: t('expenses.aging.columns.advance', 'Advance'), kind: 'primary', cell: (row) => <Link to={`/expenses/${row.advanceId}`} className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{row.claimNumber ?? '—'}</Link> },
    { key: 'claimant', header: t('expenses.aging.columns.claimant', 'Claimant'), kind: 'text', cell: (row) => row.claimantName ?? '—' },
    { key: 'project', header: t('expenses.aging.columns.project', 'Project'), kind: 'text', cell: (row) => row.projectName ?? t('expenses.overhead', 'Overhead') },
    { key: 'outstanding', header: t('expenses.aging.columns.outstanding', 'Outstanding'), kind: 'money', align: 'num', cell: (row) => formatCurrencyCents(row.outstanding, row.currency) },
    { key: 'age', header: t('expenses.aging.columns.age', 'Age (days)'), kind: 'number', align: 'num', cell: (row) => row.ageDays ?? '—' },
  ], [t]);
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
          <DataTable rows={data.rows} columns={columns} rowKey={(row) => row.advanceId} tableId="advance-aging" accessibleName={t('expenses.aging.title', 'Advances outstanding')} />
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
