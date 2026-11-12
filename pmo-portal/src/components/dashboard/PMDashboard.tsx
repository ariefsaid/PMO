import React, { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useHomeLayout } from '@/src/hooks/useHomeLayout';
import { usePMDashboardProjects } from '@/src/hooks/useDashboard';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useProjectBudgetPositions } from '@/src/hooks/useProjectBudgetPositions';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { usePMOverdueTasks } from '@/src/hooks/usePMOverdueTasks';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { INTERNAL_STATUSES, ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { expenseClaimsAwaitingKey } from '@/src/hooks/approvalsQueryKeys';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useNeedsYou } from './restructure/useNeedsYou';
import { Button } from '@/src/components/ui/Button';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { ListState } from '@/src/components/ui/ListState';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { Icon } from '@/src/components/ui/icons';
import { BarList, ChartCard, SeriesKey, type BarRow } from './charts';
import { CardLink } from './hub/company/OverviewCards';
import { cn } from '@/src/components/ui/cn';
import { moneyTileValue } from './dashMoney';
import { DashboardWaitsOnYou, ProjectRows, type ProjectRow, type WaitRow } from './DashParts';
import { PlanVsActualChart } from './hub/company/PlanVsActualChart';
import {
  formatHours,
  projectAtRisk,
  projectBudgetUsagePct,
  sumAwaitingTimesheetHours,
} from './hub/pm/metrics';

const DELIVERY_PROJECT_STATUSES = new Set([...ON_HAND_STATUSES, ...INTERNAL_STATUSES]);
/** #1461: the drill lands on exactly the figure's set — my delivery projects (the figure's
 *  universe is get_pm_dashboard_projects ∩ delivery statuses), so the URL carries both the
 *  delivery filter and my PM id. */
const projectsHref = (userId: string | null | undefined) =>
  userId ? `/projects?filter=delivery&pm=${encodeURIComponent(userId)}` : '/projects?filter=delivery';

