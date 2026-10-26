import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { formatCurrency, formatNumberExact } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { isActualComplete } from '@/src/lib/projectFinances';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { pillVariantForProjectStatus } from '@/components/projects';
import type { TopProject } from '@/src/lib/db/dashboard';
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
  const rows = useMemo(() => sortExecutiveProjects(projects), [projects]);
  const groups = useMemo(() => {
    const grouped = new Map<string, TopProject[]>();
    for (const project of rows) {
      const group = grouped.get(project.currency) ?? [];
      group.push(project);
      grouped.set(project.currency, group);
    }
    return [...grouped.entries()];
  }, [rows]);
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
          title={projectDisplayName(project) !== project.name ? project.name : undefined}
          className="inline-flex min-h-11 min-w-0 items-center font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="break-words">{projectDisplayName(project)}</span>
        </Link>
      ),
    },
    {
      key: 'statusRisk',
      header: t('dashboard:exec.statusRisk', 'Status / risk'),
      kind: 'status',
      cell: (project) => {
        const risk = executiveRiskState(project);
        return (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <StatusPill variant={pillVariantForProjectStatus(project.status)}>{statusLabel(project.status)}</StatusPill>
            {risk === 'at-risk' && <StatusPill variant="warn">{t('common:dashboard.bva.atRisk', 'At risk')}</StatusPill>}
            {risk === 'within-budget' && <span className="text-xs text-muted-foreground">{t('dashboard:exec.withinBudget', 'Within budget')}</span>}
            {risk === 'unchecked' && (
              <a href="#executive-data-note" className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {t('dashboard:exec.riskUnchecked', 'Risk not checked')}
              </a>
            )}
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
          <div className="min-w-[7rem] space-y-1">
            {actual === null ? <a className="inline-flex min-h-11 min-w-11 items-center justify-center" href="#executive-actual-note" aria-label={t('dashboard:exec.actualUnavailable', 'Actual unavailable; see coverage note')}>—</a> : <span className="inline-block whitespace-nowrap">{actual}</span>}
            {progress !== null && <ProgressBar value={progress} widthless className="w-full [&>span:first-child]:flex-1" aria-label={t('dashboard:exec.actualOfContract', '{{project}}: {{percent}}% of contract', { project: projectDisplayName(project), percent: progress })} />}
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
          ? <a className="inline-flex min-h-11 items-center" href="#executive-data-note" aria-label={t('dashboard:exec.contractUnavailable', 'Contract value unavailable; see data note')}>—</a>
          : <span className="inline-block whitespace-nowrap">{value}</span>;
      },
    },
    {
      key: 'open',
      header: t('dashboard:exec.open', 'Open'),
      kind: 'actions',
      cell: (project) => (
        <Link
          to={`/projects/${project.id}`}
          aria-label={t('dashboard:exec.openProject', 'Open {{project}}', { project: projectDisplayName(project) })}
          className={buttonClasses('outline', 'default', 'min-h-11 px-3')}
        >
          {t('dashboard:exec.open', 'Open')}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {groups.map(([groupCurrency, groupRows]) => (
        <section key={groupCurrency} aria-labelledby={`executive-spending-${groupCurrency.toLowerCase()}`}>
          <h3 id={`executive-spending-${groupCurrency.toLowerCase()}`} className="mb-2 text-xl font-bold">
            {t('dashboard:exec.spendingCurrencyGroup', '{{currency}} spending comparison', { currency: groupCurrency })}
          </h3>
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
    </div>
  );
};
