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
        atRisk ? t('home.budgetAtRisk', 'budget at risk') : null,
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
        help={t('home.pm.help', 'Delivery projects assigned to you. Spent as a share of budget, before tax.')}
        action={<Button variant="outline" onClick={refresh} aria-label={t('hub.pm.refresh', 'Refresh')}><Icon name="refresh" /><span className="hidden sm:inline">{t('hub.pm.refresh', 'Refresh')}</span></Button>}
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
      allLink={{ to: projectsHref(userId), label: projectsPending || projectsError ? t('home.allProjectsBare', 'All projects') : t('home.allMine', 'All {{count}} projects', { count: projects.length }) }}
      emptyLabel={t('hub.pm.noProjects', 'No delivery projects assigned to you yet')}
      testId="pm-projects"
    />
  );
  // A failed read keeps the tile in its place: its label and one line, never a hole in the figure strip.
  const contractTile = projectsError ? (
    <div data-testid="kpi-my-contract-value-error" className="flex min-w-0 flex-col gap-2.5 bg-card px-4 pb-3.5 pt-4">
      <span className="text-control font-medium text-foreground">{t('hub.pm.myContractValue', 'My contract value')}</span>
      <span className="flex flex-wrap items-center gap-x-2 text-control text-muted-foreground">
        <span>{t('home.figureError', "Couldn't load")}</span><span aria-hidden>·</span>
        <button type="button" onClick={() => void projectsQuery.refetch()} className="font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('home.retry', 'Retry')}</button>
      </span>
    </div>
  ) : (
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
    // One question: what needs me today across my projects. Waits on you is a short band (with my contract value
    // beside it), My projects is the dominant table, and one chart adds what the table cannot: contract, budget and
    // spending side by side across projects. Overdue tasks are stated once per place: my own in Waits on you, each
    // project's in its row (no separate total or chart repeats them).
    const planTitle = t('hub.company.planVsActual.title', 'Plan vs actual');
    return (
      <FigureScope>
        <div className="space-y-[var(--space-panel-gap)]" data-home-layout="overview">
          {header}
          <div className="grid items-stretch gap-[var(--space-panel-gap)] min-[900px]:grid-cols-12">
            <div className="min-w-0 min-[900px]:col-span-9 min-[900px]:row-start-1 [&>div]:h-full">
              {/* Exception colour once per group: a neutral panel where only overdue counts are coloured. */}
              <DashboardWaitsOnYou band plain overdueOnly rows={waitRows} pending={needs.isPending} error={needs.isError} onRetry={refresh} />
            </div>
            <div className="min-w-0 min-[900px]:col-span-12 min-[900px]:row-start-2">{projectsEl}</div>
            {/* Read after My projects (and drawn there on a phone); on a wide screen it sits beside Waits on you. */}
            <KPIRow aria-label={t('hub.pm.kpiBand', 'My project figures')} className="grid-cols-1 min-[900px]:col-span-3 min-[900px]:col-start-10 min-[900px]:row-start-1">
              {contractTile}
            </KPIRow>
          </div>
          <Card>
            <CardHead level={2}>{planTitle}</CardHead>
            <CardPad className="min-w-0">
              {projectsQuery.isPending ? <ListState variant="loading" shape="chart" rows={4} />
                : projectsQuery.isError ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={() => { void projectsQuery.refetch(); }} />
                  : <PlanVsActualChart dense projects={projects} currency={orgCurrency} />}
            </CardPad>
          </Card>
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
