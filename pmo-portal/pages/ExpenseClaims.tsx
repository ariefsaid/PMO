import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, ListPage, ListState, SelectField, StatusPill, useToast, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjects } from '@/src/hooks/useProjects';
import { useExpenseClaims, useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
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
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';

/**
 * Expenses — claims and cash advances (#775, FR-EXP-060..062). Reads are RLS-scoped: an Engineer sees their own,
 * approval rank sees the org's. Filters are server-side; the list is bounded at 200 with a visible notice.
 */
const ExpenseClaims: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const filters = useMemo<ExpenseClaimFilters>(
    () => ({
      ...(status ? { status: status as ExpenseClaimStatus } : {}),
      ...(kind ? { kind: kind as ExpenseKind } : {}),
      ...(category ? { budgetCategory: category as BudgetCategory } : {}),
    }),
    [status, kind, category],
  );
  const { data, isPending, isError, refetch } = useExpenseClaims(filters);
  const { data: projects } = useProjects();
  const { create } = useExpenseClaimMutations();
  const advanceOptions = useOwnAdvanceOptions();
  const [formKind, setFormKind] = useState<ExpenseKind | null>(null);
  const canCreate = may('create', 'expenseClaim');
  const rows = data?.rows ?? [];
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: p.name })), [projects]);

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
      cell: (r) => <span className="whitespace-nowrap font-medium">{r.claim_number ?? t('expenses.draftNumber', 'Draft')}</span>,
      exportValue: (r) => r.claim_number ?? '' },
    { key: 'kind', header: t('expenses.columns.kind', 'Type'), cell: (r) => expenseKindLabel(r.kind, t), exportValue: (r) => r.kind },
    { key: 'title', header: t('expenses.columns.title', 'Title'),
      cell: (r) => <span className="truncate" title={r.title}>{r.title}</span>, exportValue: (r) => r.title },
    { key: 'claimant', header: t('expenses.columns.claimant', 'Claimant'),
      cell: (r) => r.claimant?.full_name ?? '—', exportValue: (r) => r.claimant?.full_name ?? '' },
    { key: 'project', header: t('expenses.columns.project', 'Project'),
      cell: (r) => r.project?.name ?? t('expenses.overhead', 'Overhead'), exportValue: (r) => r.project?.name ?? '' },
    { key: 'budget_category', header: t('expenses.columns.category', 'Budget category'),
      cell: (r) => (r.budget_category ? budgetCategoryLabel(r.budget_category, t) : '—'), exportValue: (r) => r.budget_category ?? '' },
    { key: 'amount', header: t('expenses.columns.amount', 'Amount'), align: 'num',
      cell: (r) => <span className="tabular-nums">{formatCurrencyCents(Number(r.amount), r.currency)}</span>,
      exportValue: (r) => Number(r.amount) },
    { key: 'status', header: t('expenses.columns.status', 'Status'),
      cell: (r) => <StatusPill variant={workflowVariant(r.status)}>{expenseStatusLabel(r.status, t)}</StatusPill>,
      exportValue: (r) => r.status },
  ];

  return (
    <ListPage
      title={t('expenses.title', 'Expenses')}
      description={t('expenses.description', 'Expense claims and cash advances. You see your own; approvers see the whole team.')}
      primaryAction={
        canCreate && (
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFormKind('advance')}>{t('expenses.actions.requestAdvance', 'Request advance')}</Button>
            <Button variant="primary" onClick={() => setFormKind('claim')}>
              <Icon name="plus" />
              {t('expenses.actions.newClaim', 'New claim')}
            </Button>
          </span>
        )
      }
      filters={
        <span className="flex flex-wrap gap-2">
          <SelectField label={t('expenses.filters.status', 'Status')} hideLabel value={status} onChange={setStatus} options={statusOptions} />
          <SelectField label={t('expenses.filters.kind', 'Type')} hideLabel value={kind} onChange={setKind} options={kindOptions} />
          <SelectField label={t('expenses.filters.category', 'Budget category')} hideLabel value={category} onChange={setCategory} options={categoryOptions} />
        </span>
      }
    >
      <AdvanceAgingCard />
      {isPending && <ListState variant="loading" rows={6} />}
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
          <DataTable<ExpenseClaimWithRefs>
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onActivate={(r) => navigate(`/expenses/${r.id}`)}
            rowLabel={(r) => t('expenses.table.rowLabel', 'Open {{title}}', { title: r.title })}
            state={rows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('expenses.table.emptyTitle', 'No expenses here yet')}
            emptySub={t('expenses.table.emptySub', 'File a claim after the work, or request an advance before it.')}
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
            const created = await create.mutateAsync(input);
            toast(t('expenses.toast.created', 'Created'), input.title, 'success');
            setFormKind(null);
            navigate(`/expenses/${created.id}`);
          }}
        />
      )}
    </ListPage>
  );
};

export default ExpenseClaims;
