import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { formatCurrency, formatNumberExact } from '@/src/lib/format';
import { isActualComplete } from '@/src/lib/projectFinances';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import type { TopProject } from '@/src/lib/db/dashboard';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { revealDashboardNote } from './dashboardNote';
import { executiveRiskState, sortExecutiveProjects } from './executiveProjectOrder';

export interface BvACardProps {
  projects: TopProject[];
  /** Org operating currency (the top-projects RPC carries no per-row currency). */
  currency: string;
  isPending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** The delivery comparison keeps record identity, status, known money, and its open action together. */
export const BvACard: React.FC<BvACardProps> = ({ projects, currency, isPending = false, isError = false, onRetry }) => {
  const { t } = useTranslation();
  const statusLabel = useProjectStatusLabel();
  const narrow = useIsNarrow();
  const rows = useMemo(() => sortExecutiveProjects(projects), [projects]);
  const groups = useMemo(() => {
    const grouped = new Map<string, TopProject[]>();
    for (const project of rows) {
      const projectCurrency = project.currency || currency || 'USD';
      const group = grouped.get(projectCurrency) ?? [];
      group.push(project);
      grouped.set(projectCurrency, group);
    }
    return [...grouped.entries()];
  }, [rows, currency]);
  const money = (value: number | null, rowCurrency: string, groupCurrency: string) => {
    if (value === null || !Number.isFinite(value)) return null;
    const code = rowCurrency || groupCurrency || currency;
    return code === groupCurrency ? formatNumberExact(value) : formatCurrency(value, code);
  };

  const columnsFor = (groupCurrency: string): Column<TopProject>[] => [
    {
      key: 'project',
      header: t('dashboard:exec.project', 'Project'),
      kind: 'primary',
      rowHeader: true,
      cell: (project) => (
        <Link
          to={`/projects/${project.id}`}
          className="inline-flex min-h-11 min-w-0 items-center text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="break-words">{project.name}</span>
        </Link>
      ),
    },
    {
      key: 'statusRisk',
      header: t('dashboard:exec.status', 'Status'),
      kind: 'status',
      cell: (project) => {
        const risk = executiveRiskState(project);
        return (
          <div className="inline-flex min-w-0 items-center gap-1 text-sm">
            <span>{project.status === 'Ongoing Project' ? t('dashboard:exec.ongoing', 'Ongoing') : statusLabel(project.status)}</span>
            {risk === 'at-risk' && <><span aria-hidden="true" className="mx-1 size-1.5 rounded-full bg-warning" /><span>{t('common:dashboard.bva.atRisk', 'At risk')}</span></>}
            {risk === 'unchecked' && <sup><a href="#executive-data-note" onClick={revealDashboardNote} aria-label={t('dashboard:exec.riskUncheckedSeeNote', 'Risk not checked; see portfolio data note')} className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-semibold text-muted-foreground underline underline-offset-2">1</a></sup>}
          </div>
        );
      },
    },
    {
      key: 'actual',
      header: t('dashboard:exec.knownActual', 'Known Actual'),
      kind: 'money',
      align: 'num',
      cell: (project) => {
        const actualCurrency = project.actual_currency ?? project.currency;
        const actualComplete = isActualComplete({
          basis: 'erp',
          readSucceeded: project.spent !== null,
          complete: project.actual_complete,
          coverageCount: project.actual_coverage_count,
          coverageTotal: project.actual_coverage_total,
        });
        const actual = money(actualComplete ? project.spent : null, actualCurrency, groupCurrency);
        const comparable = actualComplete && project.spent !== null
          && project.contract_value !== null && project.contract_value > 0
          && actualCurrency === project.currency;
        const progress = comparable
          ? Math.min(100, Math.max(0, Math.round((project.spent! / project.contract_value!) * 100)))
          : null;
        return (
          <div className="flex min-w-[7rem] flex-col gap-1 text-right">
            {actual === null ? <a className="inline-flex min-h-11 min-w-11 items-center justify-end" href="#executive-data-note" onClick={revealDashboardNote} aria-label={t('dashboard:exec.actualUnavailable', 'Actual unavailable; see coverage note')}>—</a> : <span className="inline-block whitespace-nowrap">{actual}</span>}
            {progress !== null && <ProgressBar value={progress} widthless className="w-full [&>span:first-child]:flex-1" aria-label={t('dashboard:exec.actualOfContract', '{{project}}: {{percent}}% of contract', { project: project.name, percent: progress })} />}
          </div>
        );
      },
    },
    {
      key: 'contract',
      header: t('dashboard:exec.contract', 'Contract'),
      kind: 'money',
      align: 'num',
      cell: (project) => {
        const value = money(project.contract_value, project.currency, groupCurrency);
        return value === null
          ? <a className="inline-flex min-h-11 items-center" href="#executive-data-note" onClick={revealDashboardNote} aria-label={t('dashboard:exec.contractUnavailable', 'Contract value unavailable; see data note')}>—</a>
          : <span className="inline-block whitespace-nowrap">{value}</span>;
      },
    },

  ];

  return (
    <section aria-labelledby="executive-spending-title" className="space-y-4 [&_tbody_td]:h-11 [&_tbody_td]:py-0 [&_tbody_th]:h-11 [&_tbody_th]:py-0">
      <div className="space-y-2">
        <h3 id="executive-spending-title" className="text-xl font-bold">{t('dashboard:exec.spendingComparison', 'Spending comparison')}{groups.length === 1 ? ` · ${groups[0][0]}` : ''}</h3>
        <p className="text-sm text-muted-foreground">{t('dashboard:exec.sortAtRiskFirst', 'At-risk projects first, then project name')}</p>
      </div>
      {groups.map(([groupCurrency, groupRows]) => (
        <section key={groupCurrency} aria-label={groupCurrency}>
          {groups.length > 1 && <h4 id={`executive-spending-${groupCurrency.toLowerCase()}`} className="mb-4 text-xl font-bold">{groupCurrency}</h4>}
          {narrow && !isPending && !isError ? (
            <ul aria-label={t('dashboard:exec.spendingComparisonForCurrency', '{{currency}} spending comparison', { currency: groupCurrency })} className="divide-y divide-border">
              {groupRows.map((project) => {
                const columns = columnsFor(groupCurrency);
                return <li key={project.id} className="space-y-2 py-3 text-sm">
                  <div className="font-semibold">{columns[0].cell(project)}</div>
                  {columns[1].cell(project)}
                  <div className="flex flex-wrap items-baseline gap-x-1 gap-y-2 tabular font-semibold">
                    <span className="font-normal">{t('dashboard:exec.actualShort', 'Actual')}</span>
                    {money(isActualComplete({ basis: 'erp', readSucceeded: project.spent !== null, complete: project.actual_complete, coverageCount: project.actual_coverage_count, coverageTotal: project.actual_coverage_total }) ? project.spent : null, project.actual_currency ?? project.currency, groupCurrency) ?? <a href="#executive-data-note" onClick={revealDashboardNote} className="inline-flex min-h-11 min-w-11 items-center" aria-label={t('dashboard:exec.actualUnavailable', 'Actual unavailable; see coverage note')}>—</a>}
                    <span className="font-normal"> · {t('dashboard:exec.contract', 'Contract')}</span>{columns[3].cell(project)}
                  </div>
                </li>;
              })}
            </ul>
          ) : (
          <DataTable<TopProject>
            rows={groupRows}
            columns={columnsFor(groupCurrency)}
            rowKey={(project) => project.id}
            accessibleName={t('dashboard:exec.spendingComparisonForCurrency', '{{currency}} spending comparison', { currency: groupCurrency })}
            state={isPending ? 'loading' : isError ? 'error' : groupRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('uxs03.deliveryChartEmpty', 'No delivery projects to compare yet')}
            errorTitle={t('dashboard:exec.projectDataError', "Couldn't load project comparison")}
            onRetry={onRetry}
            tableId={`components-dashboard-executive-delivery-v2-${groupCurrency.toLowerCase()}`}
          />
          )}
        </section>
      ))}
      {groups.length === 0 && (isPending || isError || projects.length === 0) && (
        <DataTable<TopProject>
          rows={[]}
          columns={columnsFor(currency)}
          rowKey={(project) => project.id}
          accessibleName={t('dashboard:exec.spendingComparison', 'Spending comparison')}
          state={isPending ? 'loading' : isError ? 'error' : 'empty'}
          emptyTitle={t('uxs03.deliveryChartEmpty', 'No delivery projects to compare yet')}
          errorTitle={t('dashboard:exec.projectDataError', "Couldn't load project comparison")}
          onRetry={onRetry}
          tableId="components-dashboard-executive-delivery-v2-empty"
        />
      )}
    </section>
  );
};
