import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, DataTable, Icon, ListPage, ListState, SelectField, StatusPill, parsePageParam, useClampPage, useToast, useUrlFilters, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectChoices } from './expenses/useProjectChoices';
import { useExpenseClaimPages, useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { EXPENSE_PAGE_SIZE } from '@/src/lib/db/expenseClaims';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency } from '@/src/lib/format';
import {
  type BudgetCategory, type ExpenseClaimFilters, type ExpenseClaimStatus,
  type ExpenseClaimListRow, type ExpenseKind,
} from '@/src/lib/db/expenseClaims';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { AdvanceAgingCard } from './expenses/AdvanceAgingCard';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';

/**
 * Expenses — claims and cash advances (#775, FR-EXP-060..062). Reads are RLS-scoped: an Engineer sees their own,
 * approval rank sees the org's. Filters are server-side; the list pages 200 at a time and reads "Showing x of y" (#843).
 */
const ExpenseClaims: React.FC = () => {
  const { t } = useTranslation(['common', 'expenseClaims']);
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  // #1461: the dashboard 'Expense claims returned' figure counts Rejected claims and drills with
  // `?status=Rejected`, so the list opens exactly that set. R2: status/kind/category are all
  // URL-owned (the same hook as Contacts/Incidents), so Back/refresh and a shared link restore
  // them; defaults stay out of the URL (empty = all).
  const VALID_STATUSES = Constants.public.Enums.expense_claim_status;
  const { values, setFilters, clear: clearFilters } = useUrlFilters(['status', 'kind', 'category', 'page']);
  const status = (VALID_STATUSES as readonly string[]).includes(values.status) ? values.status : '';
  const kind = values.kind;
  const category = values.category;
  const hasActiveFilters = Boolean(status || kind || category);
  // A changed filter is a different result set: it starts again at page 1 (#843).
  const setStatus = (next: string) => setFilters({ status: next, page: '' });
  const setKind = (next: string) => setFilters({ kind: next, page: '' });
  const setCategory = (next: string) => setFilters({ category: next, page: '' });
  const page = parsePageParam(values.page);
  const setPage = useCallback((next: number, options?: { replace?: boolean }) => setFilters({ page: next > 1 ? String(next) : '' }, options), [setFilters]);
  const filters = useMemo<ExpenseClaimFilters>(
    () => ({
      ...(status ? { status: status as ExpenseClaimStatus } : {}),
      ...(kind ? { kind: kind as ExpenseKind } : {}),
      ...(category ? { budgetCategory: category as BudgetCategory } : {}),
    }),
    [status, kind, category],
  );
  const { data, total, isPending, isError, refetch } = useExpenseClaimPages(filters, page);
  useClampPage(page, total, EXPENSE_PAGE_SIZE, setPage);
  const listFailed = isError || !data;
  const projectChoices = useProjectChoices();
  const { create } = useExpenseClaimMutations();
  const ownAdvances = useOwnAdvanceOptions();
  const [formKind, setFormKind] = useState<ExpenseKind | null>(null);
  const canCreate = may('create', 'expenseClaim');
  const rows = data?.rows;

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

  // Memoised (#2102): the table's row memo keys on this array's identity, so a toast, a menu or
  // any unrelated re-render must not rebuild it. Only a language change can.
  const columns = useMemo<Column<ExpenseClaimListRow>[]>(() => [
    { key: 'claim_number', header: t('expenses.columns.number', 'Number'),
      cell: (r) => <span className="whitespace-nowrap">{r.claim_number ?? '—'}</span>,
      exportValue: (r) => r.claim_number ?? '' },
    { key: 'kind', header: t('expenses.columns.kind', 'Type'), cell: (r) => expenseKindLabel(r.kind, t), exportValue: (r) => r.kind },
    { key: 'title', header: t('expenses.columns.title', 'Title'),
      cell: (r) => <span className="truncate font-semibold" title={r.title}>{r.title}</span>, exportValue: (r) => r.title },
    { key: 'claimant', header: t('expenses.columns.claimant', 'Claimant'),
      cell: (r) => r.claimant?.full_name ?? '—', exportValue: (r) => r.claimant?.full_name ?? '' },
    { key: 'project', header: t('expenses.columns.project', 'Project'),
      cell: (r) => r.project ? <span title={r.project.name}>{projectDisplayName(r.project)}</span> : t('expenses.overhead', 'Overhead'), exportValue: (r) => r.project?.name ?? '' },
    { key: 'budget_category', header: t('expenses.columns.category', 'Budget category'),
      cell: (r) => (r.budget_category ? budgetCategoryLabel(r.budget_category, t) : '—'), exportValue: (r) => r.budget_category ?? '' },
    { key: 'amount', header: t('expenses.columns.amount', 'Amount'), align: 'num',
      cell: (r) => <span className="tabular-nums">{formatCurrency(Number(r.amount), r.currency, { precision: 'minor' })}</span>,
      exportValue: (r) => Number(r.amount) },
    { key: 'status', header: t('expenses.columns.status', 'Status'),
      cell: (r) => <StatusPill record="expense" state={r.status} />,
      exportValue: (r) => r.status },
  ], [t]);

  return (
    <ListPage
      title={t('expenses.title', 'Expenses')}
      count={total ?? rows?.length}
      primaryAction={
        canCreate && (
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFormKind('advance')}>{t('expenses.actions.requestAdvance', 'Request advance')}</Button>
            <Button variant="primary" onClick={() => navigate('/expenses/new')}>
              <Icon name="plus" />
              {t('expenses.actions.newClaim', 'New claim')}
            </Button>
          </span>
        )
      }
      filters={
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <SelectField label={t('expenses.filters.status', 'Status')} hideLabel value={status} onChange={setStatus} options={statusOptions} wrapperClassName="w-full sm:w-auto" className="w-full sm:w-auto" />
          <SelectField label={t('expenses.filters.category', 'Budget category')} hideLabel value={category} onChange={setCategory} options={categoryOptions} wrapperClassName="w-full sm:w-auto" className="w-full sm:w-auto" />
          <SelectField label={t('expenses.filters.kind', 'Type')} hideLabel value={kind} onChange={setKind} options={kindOptions} wrapperClassName="col-span-2 w-full sm:w-auto" className="w-full sm:w-auto" />
        </div>
      }
    >
      <AdvanceAgingCard />
      {isPending && <ListState variant="loading" shape="table" columns={6} rows={6} />}
      {!isPending && listFailed && (
        <ListState
          variant="error"
          title={t('expenses.states.errorTitle', "Couldn't load expenses")}
          sub={t('expenses.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void refetch()}
        />
      )}
      {!isPending && !listFailed && data && (
        <>
          {(rows ?? []).length === 0 ? (
            <Card clip>
              {/* Ruling 1: the header carries the view's one filled action at every width, so the
                  empty-state copy of New claim is the quiet outline of the shared list state. */}
              <ListState
                variant="empty"
                actionVariant="outline"
                title={hasActiveFilters
                  ? t('expenseClaims:list.filteredEmptyTitle', 'No expenses match these filters')
                  : t('expenses.table.emptyTitle', 'No expenses here yet')}
                sub={hasActiveFilters ? (
                  <Button variant="ghost" size="sm" className="text-primary-text underline underline-offset-2" onClick={clearFilters}>
                    {t('expenseClaims:actions.clearFilters', 'Clear filters')}
                  </Button>
                ) : undefined}
                action={canCreate ? {
                  label: t('expenses.actions.newClaim', 'New claim'),
                  onClick: () => navigate('/expenses/new'),
                } : undefined}
              />
            </Card>
          ) : (
            <DataTable<ExpenseClaimListRow>
              rows={rows ?? []}
              columns={columns}
              rowKey={(r) => r.id}
              onActivate={(r) => navigate(`/expenses/${r.id}`)}
              rowLabel={(r) => t('expenses.table.rowLabel', 'Open {{title}}', { title: r.title })}
              tableId="expenseclaims-table"
              mobileCardTitle={(r) => (
                <span className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-semibold">{r.title}</span>
                  <span className="shrink-0 tabular-nums">{formatCurrency(Number(r.amount), r.currency, { precision: 'minor' })}</span>
                </span>
              )}
              mobileCardDetails={(r) => (
                // Status sits in the line it qualifies (no row of its own); who and which number go last, quieter.
                <div className="min-w-0 space-y-1 text-control text-muted-foreground">
                  <p className="min-w-0 break-words">
                    <StatusPill record="expense" state={r.status} className="mr-2 align-middle" />
                    {[
                      r.project ? projectDisplayName(r.project) : t('expenses.overhead', 'Overhead'),
                      r.budget_category ? budgetCategoryLabel(r.budget_category, t) : null,
                      r.kind === 'advance' ? expenseKindLabel(r.kind, t) : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {(r.claim_number || r.claimant?.full_name) && <p className="min-w-0 break-words">{[r.claim_number, r.claimant?.full_name].filter(Boolean).join(' · ')}</p>}
                </div>
              )}
              total={total}
              pagination={{ page, pageSize: EXPENSE_PAGE_SIZE, onPageChange: setPage }}
            />
          )}
        </>
      )}
      {formKind && (
        <ExpenseClaimFormModal
          kind={formKind}
          projectOptions={projectChoices.options}
          projectLoad={projectChoices}
          advanceOptions={ownAdvances.options}
          advanceLoad={ownAdvances}
          onClose={() => setFormKind(null)}
          onSubmit={async (input) => {
            const claimId = (await create.mutateAsync(input)).id;
            toast(t('expenses.toast.created', 'Created'), input.title, 'success');
            setFormKind(null);
            navigate(`/expenses/${claimId}`);
          }}
        />
      )}
    </ListPage>
  );
};

export default ExpenseClaims;
