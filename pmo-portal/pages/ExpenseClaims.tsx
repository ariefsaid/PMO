import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, DataTable, Icon, ListPage, ListState, SelectField, StatusPill, useToast, useUrlFilters, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectChoices } from './expenses/useProjectChoices';
import { useExpenseClaims, useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrency } from '@/src/lib/format';
import {
  EXPENSE_LIST_LIMIT, type BudgetCategory, type ExpenseClaimFilters, type ExpenseClaimStatus,
  type ExpenseClaimWithRefs, type ExpenseKind,
} from '@/src/lib/db/expenseClaims';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { AdvanceAgingCard } from './expenses/AdvanceAgingCard';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';

/**
 * Expenses — claims and cash advances (#775, FR-EXP-060..062). Reads are RLS-scoped: an Engineer sees their own,
 * approval rank sees the org's. Filters are server-side; the list is bounded at 200 with a visible notice.
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
  const { values, setFilter, clear: clearFilters } = useUrlFilters(['status', 'kind', 'category']);
  const status = (VALID_STATUSES as readonly string[]).includes(values.status) ? values.status : '';
  const kind = values.kind;
  const category = values.category;
  const hasActiveFilters = Boolean(status || kind || category);
  const setStatus = (next: string) => setFilter('status', next);
  const setKind = (next: string) => setFilter('kind', next);
  const setCategory = (next: string) => setFilter('category', next);
  const filters = useMemo<ExpenseClaimFilters>(
    () => ({
      ...(status ? { status: status as ExpenseClaimStatus } : {}),
      ...(kind ? { kind: kind as ExpenseKind } : {}),
      ...(category ? { budgetCategory: category as BudgetCategory } : {}),
    }),
    [status, kind, category],
  );
  const { data, isPending, isError, refetch } = useExpenseClaims(filters);
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

  const columns: Column<ExpenseClaimWithRefs>[] = [
    { key: 'claim_number', header: t('expenses.columns.number', 'Number'),
      cell: (r) => <span className="whitespace-nowrap font-medium">{r.claim_number ?? '—'}</span>,
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
      cell: (r) => <span className="tabular-nums">{formatCurrency(Number(r.amount), r.currency, { precision: 'minor' })}</span>,
      exportValue: (r) => Number(r.amount) },
    { key: 'status', header: t('expenses.columns.status', 'Status'),
      cell: (r) => <StatusPill record="expense" state={r.status} />,
      exportValue: (r) => r.status },
  ];

  return (
    <ListPage
      title={t('expenses.title', 'Expenses')}
      count={rows ? rows.length : undefined}
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
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
          <SelectField label={t('expenses.filters.status', 'Status')} hideLabel value={status} onChange={setStatus} options={statusOptions} fullWidth wrapperClassName="w-full sm:w-auto" className="w-full sm:w-auto" />
          <SelectField label={t('expenses.filters.kind', 'Type')} hideLabel value={kind} onChange={setKind} options={kindOptions} fullWidth wrapperClassName="w-full sm:w-auto" className="w-full sm:w-auto" />
          <SelectField label={t('expenses.filters.category', 'Budget category')} hideLabel value={category} onChange={setCategory} options={categoryOptions} fullWidth wrapperClassName="w-full sm:w-auto" className="w-full sm:w-auto" />
        </div>
      }
    >
      <AdvanceAgingCard />
      {isPending && <ListState variant="loading" shape="table" columns={6} rows={6} />}
      {!isPending && (isError || !data) && (
        <ListState
          variant="error"
          title={t('expenses.states.errorTitle', "Couldn't load expenses")}
          sub={t('expenses.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void refetch()}
        />
      )}
      {!isPending && !isError && data && (
        <>
          {data.truncated && (
            <p role="status" className="mb-2 text-sm text-muted-foreground">
              {t('expenses.truncated', 'Showing the latest {{count}}. Narrow the filters to see older records.', { count: EXPENSE_LIST_LIMIT })}
            </p>
          )}
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
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
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
            <DataTable<ExpenseClaimWithRefs>
              rows={rows ?? []}
              columns={columns}
              rowKey={(r) => r.id}
              onActivate={(r) => navigate(`/expenses/${r.id}`)}
              rowLabel={(r) => t('expenses.table.rowLabel', 'Open {{title}}', { title: r.title })}
              tableId="expenseclaims-table"
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
