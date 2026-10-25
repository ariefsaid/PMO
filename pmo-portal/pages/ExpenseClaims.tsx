import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, ListState, SearchMini, SelectField, StatusPill, useToast, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjects } from '@/src/hooks/useProjects';
import { useExpenseClaims, useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyCents } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import {
  EXPENSE_LIST_LIMIT, type BudgetCategory, type ExpenseClaimFilters, type ExpenseClaimStatus,
  type ExpenseClaimWithRefs, type ExpenseKind,
} from '@/src/lib/db/expenseClaims';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { AdvanceAgingCard } from './expenses/AdvanceAgingCard';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { useRecordContext } from '@/src/hooks/useRecordContext';
import { expenseKindLabel, expenseStatusLabel, agingBucketLabel } from './expenses/expenseLabels';
import { MoneyOutListPage } from './procurement/MoneyOutHeader';

const OWNED_QUERY_KEYS = ['q', 'status', 'kind', 'category', 'project', 'sort', 'advanceSort', 'view', 'age'] as const;
const AGE_FILTERS = ['All', '0-30', '31-60', '61-90', '90+', 'unknown'] as const;

/** Expenses and advances share one register; each view keeps its own URL-owned sort and filters. */
const ExpenseClaims: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { openRecord } = useRecordContext('/expenses');
  const may = usePermission();
  const { toast } = useToast();
  const latestSearch = useRef(location.search);
  useLayoutEffect(() => { latestSearch.current = location.search; }, [location.search]);

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(latestSearch.current);
    if (!value || value === 'All' || (key === 'sort' && value === 'newest') || (key === 'advanceSort' && value === 'oldest') || (key === 'view' && value === 'claims')) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    latestSearch.current = query ? `?${query}` : '';
    navigate(`${location.pathname}${latestSearch.current}`, { replace: true, state: location.state });
  }, [location.pathname, location.state, navigate]);
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [search, setSearch] = useUrlSearchInput(params.get('q') ?? '', (value) => setParam('q', value));
  const view = params.get('view') === 'outstanding' ? 'outstanding' : 'claims';
  const rawStatus = params.get('status') ?? '';
  const status = Constants.public.Enums.expense_claim_status.includes(rawStatus as ExpenseClaimStatus) ? rawStatus : '';
  const rawKind = params.get('kind') ?? '';
  const kind = rawKind === 'claim' || rawKind === 'advance' ? rawKind : '';
  const rawCategory = params.get('category') ?? '';
  const category = Constants.public.Enums.budget_category.includes(rawCategory as BudgetCategory) ? rawCategory : '';
  const project = params.get('project') || 'All';
  const sort = params.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const advanceSort = params.get('advanceSort') === 'newest' ? 'newest' : 'oldest';
  const age = AGE_FILTERS.includes((params.get('age') ?? 'All') as typeof AGE_FILTERS[number]) ? (params.get('age') ?? 'All') : 'All';

  const filters = useMemo<ExpenseClaimFilters>(() => view === 'claims' ? ({
    ...(status ? { status: status as ExpenseClaimStatus } : {}),
    ...(kind ? { kind: kind as ExpenseKind } : {}),
    ...(category ? { budgetCategory: category as BudgetCategory } : {}),
    ...(project !== 'All' ? { projectId: project } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    sort,
  }) : {}, [category, kind, project, search, sort, status, view]);
  const { data, isPending, isError, refetch } = useExpenseClaims(filters);
  const { data: projects } = useProjects();
  const { create } = useExpenseClaimMutations();
  const advanceOptions = useOwnAdvanceOptions();
  const [formKind, setFormKind] = useState<ExpenseKind | null>(null);
  const canCreate = may('create', 'expenseClaim');
  const goToNewClaim = () => navigate(`/expenses/new${project !== 'All' ? `?project=${encodeURIComponent(project)}` : ''}`);
  const rows = data?.rows ?? [];
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);

  const statusOptions = [
    { value: '', label: t('expenses.filters.allStatuses', 'All statuses') },
    ...Constants.public.Enums.expense_claim_status.map((s) => ({ value: s, label: expenseStatusLabel(s, t) })),
  ];
  const kindOptions = [
    { value: '', label: t('expenses.filters.allKinds', 'Claims and advances') },
    { value: 'claim', label: expenseKindLabel('claim', t) },
    { value: 'advance', label: expenseKindLabel('advance', t) },
  ];
  const categoryOptions = [
    { value: '', label: t('expenses.filters.allCategories', 'All categories') },
    ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) })),
  ];
  const projectFilterOptions = [
    { value: 'All', label: t('expenses.filters.allProjects', 'All projects') },
    ...projectOptions,
  ];
  const ageOptions = AGE_FILTERS.map((value) => ({
    value,
    label: value === 'All' ? t('expenses.filters.allAges', 'All ages') : value === 'unknown'
      ? t('expenses.filters.unknownAge', 'Unknown payout date') : agingBucketLabel(value, t),
  }));

  const columns: Column<ExpenseClaimWithRefs>[] = [
    { key: 'claim_number', header: t('expenses.columns.number', 'Number'),
      cell: (r) => <span className="whitespace-nowrap font-medium">{r.claim_number ?? t('expenses.draftNumber', 'Draft')}</span>,
      exportValue: (r) => r.claim_number ?? '' },
    { key: 'kind', header: t('expenses.columns.kind', 'Type'), cell: (r) => expenseKindLabel(r.kind, t), exportValue: (r) => r.kind },
    { key: 'title', header: t('expenses.columns.title', 'Title'),
      cell: (r) => <span className="truncate" title={r.title}>{r.title}</span>, exportValue: (r) => r.title },
    { key: 'claimant', header: t('expenses.columns.claimant', 'Claimant'),
      cell: (r) => r.claimant?.full_name ?? '—', exportValue: (r) => r.claimant?.full_name ?? '' },
    { key: 'project', header: t('expenses.columns.project', 'Project'),
      cell: (r) => r.project ? <span title={r.project.name}>{projectDisplayName(r.project)}</span> : t('expenses.overhead', 'Overhead'), exportValue: (r) => r.project?.name ?? '' },
    { key: 'budget_category', header: t('expenses.columns.category', 'Budget category'),
      cell: (r) => (r.budget_category ? budgetCategoryLabel(r.budget_category, t) : '—'), exportValue: (r) => r.budget_category ?? '' },
    { key: 'amount', header: t('expenses.columns.amount', 'Amount'), align: 'num',
      cell: (r) => <span className="tabular-nums">{formatCurrencyCents(Number(r.amount), r.currency)}</span>,
      exportValue: (r) => Number(r.amount) },
    { key: 'status', header: t('expenses.columns.status', 'Status'),
      cell: (r) => <StatusPill variant={workflowVariant(r.status)}>{expenseStatusLabel(r.status, t)}</StatusPill>,
      exportValue: (r) => r.status },
  ];

  const clearFilters = () => {
    setSearch('');
    const next = new URLSearchParams(latestSearch.current);
    for (const key of ['q', 'status', 'kind', 'category', 'project', 'age']) next.delete(key);
    const query = next.toString();
    latestSearch.current = query ? `?${query}` : '';
    navigate(`${location.pathname}${latestSearch.current}`, { replace: true, state: location.state });
  };
  const hasFilters = Boolean(search || status || kind || category || project !== 'All' || (view === 'outstanding' && age !== 'All'));
  const isNewest = view === 'claims' ? sort === 'newest' : advanceSort === 'newest';
  const sortLabel = view === 'claims'
    ? (isNewest ? t('expenses.sort.newestClaims', 'Newest claims') : t('expenses.sort.oldestClaims', 'Oldest claims'))
    : (isNewest ? t('expenses.sort.newestPayouts', 'Newest payout date') : t('expenses.sort.oldestPayouts', 'Oldest payout date'));

  return (
    <MoneyOutListPage
      title={t('expenses.title', 'Expenses')}
      scope={t('expenses.description', 'Expense claims and cash advances. You see your own; approvers see the whole team.')}
      primaryAction={canCreate && (
        <span className="flex flex-wrap gap-2 max-sm:w-full">
          <Button variant="outline" className="min-h-11" onClick={() => setFormKind('advance')}>{t('expenses.actions.requestAdvance', 'Request advance')}</Button>
          <Button variant="primary" className="min-h-11 max-sm:flex-1" onClick={goToNewClaim}>
            <Icon name="plus" />{t('expenses.actions.newClaim', 'New claim')}
          </Button>
        </span>
      )}
      filters={
        <div data-testid="money-out-toolbar" className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <SearchMini
            placeholder={view === 'claims' ? t('expenses.searchPlaceholder', 'Search claim titles') : t('expenses.searchOutstandingPlaceholder', 'Search outstanding advances')}
            aria-label={view === 'claims' ? t('expenses.searchLabel', 'Search expenses') : t('expenses.searchOutstandingLabel', 'Search outstanding advances')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            containerClassName="h-11 min-w-0 flex-[1_1_14rem]"
          />
          {view === 'claims' && <>
            <SelectField label={t('expenses.filters.status', 'Status')} hideLabel value={status} onChange={(value) => setParam('status', value)} options={statusOptions} className="min-h-11 min-w-36 max-w-full" />
            <SelectField label={t('expenses.filters.kind', 'Type')} hideLabel value={kind} onChange={(value) => setParam('kind', value)} options={kindOptions} className="min-h-11 min-w-36 max-w-full" />
            <SelectField label={t('expenses.filters.category', 'Budget category')} hideLabel value={category} onChange={(value) => setParam('category', value)} options={categoryOptions} className="min-h-11 min-w-40 max-w-full" />
          </>}
          <SelectField label={t('expenses.filters.project', 'Project')} hideLabel value={project} onChange={(value) => setParam('project', value)} options={projectFilterOptions} className="min-h-11 min-w-36 max-w-full" />
          {view === 'outstanding' && <SelectField label={t('expenses.filters.age', 'Payout age')} hideLabel value={age} onChange={(value) => setParam('age', value)} options={ageOptions} className="min-h-11 min-w-36 max-w-full" />}
          <Button
            variant="outline"
            className="min-h-11"
            aria-label={sortLabel}
            onClick={() => setParam(view === 'claims' ? 'sort' : 'advanceSort', isNewest ? 'oldest' : 'newest')}
          >{sortLabel}</Button>
          <div role="group" aria-label={t('expenses.view.label', 'Expense register view')} className="flex min-w-0 flex-wrap gap-2">
            <Button variant={view === 'claims' ? 'secondary' : 'outline'} className="min-h-11" aria-pressed={view === 'claims'} onClick={() => setParam('view', 'claims')}>
              {t('expenses.view.claims', 'Claims and advances')}
            </Button>
            <Button variant={view === 'outstanding' ? 'secondary' : 'outline'} className="min-h-11" aria-pressed={view === 'outstanding'} onClick={() => setParam('view', 'outstanding')}>
              {t('expenses.view.outstanding', 'Outstanding advances')}
            </Button>
          </div>
          {hasFilters && <Button variant="ghost" className="min-h-11" onClick={clearFilters}>{t('expenses.filters.clear', 'Clear filters')}</Button>}
        </div>
      }
    >
      {view === 'outstanding' ? (
        <AdvanceAgingCard active projectId={project} query={search} age={age} sortOrder={advanceSort} />
      ) : isPending ? (
        <ListState variant="loading" rows={6} />
      ) : isError || !data ? (
        <ListState
          variant="error"
          title={t('expenses.states.errorTitle', "Couldn't load expenses")}
          sub={t('expenses.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <ListState
          variant="empty"
          title={hasFilters ? t('expenses.table.noMatch', 'No expenses match these filters') : t('expenses.table.emptyTitle', 'No expenses here yet')}
          sub={hasFilters ? undefined : t('expenses.table.emptySub', 'File a claim after the work, or request an advance before it.')}
          action={!hasFilters && canCreate ? { label: t('expenses.actions.newClaim', 'New claim'), onClick: goToNewClaim } : undefined}
        />
      ) : (
        <>
          {data.truncated && <p role="status" className="mb-2 text-sm text-muted-foreground">
            {t('expenses.truncated', 'Showing the latest {{count}} matching records. Refine search or filters to find other records.', { count: EXPENSE_LIST_LIMIT })}
          </p>}
          <DataTable<ExpenseClaimWithRefs>
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onActivate={(r) => openRecord(r.id)}
            rowLabel={(r) => t('expenses.table.rowLabel', 'Open {{title}}', { title: r.title })}
            tableId="expenseclaims-table"
          />
        </>
      )}
      {formKind && (
        <ExpenseClaimFormModal
          kind={formKind}
          projectOptions={projectOptions}
          advanceOptions={advanceOptions}
          onClose={() => setFormKind(null)}
          onSubmit={async (input) => {
            const claimId = (await create.mutateAsync(input)).id;
            toast(t('expenses.toast.created', 'Created'), input.title, 'success');
            setFormKind(null);
            openRecord(claimId);
          }}
        />
      )}
    </MoneyOutListPage>
  );
};

export default ExpenseClaims;
