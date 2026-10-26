import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, DataTable, ListState, type Column } from '@/src/components/ui';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatNumber } from '@/src/lib/format';
import { AGING_LIMIT, type ExpenseAdvanceAgingRow } from '@/src/lib/db/expenseClaims';

export interface AdvanceAgingCardProps {
  active?: boolean;
  projectId?: string;
  query?: string;
  age?: string;
  sortOrder?: 'oldest' | 'newest';
}

/** Outstanding advances are a view of the expense register, not a second dashboard. */
export const AdvanceAgingCard: React.FC<AdvanceAgingCardProps> = ({
  active = true,
  projectId = 'All',
  query = '',
  age = 'All',
  sortOrder = 'oldest',
}) => {
  const { t } = useTranslation(['common', 'expenseClaims']);
  const location = useLocation();
  const { data, isPending, isError, refetch } = useExpenseAdvanceAging();
  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...(data?.rows ?? [])]
      .filter((row) => projectId === 'All' || row.projectId === projectId)
      .filter((row) => age === 'All' || (age === 'unknown' ? row.paidOn === null : row.bucket === age))
      .filter((row) => !normalizedQuery || [row.claimNumber ?? '', row.claimantName ?? '', row.projectName ?? '']
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
      .sort((left, right) => {
        if (Boolean(left.paidOn) !== Boolean(right.paidOn)) return left.paidOn ? -1 : 1;
        if (left.paidOn && right.paidOn && left.paidOn !== right.paidOn) {
          return sortOrder === 'oldest' ? left.paidOn.localeCompare(right.paidOn) : right.paidOn.localeCompare(left.paidOn);
        }
        return left.advanceId.localeCompare(right.advanceId);
      });
  }, [age, data?.rows, projectId, query, sortOrder]);
  const columns = useMemo<Column<ExpenseAdvanceAgingRow>[]>(() => [
    { key: 'advance', header: t('expenses.aging.columns.advance', 'Advance'), kind: 'primary', cell: (row) => <Link to={`/expenses/${row.advanceId}${location.search}`} state={{ recordContext: { listPath: returnPath } }} className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{row.claimNumber ?? '—'}</Link> },
    { key: 'claimant', header: t('expenses.aging.columns.claimant', 'Claimant'), kind: 'text', cell: (row) => row.claimantName ?? '—' },
    { key: 'project', header: t('expenses.aging.columns.project', 'Project'), kind: 'text', cell: (row) => row.projectName ?? t('expenses.overhead', 'Overhead') },
    { key: 'outstanding', header: t('expenses.aging.columns.outstanding', 'Outstanding'), kind: 'money', align: 'num', cell: (row) => formatNumber(row.outstanding) },
    { key: 'age', header: t('expenses.aging.columns.age', 'Age (days)'), kind: 'number', align: 'num', cell: (row) => row.ageDays ?? '—' },
  ], [location.search, returnPath, t]);
  if (!active) return null;
  if (isPending) return <ListState variant="loading" rows={4} />;
  if (isError || !data) {
    return <ListState
      variant="error"
      title={t('expenses.aging.errorTitle', "Couldn't load outstanding advances")}
      sub={t('expenses.aging.errorSub', 'The rest of the expense register is unaffected. Try again.')}
      onRetry={() => void refetch()}
    />;
  }
  if (data.rows.length === 0) return <ListState variant="empty" title={t('expenseClaims:register.outstanding.emptyTitle', 'No outstanding advances')} sub={t('expenseClaims:register.outstanding.emptySub', 'Paid advances with an unsettled balance will appear here.')} />;
  if (rows.length === 0) return <ListState variant="empty" title={t('expenseClaims:register.outstanding.noMatch', 'No advances match these filters')} />;
  return (
    <section aria-label={t('expenses.aging.title', 'Outstanding advances')}>
      <Card variant="bare">
        <CardHead>{t('expenses.aging.title', 'Outstanding advances')}</CardHead>
        <CardPad>
          <DataTable rows={rows} columns={columns} rowKey={(row) => row.advanceId} tableId="advance-aging" accessibleName={t('expenses.aging.title', 'Advances outstanding')} groupBy={(row) => row.currency || t('common:notAvailable', 'Not available')} />
          {data.truncated && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t('expenses.aging.truncated', 'Showing up to {{count}} advances from the bounded outstanding list. Search and filters apply within this set.', { count: AGING_LIMIT })}
            </p>
          )}
        </CardPad>
      </Card>
    </section>
  );
};
