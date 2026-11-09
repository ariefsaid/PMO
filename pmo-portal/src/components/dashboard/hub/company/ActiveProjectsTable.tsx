import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/src/components/ui/Avatar';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { ListState } from '@/src/components/ui/ListState';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ViewToggle } from '@/src/components/ui/ViewToggle';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import { formatCompactCurrency, formatCurrency } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { ACTIVE_PROJECT_STATUSES, type ProjectWithRefs } from '@/src/lib/db/projects';
import type { AttentionProject, BudgetReviewRow } from '@/src/lib/db/dashboard';
import { attentionSignal } from './attentionSignal';

const SHOWN = 5;
type Scope = 'risk' | 'all';

export interface ActiveProjectsTableProps {
  projects: ProjectWithRefs[];
  /** Active-budget rows: the budget and recorded spending behind "Budget used". */
  budgets: BudgetReviewRow[];
  /** Projects the server ranked as needing attention, most urgent first; their signal is the Status pill. */
  attention: AttentionProject[];
  state?: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
  /** The "Open projects" link, shown in the card header beside the toggle. */
  headerLink?: React.ReactNode;
}

/** Budget used, as a whole percent — only when spending is complete and in the budget's currency (else unknown, never 0). */
const budgetUsed = (row: BudgetReviewRow | undefined) => row && row.actual_complete && row.spent !== null && row.budget > 0 && row.actual_currency === row.currency && row.budget_currency === row.currency ? Math.round((row.spent / row.budget) * 100) : null;

/** The delivery projects in progress: at-risk ones first (the server's ranking), then the biggest contracts. */
export const ActiveProjectsTable: React.FC<ActiveProjectsTableProps> = ({ projects, budgets, attention, state = 'ready', onRetry, headerLink }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const [scope, setScope] = React.useState<Scope>('risk');
  const signalById = React.useMemo(() => new Map(attention.map((row) => [row.id, attentionSignal(row, t)])), [attention, t]);
  const active = React.useMemo(() => {
    const live = new Set<string>(ACTIVE_PROJECT_STATUSES);
    const rank = new Map(attention.map((row, index) => [row.id, index]));
    return projects.filter((project) => live.has(project.status)).sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || (b.contract_value ?? 0) - (a.contract_value ?? 0));
  }, [projects, attention]);
  const budgetById = React.useMemo(() => new Map(budgets.map((row) => [row.id, row])), [budgets]);
  const rows = scope === 'all' ? active : active.slice(0, SHOWN);
  const delivery = useProjectsDeliverySummary(React.useMemo(() => rows.map((row) => row.id), [rows]));
  const columns: Column<ProjectWithRefs>[] = [
    { key: 'project', header: t('hub.company.project', 'Project'), rowHeader: true, cell: (row) => <span className="font-semibold">{projectDisplayName(row)}</span>, secondaryCell: (row) => row.client?.short_name ?? row.client?.name ?? '', exportValue: projectDisplayName },
    { key: 'pm', header: t('hub.company.activeProjects.pm', 'PM'), cell: (row) => row.pm?.full_name ? <Avatar name={row.pm.full_name} size="sm" /> : <span aria-hidden>—</span>, exportValue: (row) => row.pm?.full_name ?? '' },
    { key: 'contract', header: t('hub.company.planVsActual.plan', 'Contract'), kind: 'money', align: 'num', cell: (row) => row.contract_value == null ? '—' : <span title={formatCurrency(row.contract_value, row.currency)}>{formatCompactCurrency(row.contract_value, row.currency)}</span>, exportValue: (row) => row.contract_value ?? '' },
    { key: 'used', header: t('hub.company.activeProjects.budgetUsed', 'Budget used'), cell: (row) => { const pct = budgetUsed(budgetById.get(row.id)); return pct === null ? <span aria-hidden>—</span> : <div className="flex min-w-28 items-center gap-2"><ProgressBar value={pct} tone={pct > 100 ? 'destructive' : 'primary'} widthless className="min-w-10 flex-1" aria-label={t('common:uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: pct })} /><span className="tabular">{pct}%</span></div>; }, exportValue: (row) => budgetUsed(budgetById.get(row.id)) ?? '' },
    { key: 'progress', header: t('hub.company.activeProjects.progress', 'Progress'), kind: 'percent', cell: (row) => {
      if (delivery.isError) return <span aria-hidden>—</span>;
      if (delivery.isPending) return <span className="text-xs text-muted-foreground">…</span>;
      const pct = delivery.data?.[row.id]?.deliveryPct;
      if (pct == null) { const none = t('hub.company.activeProjects.noPhases', 'No phases yet'); return <span role="img" aria-label={none} title={none} className="text-xs text-muted-foreground">—</span>; }
      const rounded = Math.round(pct);
      return <ProgressBar value={rounded} showValue compact tone={rounded >= 100 ? 'success' : 'primary'} aria-label={t('hub.company.activeProjects.deliveryPercent', 'Delivery {{percent}}%', { percent: rounded })} />;
    }, exportValue: (row) => { const pct = delivery.data?.[row.id]?.deliveryPct; return pct == null ? '' : Math.round(pct); } },
    { key: 'status', header: t('hub.company.status', 'Status'), cell: (row) => { const signal = signalById.get(row.id); return signal ? <StatusPill variant={signal.variant}>{signal.label}</StatusPill> : <StatusPill variant="neutral">{statusLabel(row.status)}</StatusPill>; }, exportValue: (row) => signalById.get(row.id)?.label ?? statusLabel(row.status) },
  ];
  return (
    <Card className="min-w-0">
      <CardHead level={2} actions={<div className="flex flex-wrap items-center gap-3">
        <ViewToggle<Scope> ariaLabel={t('hub.company.activeProjects.scope', 'Which projects to list')} semantics="toggle" value={scope} onChange={setScope} options={[{ value: 'risk', label: t('hub.company.activeProjects.atRiskFirst', 'At risk first') }, { value: 'all', label: t('hub.company.activeProjects.all', 'All') }]} />
        {headerLink}
      </div>}>
        <span className="inline-flex flex-wrap items-baseline gap-x-2">{t('hub.company.activeProjects.title', 'Active projects')}<span className="text-xs font-normal text-muted-foreground">{t('hub.company.activeProjects.showing', 'Showing {{shown}} of {{total}}', { shown: rows.length, total: active.length })}</span></span>
      </CardHead>
      <CardPad>
        {state === 'loading' ? <ListState variant="loading" rows={4} /> : state === 'error' ? <ListState variant="error" title={t('hub.company.projectsError', "Couldn't load delivery projects")} onRetry={onRetry} /> : <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} onActivate={(row) => navigate(`/projects/${row.id}`)} rowLabel={(row) => t('hub.company.openProject', 'Open project') + ': ' + projectDisplayName(row)} emptyTitle={t('hub.company.activeProjects.empty', 'No active projects')} state={rows.length === 0 ? 'empty' : undefined} tableId="dashboard-company-active-projects" embedded />}
      </CardPad>
    </Card>
  );
};
