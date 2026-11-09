import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/src/components/ui/Avatar';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill, type StatusVariant } from '@/src/components/ui/StatusPill';
import { ViewToggle } from '@/src/components/ui/ViewToggle';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCurrency } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { ACTIVE_PROJECT_STATUSES, type ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetReviewRow } from '@/src/lib/db/dashboard';

const SHOWN = 5;
type Scope = 'risk' | 'all';

export interface ActiveProjectsTableProps {
  projects: ProjectWithRefs[];
  /** Active-budget rows: the budget and recorded spending behind "Budget used". */
  budgets: BudgetReviewRow[];
  /** Project ids the server ranked as needing attention, most urgent first. */
  attentionIds: string[];
  statusVariant: (status: string) => StatusVariant;
}

/** Budget used, as a whole percent — only when spending is complete and in the budget's currency (else unknown, never 0). */
const budgetUsed = (row: BudgetReviewRow | undefined) => row && row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? Math.round((row.spent / row.budget) * 100) : null;

/** The delivery projects in progress: at-risk ones first (the server's ranking), then the biggest contracts. */
export const ActiveProjectsTable: React.FC<ActiveProjectsTableProps> = ({ projects, budgets, attentionIds, statusVariant }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const [scope, setScope] = React.useState<Scope>('risk');
  const active = React.useMemo(() => {
    const live = new Set<string>(ACTIVE_PROJECT_STATUSES);
    const rank = new Map(attentionIds.map((id, index) => [id, index]));
    return projects.filter((project) => live.has(project.status)).sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || (b.contract_value ?? 0) - (a.contract_value ?? 0));
  }, [projects, attentionIds]);
  const budgetById = React.useMemo(() => new Map(budgets.map((row) => [row.id, row])), [budgets]);
  const rows = scope === 'all' ? active : active.slice(0, SHOWN);
  const columns: Column<ProjectWithRefs>[] = [
    { key: 'project', header: t('hub.company.project', 'Project'), rowHeader: true, cell: (row) => <span className="font-semibold">{projectDisplayName(row)}</span>, secondaryCell: (row) => row.client?.short_name ?? row.client?.name ?? '', exportValue: projectDisplayName },
    { key: 'pm', header: t('hub.company.activeProjects.pm', 'PM'), cell: (row) => row.pm?.full_name ? <Avatar name={row.pm.full_name} size="sm" /> : <span aria-hidden>—</span>, exportValue: (row) => row.pm?.full_name ?? '' },
    { key: 'contract', header: t('hub.company.planVsActual.plan', 'Contract'), kind: 'money', align: 'num', cell: (row) => row.contract_value == null ? '—' : formatCurrency(row.contract_value, row.currency), exportValue: (row) => row.contract_value ?? '' },
    { key: 'used', header: t('hub.company.activeProjects.budgetUsed', 'Budget used'), cell: (row) => { const pct = budgetUsed(budgetById.get(row.id)); return pct === null ? <span aria-hidden>—</span> : <div className="flex min-w-28 items-center gap-2"><ProgressBar value={pct} widthless className="min-w-10 flex-1" aria-label={t('hub.company.usedAria', '{{percent}}% of contract used', { percent: pct })} /><span className="tabular">{pct}%</span></div>; }, exportValue: (row) => budgetUsed(budgetById.get(row.id)) ?? '' },
    { key: 'status', header: t('hub.company.status', 'Status'), cell: (row) => <StatusPill variant={statusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>, exportValue: (row) => statusLabel(row.status) },
  ];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('hub.company.activeProjects.showing', 'Showing {{shown}} of {{total}}', { shown: rows.length, total: active.length })}</span>
        <ViewToggle<Scope> className="ml-auto" ariaLabel={t('hub.company.activeProjects.scope', 'Which projects to list')} semantics="toggle" value={scope} onChange={setScope} options={[{ value: 'risk', label: t('hub.company.activeProjects.atRiskFirst', 'At risk first') }, { value: 'all', label: t('hub.company.activeProjects.all', 'All') }]} />
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/projects/${row.id}`)} rowLabel={(row) => t('hub.company.openProject', 'Open project') + ': ' + projectDisplayName(row)} emptyTitle={t('hub.company.activeProjects.empty', 'No active projects')} state={rows.length === 0 ? 'empty' : undefined} tableId="dashboard-company-active-projects" embedded />
    </div>
  );
};
