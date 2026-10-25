import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, SearchMini, Toolbar } from '@/src/components/ui';
import BudgetAccountMap from './BudgetAccountMap';
import ExpenseAccountMap from './ExpenseAccountMap';
import type { PostingAccountCoverage, PostingAccountPurpose, PostingAccountSort } from './postingAccountFilters';

const SEARCH = 'posting_search';
const PURPOSE = 'posting_purpose';
const COVERAGE = 'posting_coverage';
const SORT = 'posting_sort';

const PostingAccountsTask: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const search = searchParams.get(SEARCH) ?? '';
  const purposeValue = searchParams.get(PURPOSE);
  const purpose: PostingAccountPurpose = purposeValue === 'budget' || purposeValue === 'expense' ? purposeValue : 'all';
  const coverageValue = searchParams.get(COVERAGE);
  const coverage: PostingAccountCoverage = coverageValue === 'configured' || coverageValue === 'needs-setup' ? coverageValue : 'all';
  const sort: PostingAccountSort = searchParams.get(SORT) === 'desc' ? 'desc' : 'asc';
  const hasFilters = Boolean(search || purpose !== 'all' || coverage !== 'all' || sort !== 'asc');

  const patchQuery = (patch: Partial<Record<typeof SEARCH | typeof PURPOSE | typeof COVERAGE | typeof SORT, string>>) => {
    const next = new URLSearchParams(location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (!value || value === 'all' || (key === SORT && value === 'asc')) next.delete(key);
        else next.set(key, value);
      }
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '', hash: location.hash }, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(location.search);
    [SEARCH, PURPOSE, COVERAGE, SORT].forEach((key) => next.delete(key));
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '', hash: location.hash }, { replace: true });
  };

  const filters = { purpose, coverage, sort, search, onClear: clearFilters };
  return (
    <div className="min-w-0 space-y-4" data-testid="posting-accounts-task">
      <Toolbar standalone>
        <SearchMini
          placeholder={t('admin.postingAccounts.search.placeholder', 'Search categories and accounts…')}
          aria-label={t('admin.postingAccounts.search.label', 'Search posting accounts')}
          value={search}
          onChange={(event) => patchQuery({ [SEARCH]: event.target.value })}
          containerClassName="min-h-11 max-sm:basis-full max-sm:w-full max-sm:min-w-0"
        />
        <label className="sr-only" htmlFor="posting-account-purpose-filter">
          {t('admin.postingAccounts.purpose.label', 'Filter posting account purpose')}
        </label>
        <select
          id="posting-account-purpose-filter"
          aria-label={t('admin.postingAccounts.purpose.label', 'Filter posting account purpose')}
          className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={purpose}
          onChange={(event) => patchQuery({ [PURPOSE]: event.target.value })}
        >
          <option value="all">{t('admin.postingAccounts.purpose.all', 'All purposes')}</option>
          <option value="budget">{t('admin.postingAccounts.purpose.budget', 'Budget accounts')}</option>
          <option value="expense">{t('admin.postingAccounts.purpose.expense', 'Expense accounts')}</option>
        </select>
        <label className="sr-only" htmlFor="posting-account-coverage-filter">
          {t('admin.postingAccounts.coverage.label', 'Filter posting account coverage')}
        </label>
        <select
          id="posting-account-coverage-filter"
          aria-label={t('admin.postingAccounts.coverage.label', 'Filter posting account coverage')}
          className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={coverage}
          onChange={(event) => patchQuery({ [COVERAGE]: event.target.value })}
        >
          <option value="all">{t('admin.postingAccounts.coverage.all', 'All coverage')}</option>
          <option value="configured">{t('admin.postingAccounts.coverage.configured', 'Configured')}</option>
          <option value="needs-setup">{t('admin.postingAccounts.coverage.needsSetup', 'Needs setup')}</option>
        </select>
        <Button
          variant="outline"
          aria-label={sort === 'asc' ? t('admin.postingAccounts.sort.asc', 'Name A–Z') : t('admin.postingAccounts.sort.desc', 'Name Z–A')}
          aria-pressed={sort === 'desc'}
          className="min-h-11"
          onClick={() => patchQuery({ [SORT]: sort === 'asc' ? 'desc' : 'asc' })}
        >
          {sort === 'asc' ? t('admin.postingAccounts.sort.asc', 'Name A–Z') : t('admin.postingAccounts.sort.desc', 'Name Z–A')}
        </Button>
        {hasFilters && <Button variant="ghost" className="min-h-11" onClick={clearFilters}>{t('admin.postingAccounts.clear', 'Clear filters')}</Button>}
      </Toolbar>
      {(purpose === 'all' || purpose === 'budget') && <BudgetAccountMap filters={filters} />}
      {(purpose === 'all' || purpose === 'expense') && <ExpenseAccountMap filters={filters} />}
    </div>
  );
};

export default PostingAccountsTask;
