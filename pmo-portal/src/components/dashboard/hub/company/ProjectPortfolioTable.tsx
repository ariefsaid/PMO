import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column, type SortState } from '@/src/components/ui/DataTable';
import type { ProjectPortfolioRow } from '@/src/lib/projectPortfolio';
import { sortPortfolioRows } from '@/src/lib/projectPortfolio';
import { formatTableMoney } from '@/src/lib/format';

export const ProjectPortfolioTable: React.FC<{
  rows: ProjectPortfolioRow[];
  pending: boolean;
  error: boolean;
  retry: () => void;
}> = ({ rows, pending, error, retry }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortState>({ key: 'risk', dir: 'desc' });
  const sorted = useMemo(() => sortPortfolioRows(rows, sort as Parameters<typeof sortPortfolioRows>[1]), [rows, sort]);
  const columns = useMemo<Column<ProjectPortfolioRow>[]>(() => [
    { key: 'name', header: t('home.portfolioProject', 'Project'), rowHeader: true, sortKey: 'name', cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: 'spent', header: t('home.portfolioSpent', 'Spent'), kind: 'money', align: 'num', sortKey: 'spent', keepWhenBlank: true, cell: (row) => row.spent === null || !row.actualCurrency ? '—' : formatTableMoney(row.spent, row.actualCurrency, { code: true }) },
    { key: 'budget', header: t('home.portfolioBudget', 'Active budget'), kind: 'money', align: 'num', sortKey: 'budget', keepWhenBlank: true, cell: (row) => row.budget === null || !row.budgetCurrency ? <span className="text-muted-foreground">{t('home.noActiveBudget', 'No active budget')}</span> : formatTableMoney(row.budget, row.budgetCurrency, { code: true }) },
    { key: 'contract', header: t('home.portfolioContract', 'Contract value'), kind: 'money', align: 'num', sortKey: 'contractValue', keepWhenBlank: true, cell: (row) => row.contractValue === null || !row.contractCurrency ? '—' : formatTableMoney(row.contractValue, row.contractCurrency, { code: true }) },
    { key: 'billed', header: t('home.portfolioBilled', 'Billed'), kind: 'money', align: 'num', sortKey: 'billed', keepWhenBlank: true, cell: (row) => row.billed === null || !row.contractCurrency ? '—' : formatTableMoney(row.billed, row.contractCurrency, { code: true }) },
    { key: 'done', header: t('home.portfolioDone', 'Milestones done'), kind: 'number', align: 'num', sortKey: 'doneMilestones', keepWhenBlank: true, cell: (row) => row.doneMilestones === null || row.totalMilestones === null ? '—' : `${row.doneMilestones} / ${row.totalMilestones}` },
    { key: 'late', header: t('home.portfolioLate', 'Milestones late'), kind: 'number', align: 'num', sortKey: 'lateMilestones', keepWhenBlank: true, cell: (row) => row.lateMilestones ?? '—' },
    { key: 'planned', header: t('home.portfolioPlanned', 'Planned progress'), kind: 'percent', align: 'num', sortKey: 'plannedPct', keepWhenBlank: true, cell: (row) => row.plannedPct === null ? '—' : `${Math.round(row.plannedPct)}%` },
    { key: 'actual', header: t('home.portfolioActual', 'Actual progress'), kind: 'percent', align: 'num', sortKey: 'actualPct', keepWhenBlank: true, cell: (row) => row.actualPct === null ? '—' : `${Math.round(row.actualPct)}%` },
  ], [t]);
  const setSortBy = (key: string) => setSort((current) => ({ key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <section aria-labelledby="project-portfolio-title" data-testid="project-portfolio-table">
      <h2 id="project-portfolio-title" className="mb-2 text-[16px] font-semibold">{t('home.portfolioTitle', 'Project portfolio')}</h2>
      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(row) => row.id}
        onActivate={(row) => navigate(`/projects/${row.id}`)}
        rowHref={(row) => `/projects/${row.id}`}
        rowLabel={(row) => t('home.openProject', 'Open {{name}}', { name: row.name })}
        accessibleName={t('home.portfolioTitle', 'Project portfolio')}
        sort={sort}
        onSort={setSortBy}
        state={pending ? 'loading' : error ? 'error' : sorted.length === 0 ? 'empty' : undefined}
        onRetry={retry}
        emptyTitle={t('home.portfolioEmpty', 'No active delivery projects')}
        errorTitle={t('home.portfolioError', "Couldn't load the project portfolio")}
        className="overflow-hidden rounded-md border border-border"
        tableId="dashboard-project-portfolio"
        cardBelow={520}
      />
    </section>
  );
};
