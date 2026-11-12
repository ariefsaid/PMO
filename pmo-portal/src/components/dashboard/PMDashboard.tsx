import React, { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useHomeLayout } from '@/src/hooks/useHomeLayout';
import { usePMDashboardProjects } from '@/src/hooks/useDashboard';
import { useProjectNumbers } from '@/src/hooks/useProjects';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
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
import { moneyTileValue } from './dashMoney';
import { DashboardWaitsOnYou, type ProjectRow, type WaitRow } from './DashParts';
import { PlanVsActualChart } from './hub/company/PlanVsActualChart';
import { FindingLine, PageHelp } from './hub/company/FindingLine';
import { ProjectHealthCard, type HealthExtras } from './hub/company/ProjectHealthCard';
import { formatTileMoney } from '@/src/lib/format';
import type { AttentionProject } from '@/src/lib/db/dashboard';
import {
  atRiskCount,
  formatHours,
  projectActualComplete,
  projectAtRisk,
  projectBudgetUsagePct,
  projectMoneyFigure,
  projectRiskBasisKnown,
  projectSpendOfContractPct,
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
  const projectIds = useMemo(() => new Set(projects.map((project) => project.id)), [projects]);
  const assignedProjectIds = useMemo(() => new Set((projectsQuery.data ?? []).map((project) => project.id)), [projectsQuery.data]);
  const procurementsAwaiting = useMemo(
    () => pendingProcurementApprovals(procurementsQuery.data, userId, realRole === 'Admin')
      .filter((procurement) => procurement.project_id !== null && projectIds.has(procurement.project_id)),
    [procurementsQuery.data, projectIds, realRole, userId],
  );
  const purchasesByProject = useMemo(() => {
    const grouped = new Map<string, typeof procurementsAwaiting>();
    for (const procurement of procurementsAwaiting) {
      if (procurement.project_id) grouped.set(procurement.project_id, [...(grouped.get(procurement.project_id) ?? []), procurement]);
    }
    return grouped;
  }, [procurementsAwaiting]);
  const projectNumbers = useProjectNumbers(projects.map((project) => project.id));

  // Worst first: at risk, then most overdue tasks, then most purchases to approve. Projects that need nothing sort last.
  const rows = useMemo<ProjectRow[]>(() => {
    const score = (projectId: string, atRisk: boolean) =>
      (atRisk ? 1_000 : 0) + (needs.pmOverdueTasksByProject[projectId] ?? 0) * 10 + (purchasesByProject.get(projectId)?.length ?? 0);
    return [...projects].sort((a, b) => score(b.id, projectAtRisk(b)) - score(a.id, projectAtRisk(a))).map((project) => {
      const overdue = needs.pmOverdueTasksByProject[project.id] ?? 0;
      const purchases = purchasesByProject.get(project.id)?.length ?? 0;
      const atRisk = projectAtRisk(project);
      const reason = [
        overdue > 0 ? t('home.overdueTasks', { count: overdue, defaultValue_one: '{{count}} task overdue', defaultValue_other: '{{count}} tasks overdue' }) : null,
        purchases > 0 ? t('home.purchasesToApprove', { count: purchases, defaultValue_one: '{{count}} purchase to approve', defaultValue_other: '{{count}} purchases to approve' }) : null,
        atRisk ? t('home.budgetNinety', 'budget at 90% or more') : null,
      ].filter(Boolean).join(' · ');
      const delivery = deliveryQuery.data?.[project.id];
      return {
        id: project.id,
        name: projectDisplayName(project),
        title: projectDisplayName(project) !== project.name ? project.name : undefined,
        reason: reason || null,
        delivery: delivery !== undefined && Number.isFinite(delivery) ? delivery : null,
        budgetUsed: projectBudgetUsagePct(project),
        status: project.status,
        offTrack: atRisk || overdue > 0,
        href: `/projects/${project.id}`,
      };
    });
  }, [deliveryQuery.data, needs.pmOverdueTasksByProject, projects, purchasesByProject, t]);

  // Project health (the company home's card): my delivery projects worst first, each with its own open items.
  const healthRows = useMemo<AttentionProject[]>(() => rows.map((row) => {
    const project = projects.find((candidate) => candidate.id === row.id)!;
    return {
      ...project,
      // The PM basis: actuals complete only with full coverage; spending without a currency is in the project's.
      actual_complete: projectActualComplete(project),
      actual_currency: project.actual_currency ?? project.currency,
      attention_signals: 0, overdue_items: 0, overdue_milestones: 0, overdue_invoices: 0, over_budget: false, budget_used_ratio: null,
      overdue_tasks: needs.pmOverdueTasksByProject[project.id] ?? 0,
      waiting_approvals: purchasesByProject.get(project.id)?.length ?? 0,
    };
  }), [needs.pmOverdueTasksByProject, projects, purchasesByProject, rows]);
  const healthExtras = useMemo(() => new Map<string, HealthExtras>(projects.map((project) => {
    const overdue = needs.pmOverdueTasksByProject[project.id] ?? 0;
    const margin = project.realized_margin;
    return [project.id, {
      meta: [projectNumbers.data?.[project.id], project.client_name, project.currency].filter(Boolean).join(' · '),
      facts: projectAtRisk(project) ? [{ key: 'risk', red: true, text: t('home.budgetAtNinety', 'Budget at 90% or more') }] : [],
      figures: margin != null && Number.isFinite(margin) ? t('home.marginShort', 'Margin to date {{amount}}', { amount: formatTileMoney(margin, project.currency) ?? '' }) : undefined,
      items: [
        ...(overdue > 0 ? [{ key: 'tasks', red: true, href: `/projects/${project.id}/tasks`, label: t('home.mobileTasksOverdue', { count: overdue, defaultValue_one: '{{count}} task overdue', defaultValue_other: '{{count}} tasks overdue' }) }] : []),
        ...(purchasesByProject.get(project.id) ?? []).map((procurement) => ({
          key: `procurement-${procurement.id}`,
          href: `/procurement?open=${encodeURIComponent(procurement.id)}`,
          label: t('home.approvePurchase', 'Approve {{name}}', { name: [procurement.title, procurement.vendor?.name].filter(Boolean).join(' · ') }),
        })),
      ],
    }];
  })), [needs.pmOverdueTasksByProject, projectNumbers.data, projects, purchasesByProject, t]);

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
  // Restored figures (dev's PM band), each from the PM projects read: contract left, at risk, margin to date.
  // Summed per currency the dev way (any project unknown makes the figure unknown); drawn the company home's way:
  // the organisation currency first, another currency on its own line.
  const moneyReason = (field: 'contract_remaining' | 'realized_margin') => projects.length === 0 ? null : projectMoneyFigure(projects, field, orgCurrency, 'unknown').unavailableReason ?? null;
  const perCurrency = (field: 'contract_remaining' | 'realized_margin') => {
    if (projects.length === 0 || moneyReason(field)) return null;
    const totals = new Map<string, number>();
    for (const project of projects) totals.set(project.currency, (totals.get(project.currency) ?? 0) + (project[field] as number));
    return moneyTileValue([...totals].map(([currency, amount]) => ({ currency, amount })), orgCurrency);
  };
  const contractLeftTile = perCurrency('contract_remaining');
  const marginTile = perCurrency('realized_margin');
  const marginKnown = marginTile !== null;
  const atRisk = atRiskCount(projects);
  const spendingIncomplete = projects.length > 0 && (!marginKnown || contractLeftTile === null || projects.some((project) => projectSpendOfContractPct(project) === null));

  const refresh = useCallback(() => {
    void projectsQuery.refetch();
    if (projectIds.size > 0) void deliveryQuery.refetch();
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
  }, [assignedProjectIds, deliveryQuery, orgId, projectIds, projectsQuery, procurementsQuery, queryClient, timesheetsQuery, userId]);

  const waitRows: WaitRow[] = needs.items
    .filter((item) => ['approvals', 'team-timesheets', 'projects-over-budget', 'projects-risk-unchecked'].includes(item.id))
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
  // Overdue tasks on my projects are known once their own read and the organisation's day are; zero is then a figure.
  const tasksKnown = projectsQuery.data !== undefined && !overdueTasksQuery.isPending && !overdueTasksQuery.isError && !overdueOrgDay.isPending && !overdueOrgDay.isError && overdueOrgDay.day !== null;
  const overdueItem = needs.items.find((item) => item.id === 'overdue-project-tasks');
  const tasksOverdue = overdueItem ? overdueItem.count : tasksKnown ? 0 : null;

  const header = (
    <div>
      <PageHeader
        className="mb-2"
        title={t('hub.pm.title', 'My dashboard')}
        help={t('home.pm.help', 'Delivery projects assigned to you. Budget used compares recorded spending with the active budget; it is hidden where spending or budget is incomplete.')}
        action={<Button variant="outline" size="sm" onClick={refresh} aria-label={t('hub.pm.refresh', 'Refresh')}><Icon name="refresh" /><span className="hidden sm:inline">{t('hub.pm.refresh', 'Refresh')}</span></Button>}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <FindingLine opsHref={projectsHref(userId)} approvals={needs.items.find((item) => item.id === 'approvals')?.count}
          offTrack={projectsPending || projectsError ? undefined : {
            count: rows.filter((row) => row.offTrack).length,
            // Overdue tasks not yet known: the count is a floor.
            atLeast: !tasksKnown,
            total: projects.length,
            unchecked: projects.filter((project) => !projectRiskBasisKnown(project)).length,
            allClear: tasksKnown && rows.every((row) => !row.offTrack) && projects.every(projectRiskBasisKnown),
          }} />
        <FigureHiddenLine compact />
      </div>
    </div>
  );
  const waitsEl = <DashboardWaitsOnYou plain rows={waitRows} pending={needs.isPending} error={needs.isError} onRetry={refresh} />;
  const projectsEl = (
    <ProjectHealthCard
      testId="pm-projects"
      title={t('home.myProjects', 'My projects')}
      rows={healthRows}
      delivery={deliveryQuery.data}
      extras={healthExtras}
      pending={projectsPending}
      error={projectsError}
      retry={refresh}
      allLink={{ to: projectsHref(userId), label: t('home.allMine', 'All {{count}} projects', { count: projects.length }) }}
      quietLabel={t('hub.pm.nothingNeedsYou', 'Nothing needs you here.')}
      emptyLabel={t('hub.pm.noProjects', 'No delivery projects assigned to you yet')}
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

  // Definitions and the include/exclude statement for the money, in the page's one help list.
  const pageHelp = spendingIncomplete ? [{ label: t('home.spending', 'Spending'), text: t('hub.pm.spendingIncompleteNote', 'Some projects have incomplete spending, so margin, contract left and contract spent are shown only where they are known.') }] : [];

  if (overview) {
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
    const budgetName = t('home.colBudget', 'Budget used');
    const overdueTitle = t('home.overdueByProject', 'Overdue tasks by project');
    const planTitle = t('hub.company.planVsActual.title', 'Plan vs actual');
    const tasksHref = overdueItem?.href ?? '/projects?filter=My+Projects';
    const atRiskHref = userId ? `/projects?filter=at-risk&pm=${encodeURIComponent(userId)}` : '/projects?filter=at-risk';
    // The company home's grid: 12 columns, one gutter. Figures (12) · My projects (8) | Waits on you (4) ·
    // Delivery and budget (6) | Overdue by project (6) · Plan vs actual (12). Below 900px one column, waits first.
    return (
      <FigureScope>
        <PageHelp entries={pageHelp} />
        <div className="space-y-[var(--space-panel-gap)]" data-home-layout="overview">
          {header}
          <KPIRow aria-label={t('hub.pm.kpiBand', 'My project figures')} className="grid-cols-2 max-[899px]:[&>*:last-child:nth-child(odd)]:col-span-2 min-[900px]:auto-cols-fr min-[900px]:grid-flow-col">
            {contractTile}
            {/* What is left of the contract after recorded spending: drawn only when every project's remainder is known;
                otherwise counted in the hidden-figures line with its reason. */}
            {projects.length > 0 || projectsPending ? (
              <KPITile
                testId="kpi-contract-left"
                tone="green"
                icon="dollar"
                label={t('hub.pm.leftAfterSpending', 'Left after spending')}
                value={contractLeftTile?.value ?? null}
                exactValue={contractLeftTile?.exact}
                unavailableReason={contractLeftTile ? undefined : t('hub.pm.reasonMoneyIncomplete', 'a project has incomplete spending or contract data')}
                loading={projectsPending}
                to={projectsHref(userId)}
                linkLabel={t('hub.pm.openMyProjects', 'Open my projects')}
              />
            ) : null}
            <KPITile
              testId="kpi-at-risk"
              tone="amber"
              icon="alert"
              label={t('hub.pm.atRisk', 'At risk')}
              value={projectsError || atRisk === null ? null : atRisk.partial ? t('hub.pm.atRiskAtLeast', 'At least {{count}}', { count: atRisk.count }) : String(atRisk.count)}
              unavailableReason={projectsError ? t('hub.pm.projectsFigureUnavailable', 'Project data could not be loaded. Retry to refresh this figure.') : atRisk !== null ? undefined : t('hub.pm.riskUnavailable', 'Budget risk is unknown because one or more projects have incomplete actual spending or budget data.')}
              caption={atRisk?.partial ? t('hub.pm.riskPartial', 'At 90% or more of budget; other projects have incomplete budget or spending data') : t('hub.pm.riskDefinition', 'Projects at 90% or more of budget')}
              loading={projectsPending}
              to={atRiskHref}
              linkLabel={t('hub.pm.openAtRisk', 'Open at-risk projects')}
              help={t('hub.pm.atRiskHelp', 'Counts your delivery projects when actual spending is at least 90% of a positive budget in the same currency. Unknown spending or budget data makes the total unavailable.')}
            />
            {projects.length > 0 || projectsPending ? (
              <KPITile
                testId="kpi-margin-to-date"
                tone="blue"
                icon="grid"
                label={t('hub.pm.marginToDate', 'Margin to date')}
                value={marginTile?.value ?? null}
                exactValue={marginTile?.exact}
                unavailableReason={marginTile ? undefined : t('hub.pm.reasonMoneyIncomplete', 'a project has incomplete spending or contract data')}
                loading={projectsPending}
                to={projectsHref(userId)}
                linkLabel={t('hub.pm.openMarginProjects', 'Open projects with billed-work margin')}
                help={t('hub.pm.marginHelp', 'Margin on billed work to date: billed-work revenue less recorded actual spending, grouped by project currency.')}
              />
            ) : null}
            <KPITile
              testId="kpi-team-hours"
              tone="blue"
              icon="grid"
              label={t('home.teamHours', 'Team hours to approve')}
              value={approvedHours === null ? null : `${formatHours(approvedHours)} ${t('home.hoursUnit', 'h')}`}
              unavailableReason={approvedHours === null ? t('home.reasonTeamHours', 'team timesheets could not be read') : undefined}
              to="/approvals?scope=timesheets"
              linkLabel={t('home.teamHours', 'Team hours to approve')}
              loading={timesheetsQuery.isPending}
            />
            <KPITile
              testId="kpi-tasks-overdue"
              tone="red"
              icon="grid"
              label={t('home.tasksOverdue', 'Tasks overdue')}
              value={tasksOverdue === null ? null : String(tasksOverdue)}
              unavailableReason={tasksOverdue === null ? t('home.reasonTasksOverdue', 'task dates could not be read') : undefined}
              to={tasksHref}
              linkLabel={t('home.tasksOverdue', 'Tasks overdue')}
              loading={projectsQuery.isPending || (projectsQuery.data !== undefined && (overdueTasksQuery.isPending || overdueOrgDay.isPending))}
            />
          </KPIRow>
          <div className="grid items-stretch gap-[var(--space-panel-gap)] max-[899px]:grid-cols-1 min-[900px]:grid-cols-12">
            <div className="min-w-0 max-[899px]:order-2 min-[900px]:col-span-8 [&>div]:h-full">{projectsEl}</div>
            <div className="min-w-0 self-start max-[899px]:order-1 min-[900px]:col-span-4">{waitsEl}</div>
          </div>
          <div className="grid items-stretch gap-[var(--space-panel-gap)] min-[900px]:grid-cols-2">
            <ChartCard title={t('home.deliveryVsBudget', 'Delivery and budget used by project')} actions={<CardLink to={projectsHref(userId)}>{t('hub.pm.openMyProjects', 'Open my projects')}</CardLink>}
              known={pctBars.length > 0} hiddenReason={t('home.reasonDeliveryBudget', 'delivery and budget are not recorded')} pending={projectsPending}
              error={projectsError ? { title: t('home.projectsError', "Couldn't load projects"), retry: refresh } : undefined} testId="chart-delivery-budget">
              <SeriesKey items={[...(pctBars.some((row) => row.value !== null) ? [{ label: deliveryName, tone: 'accent' as const }] : []), ...(pctBars.some((row) => row.value2 != null) ? [{ label: budgetName, tone: 'neutral' as const }] : [])]} />
              <BarList rows={pctBars} ariaLabel={t('home.deliveryVsBudget', 'Delivery and budget used by project')} seriesNames={[deliveryName, budgetName]} domainMax={100} />
            </ChartCard>
            <ChartCard title={overdueTitle} actions={<CardLink to={tasksHref}>{t('hub.pm.openMyProjects', 'Open my projects')}</CardLink>}
              known={tasksOverdue !== null || needs.isPending} pending={needs.isPending && tasksOverdue === null} hiddenReason={t('home.reasonTasksOverdue', 'task dates could not be read')} testId="chart-overdue-tasks">
              {overdueBars.length === 0
                ? <p className="text-control text-muted-foreground">{t('home.noOverdueTasks', 'No overdue tasks.')}</p>
                : <BarList rows={overdueBars} ariaLabel={overdueTitle} />}
            </ChartCard>
          </div>
          <Card>
            <CardHead level={2} actions={<CardLink to={projectsHref(userId)}>{t('hub.pm.openMyProjects', 'Open my projects')}</CardLink>}>{planTitle}</CardHead>
            <CardPad className="min-w-0">
              {projectsQuery.isPending ? <ListState variant="loading" shape="chart" rows={4} />
                : projectsQuery.isError ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={() => { void projectsQuery.refetch(); }} />
                  : <PlanVsActualChart projects={projects} currency={orgCurrency} />}
            </CardPad>
          </Card>
        </div>
      </FigureScope>
    );
  }

  return (
    <FigureScope>
      <PageHelp entries={pageHelp} />
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