/** Project Manager home: what waits on me, my projects worst first, my contract value. */
export const PMDashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const projectsQuery = usePMDashboardProjects();
  const overdueTaskProjectIds = useMemo(() => (projectsQuery.data ?? []).map((project) => project.id), [projectsQuery.data]);
  const overdueTasksQuery = usePMOverdueTasks(overdueTaskProjectIds, projectsQuery.data !== undefined);
  const overdueOrgDay = useFxOrgDay(true);
  const deliveryQuery = useProjectsDelivery((projectsQuery.data ?? []).map((project) => project.id));
  const timesheetsQuery = useTimesheetsAwaitingApproval();
  const procurementsQuery = useProcurements({ status: 'Requested' });
  const needs = useNeedsYou('Project Manager');
  const orgCurrency = useOrgCurrency();
  const overview = useHomeLayout().homeLayout === 'overview';

  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => DELIVERY_PROJECT_STATUSES.has(project.status)),
    [projectsQuery.data],
  );
  const budgetPositionsQuery = useProjectBudgetPositions(projects.map((project) => project.id));
  const budgetPositions = useMemo(() => budgetPositionsQuery.data ?? {}, [budgetPositionsQuery.data]);
  const budgetPositionsPending = budgetPositionsQuery.isPending && budgetPositionsQuery.fetchStatus !== 'idle';
  const projectIds = useMemo(() => new Set(projects.map((project) => project.id)), [projects]);
  const assignedProjectIds = useMemo(() => new Set((projectsQuery.data ?? []).map((project) => project.id)), [projectsQuery.data]);
  const procurementsAwaiting = useMemo(
    () => pendingProcurementApprovals(procurementsQuery.data, userId, realRole === 'Admin')
      .filter((procurement) => procurement.project_id !== null && projectIds.has(procurement.project_id)),
    [procurementsQuery.data, projectIds, realRole, userId],
  );
  const purchasesByProject = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const procurement of procurementsAwaiting) {
      if (procurement.project_id) grouped.set(procurement.project_id, (grouped.get(procurement.project_id) ?? 0) + 1);
    }
    return grouped;
  }, [procurementsAwaiting]);

  // Worst first: at risk, then most overdue tasks, then most purchases to approve. Projects that need nothing sort last.
  const rows = useMemo<ProjectRow[]>(() => {
    const score = (projectId: string, atRisk: boolean) =>
      (atRisk ? 1_000 : 0) + (needs.pmOverdueTasksByProject[projectId] ?? 0) * 10 + (purchasesByProject.get(projectId) ?? 0);
    return [...projects].sort((a, b) => score(b.id, projectAtRisk(budgetPositions[b.id], b.currency)) - score(a.id, projectAtRisk(budgetPositions[a.id], a.currency))).map((project) => {
      const overdue = needs.pmOverdueTasksByProject[project.id] ?? 0;
      const purchases = purchasesByProject.get(project.id) ?? 0;
      const reading = budgetPositions[project.id];
      const atRisk = projectAtRisk(reading, project.currency);
      const reason = [
        overdue > 0 ? t('home.overdueTasks', { count: overdue, defaultValue_one: '{{count}} task overdue', defaultValue_other: '{{count}} tasks overdue' }) : null,
        purchases > 0 ? t('home.purchasesToApprove', { count: purchases, defaultValue_one: '{{count}} purchase to approve', defaultValue_other: '{{count}} purchases to approve' }) : null,
        atRisk ? t('home.budgetNinety', 'budget used before tax at 90% or more') : null,
      ].filter(Boolean).join(' · ');
      const delivery = deliveryQuery.data?.[project.id];
      return {
        id: project.id,
        name: projectDisplayName(project),
        title: projectDisplayName(project) !== project.name ? project.name : undefined,
        reason: reason || null,
        delivery: delivery !== undefined && Number.isFinite(delivery) ? delivery : null,
        budgetUsed: projectBudgetUsagePct(reading, project.currency),
        status: project.status,
        offTrack: atRisk || overdue > 0,
        href: `/projects/${project.id}`,
      };
    });
  }, [budgetPositions, deliveryQuery.data, needs.pmOverdueTasksByProject, projects, purchasesByProject, t]);

  // Position: my contract value. Any contract missing draws nothing and is reported once under the title.
  const contractTotals = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const project of projects) {
      if (project.contract_value === null || !Number.isFinite(project.contract_value) || !project.currency) return null;
      byCurrency.set(project.currency, (byCurrency.get(project.currency) ?? 0) + project.contract_value);
    }
    return [...byCurrency].map(([currency, amount]) => ({ currency, amount }));
  }, [projects]);
  const contract = moneyTileValue(projects.length === 0 ? null : contractTotals, orgCurrency);
  const approvedHours = sumAwaitingTimesheetHours(timesheetsQuery.data);

  const refresh = useCallback(() => {
    void projectsQuery.refetch();
    if (projectIds.size > 0) void deliveryQuery.refetch();
    if (projectIds.size > 0) void budgetPositionsQuery.refetch();
    void timesheetsQuery.refetch();
    void procurementsQuery.refetch();
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const [key, queryOrgId, recordId] = query.queryKey;
        if (queryOrgId !== orgId) return false;
        if (key === 'fx-context' || key === 'fx-org-day') return true;
        return typeof recordId === 'string' && key === 'tasks' && assignedProjectIds.has(recordId);
      },
    });
    void queryClient.invalidateQueries({ queryKey: expenseClaimsAwaitingKey(orgId) });
    void queryClient.invalidateQueries({ queryKey: ['timesheets-awaiting', orgId, userId] });
  }, [assignedProjectIds, budgetPositionsQuery, deliveryQuery, orgId, projectIds, projectsQuery, procurementsQuery, queryClient, timesheetsQuery, userId]);

  const budgetUseStatus = budgetPositionsQuery.isError
    ? <span className="inline-flex items-center gap-2" role="status">
      <span>{t('home.budgetUseError', "Budget use couldn't be checked.")}</span>
      <Button variant="ghost" size="sm" onClick={() => void budgetPositionsQuery.refetch()}>{t('home.retry', 'Retry')}</Button>
    </span>
    : budgetPositionsPending
      ? t('home.budgetUseChecking', 'Checking budget use…')
      : undefined;

  const waitRows: WaitRow[] = needs.items
    .filter((item) => ['approvals', 'team-timesheets'].includes(item.id))
    .map((item) => ({
      id: item.id,
      count: item.countLabel ?? item.count,
      label: item.label,
      amount: item.id === 'team-timesheets' && approvedHours !== null ? `${formatHours(approvedHours)} ${t('home.hoursUnit', 'h')}` : undefined,
      href: item.href,
      tone: item.tone === 'lost' ? 'lost' as const : item.tone === 'neutral' ? 'neutral' as const : 'warn' as const,
    }));
  const projectsError = projectsQuery.isError;
  const projectsPending = projectsQuery.isPending;

  const header = (
    <div>
      <PageHeader
        className="mb-2"
        title={t('hub.pm.title', 'My dashboard')}
        help={t('home.pm.help', 'Delivery projects assigned to you. Budget used follows each project’s canonical consumption reading against the active budget before tax; incomplete readings are hidden.')}
        action={<Button variant="outline" size="sm" onClick={refresh} aria-label={t('hub.pm.refresh', 'Refresh')}><Icon name="refresh" /><span className="hidden sm:inline">{t('hub.pm.refresh', 'Refresh')}</span></Button>}
      />
      <FigureHiddenLine compact />
    </div>
  );
  const waitsEl = <DashboardWaitsOnYou rows={waitRows} pending={needs.isPending} error={needs.isError} onRetry={refresh} />;
  const projectsEl = (
    <ProjectRows
      title={t('home.myProjects', 'My projects')}
      rows={rows}
      pending={projectsPending}
      error={projectsError}
      onRetry={refresh}
      footer={budgetUseStatus}
      allLink={{ to: projectsHref(userId), label: t('home.allMine', 'All {{count}} projects', { count: projects.length }) }}
      emptyLabel={t('hub.pm.noProjects', 'No delivery projects assigned to you yet')}
      testId="pm-projects"
    />
  );
  const contractTile = (
    <KPITile
      testId="kpi-my-contract-value"
      tone="green"
      icon="dollar"
      label={t('hub.pm.myContractValue', 'My contract value')}
      value={contract?.value ?? null}
      exactValue={contract?.exact}
      unavailableReason={contract ? undefined : projectsError || projectsQuery.isError ? t('hub.pm.projectsFigureUnavailable', 'Project data could not be loaded. Retry to refresh this figure.') : t('home.reasonMyContract', 'a project contract value is missing')}
      caption={contract ? t('home.projectCount', { count: projects.length, defaultValue_one: '{{count}} project', defaultValue_other: '{{count}} projects' }) : undefined}
      loading={projectsQuery.isPending}
      to={projectsHref(userId)}
      linkLabel={t('hub.pm.openMyProjects', 'Open my projects')}
      help={t('hub.pm.contractHelp', 'Contract value for your delivery projects, in each project currency; currencies are not converted or added together.')}
    />
  );

  if (overview) {
    const hoursItem = needs.items.find((item) => item.id === 'team-timesheets');
    const overdueItem = needs.items.find((item) => item.id === 'overdue-project-tasks');
    const used = rows.filter((row) => row.delivery !== null || row.budgetUsed !== null);
    const pctBars: BarRow[] = used.slice(0, 6).map((row) => ({
      id: row.id,
      name: row.name,
      value: row.delivery,
      label: row.delivery === null ? undefined : `${Math.round(row.delivery)}%`,
      tone: 'accent' as const,
      value2: row.budgetUsed,
      label2: row.budgetUsed === null ? undefined : `${Math.round(row.budgetUsed)}%`,
      tone2: (row.budgetUsed !== null && row.budgetUsed > 100 ? 'bad' : 'neutral') as 'bad' | 'neutral',
    }));
    const overdueBars: BarRow[] = rows.filter((row) => (needs.pmOverdueTasksByProject[row.id] ?? 0) > 0)
      .sort((a, b) => (needs.pmOverdueTasksByProject[b.id] ?? 0) - (needs.pmOverdueTasksByProject[a.id] ?? 0)).slice(0, 6)
      .map((row) => ({ id: row.id, name: row.name, value: needs.pmOverdueTasksByProject[row.id], label: String(needs.pmOverdueTasksByProject[row.id]), tone: 'bad' as const }));
    const deliveryName = t('home.chartDelivery', 'Delivery');
    const budgetName = t('home.colBudget', 'Budget used before tax');
    const overdueTitle = t('home.overdueByProject', 'Overdue tasks by project');
    const planTitle = t('hub.company.planVsActual.title', 'Plan vs actual');
    return (
      <FigureScope>
        <div className="space-y-[var(--space-panel-gap)]" data-home-layout="overview">
          {header}
          <div className="grid items-start gap-[var(--space-panel-gap)] min-[900px]:items-stretch min-[900px]:grid-cols-3">
            <div className="min-w-0 min-[900px]:[&>div]:h-full">{waitsEl}</div>
            <div className="min-w-0 min-[900px]:col-span-2 min-[900px]:[&>div]:h-full">{projectsEl}</div>
          </div>
          <KPIRow aria-label={t('hub.pm.kpiBand', 'My project figures')} className="grid-cols-1 min-[900px]:auto-cols-fr min-[900px]:grid-flow-col">
            {contractTile}
            <KPITile
              testId="kpi-team-hours"
              tone="blue"
              icon="grid"
              label={t('home.teamHours', 'Team hours to approve')}
              value={approvedHours === null || hoursItem === undefined ? null : `${formatHours(approvedHours)} ${t('home.hoursUnit', 'h')}`}
              unavailableReason={approvedHours === null || hoursItem === undefined ? t('home.reasonTeamHours', 'team timesheets could not be read') : undefined}
              to={hoursItem?.href}
              linkLabel={t('home.teamHours', 'Team hours to approve')}
              loading={timesheetsQuery.isPending}
            />
            <KPITile
              testId="kpi-tasks-overdue"
              tone="red"
              icon="grid"
              label={t('home.tasksOverdue', 'Tasks overdue')}
              value={overdueItem ? String(overdueItem.count) : null}
              unavailableReason={overdueItem ? undefined : t('home.reasonTasksOverdue', 'task dates could not be read')}
              to={overdueItem?.href}
              linkLabel={t('home.tasksOverdue', 'Tasks overdue')}
              loading={projectsQuery.isPending || (projectsQuery.data !== undefined && (overdueTasksQuery.isPending || overdueOrgDay.isPending))}
            />
          </KPIRow>
          <div className={cn('grid items-start gap-[var(--space-panel-gap)] min-[900px]:grid-cols-2')}>
            <Card>
              <CardHead level={2} actions={<CardLink to={projectsHref(userId)}>{t('hub.pm.openMyProjects', 'Open my projects')}</CardLink>}>{planTitle}</CardHead>
              <CardPad className="min-w-0">
                {projectsQuery.isPending ? <ListState variant="loading" shape="chart" rows={4} />
                  : projectsQuery.isError ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={() => { void projectsQuery.refetch(); }} />
                    : <PlanVsActualChart projects={projects} currency={orgCurrency} />}
              </CardPad>
            </Card>
            <ChartCard title={t('home.deliveryVsBudget', 'Delivery and budget used before tax by project')} actions={<CardLink to={projectsHref(userId)}>{t('hub.pm.openMyProjects', 'Open my projects')}</CardLink>}
              known={pctBars.length > 0} hiddenReason={t('home.reasonDeliveryBudget', 'delivery and budget are not recorded')} pending={projectsPending}
              error={projectsError ? { title: t('home.projectsError', "Couldn't load projects"), retry: refresh } : undefined} testId="chart-delivery-budget">
              <SeriesKey items={[...(pctBars.some((row) => row.value !== null) ? [{ label: deliveryName, tone: 'accent' as const }] : []), ...(pctBars.some((row) => row.value2 != null) ? [{ label: budgetName, tone: 'neutral' as const }] : [])]} />
              <BarList rows={pctBars} ariaLabel={t('home.deliveryVsBudget', 'Delivery and budget used before tax by project')} seriesNames={[deliveryName, budgetName]} domainMax={100} />
            </ChartCard>
            <ChartCard title={overdueTitle} actions={overdueItem ? <CardLink to={overdueItem.href}>{t('hub.pm.openMyProjects', 'Open my projects')}</CardLink> : undefined}
              known={overdueItem !== undefined || needs.isPending} pending={needs.isPending} hiddenReason={t('home.reasonTasksOverdue', 'task dates could not be read')} testId="chart-overdue-tasks">
              {overdueBars.length === 0
                ? <p className="text-control text-muted-foreground">{t('home.noOverdueTasks', 'No overdue tasks.')}</p>
                : <BarList rows={overdueBars} ariaLabel={overdueTitle} />}
            </ChartCard>
          </div>
        </div>
      </FigureScope>
    );
  }

  return (
    <FigureScope>
      <div className="space-y-[var(--space-panel-gap)]" data-home-layout="focused">
        {header}
        {waitsEl}
        {projectsEl}
        <KPIRow aria-label={t('hub.pm.kpiBand', 'My project figures')} className="grid-cols-1 min-[900px]:max-w-sm">
          {contractTile}
        </KPIRow>
      </div>
    </FigureScope>
  );
};
