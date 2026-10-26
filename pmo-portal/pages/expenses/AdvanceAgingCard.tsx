import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, ListState, type Column } from '@/src/components/ui';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatDateOnly, formatNumber } from '@/src/lib/format';
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
    { key: 'advance', header: t('expenses.aging.columns.advance', 'Advance'), kind: 'primary', fullIdentity: true, cell: (row) => <Link to={`/expenses/${row.advanceId}${location.search}`} state={{ recordContext: { listPath: returnPath } }} className="break-words text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{row.claimNumber ?? '—'}</Link> },
    { key: 'claimant', header: t('expenses.aging.columns.claimant', 'Claimant'), kind: 'text', cell: (row) => row.claimantName ?? '—' },
    { key: 'project', header: t('expenses.aging.columns.project', 'Project'), kind: 'text', cell: (row) => row.projectName ?? t('expenses.overhead', 'Overhead') },
    { key: 'paidOn', header: t('expenseClaims:aging.columns.paidOn', 'Paid on'), kind: 'date', cell: (row) => row.paidOn ? formatDateOnly(row.paidOn) : t('expenseClaims:aging.unknownPayoutDate', 'Not available') },
    { key: 'outstanding', header: t('expenses.aging.columns.outstanding', 'Outstanding'), kind: 'money', align: 'num', cell: (row) => formatNumber(row.outstanding) },
    { key: 'age', header: t('expenses.aging.columns.age', 'Age (days)'), kind: 'number', align: 'num', cell: (row) => row.ageDays ?? '—' },
  ], [location.search, returnPath, t]);
  const mobileRow = (row: ExpenseAdvanceAgingRow) => {
    const href = `/expenses/${row.advanceId}${location.search}`;
    const state = { recordContext: { listPath: returnPath } };
    return (
      <div className="grid gap-4 p-4">
        <div className="min-w-0">
          <Link to={href} state={state} className="block break-words text-sm text-foreground hover:underline">{row.claimNumber ?? t('expenseClaims:shared.notAvailable', 'Not available')}</Link>
          <div className="mt-1 break-words text-xs font-semibold text-muted-foreground">{row.claimantName ?? t('expenseClaims:shared.notAvailable', 'Not available')}</div>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-4">
          <div className="min-w-0"><dt className="text-xs font-semibold text-muted-foreground">{t('expenseClaims:aging.columns.paidOn', 'Paid on')}</dt><dd className="mt-2 text-sm tabular-nums text-foreground">{row.paidOn ? <time dateTime={row.paidOn}>{formatDateOnly(row.paidOn)}</time> : t('expenseClaims:aging.unknownPayoutDate', 'Not available')}</dd></div>
          <div className="min-w-0"><dt className="text-xs font-semibold text-muted-foreground">{t('expenses.aging.columns.age', 'Age (days)')}</dt><dd className="mt-2 text-sm tabular-nums text-foreground">{row.ageDays === null ? t('expenseClaims:shared.notAvailable', 'Not available') : formatNumber(row.ageDays)}</dd></div>
        </dl>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0"><p className="text-sm text-muted-foreground">{t('expenses.aging.columns.outstanding', 'Outstanding')}</p><p className="mt-2 whitespace-nowrap text-xl font-bold tabular-nums text-foreground">{formatNumber(row.outstanding)}</p></div>
          <Link to={href} state={state} aria-label={t('expenseClaims:register.table.openClaim', 'Open {{title}}', { title: row.claimNumber ?? row.advanceId })}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('expenseClaims:register.table.open', 'Open')}
          </Link>
        </div>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center break-words text-xs font-semibold text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t('expenseClaims:aging.mobileDetails', 'Project details')}
          </summary>
          <dl className="mt-2 grid grid-cols-2 gap-4">
            <div className="min-w-0"><dt className="text-xs font-semibold text-muted-foreground">{t('expenses.aging.columns.project', 'Project')}</dt><dd className="mt-2 break-words text-sm text-foreground">{row.projectName ?? t('expenses.overhead', 'Overhead')}</dd></div>
          </dl>
        </details>
      </div>
    );
  };
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
    <section aria-labelledby="advance-aging-heading">
      <h2 id="advance-aging-heading" className="mb-4 text-xl font-bold leading-tight text-foreground">{t('expenses.aging.title', 'Outstanding advances')}</h2>
      <div>
          <DataTable rows={rows} columns={columns} mobileRow={mobileRow} rowKey={(row) => row.advanceId} tableId="advance-aging" accessibleName={t('expenses.aging.title', 'Outstanding advances')} groupBy={(row) => row.currency || t('expenseClaims:shared.notAvailable', 'Not available')} groupHeadingClassName="text-xl font-bold leading-tight" />
          {data.truncated && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t('expenses.aging.truncated', 'Showing up to {{count}} advances from the bounded outstanding list. Search and filters apply within this set.', { count: AGING_LIMIT })}
            </p>
          )}
      </div>
    </section>
  );
};
