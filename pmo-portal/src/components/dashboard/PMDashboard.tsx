import React, { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { usePMDashboardProjects } from '@/src/hooks/useDashboard';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { INTERNAL_STATUSES, ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { expenseClaimsAwaitingKey } from '@/src/hooks/approvalsQueryKeys';
import { useNeedsYou } from './restructure/useNeedsYou';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { ListState } from '@/src/components/ui/ListState';
import { Icon } from '@/src/components/ui/icons';
import { ApprovalStrip } from './hub/ApprovalStrip';
import { HubGrid } from './hub/HubGrid';
import { DashPageHead } from './layout';
import { PMProjectArea } from './hub/pm/PMProjectArea';
import {
  formatHours,
  projectAtRisk,
  projectMoneyFigure,
  atRiskCount,
  projectSpendOfContractPct,
  sumAwaitingTimesheetHours,
} from './hub/pm/metrics';

const DELIVERY_PROJECT_STATUSES = new Set([...ON_HAND_STATUSES, ...INTERNAL_STATUSES]);
const PROJECTS_HREF = '/projects?filter=My+Projects';

/** Role-specific project index for Project Managers. Every figure drills into its owning page. */
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
  const procurementsQuery = useProcurements();
  const needs = useNeedsYou('Project Manager');
  const orgCurrency = useOrgCurrency();

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
  const procurementsByProject = useMemo(() => {
    const grouped = new Map<string, typeof procurementsAwaiting>();
    for (const procurement of procurementsAwaiting) {
      if (!procurement.project_id) continue;
      const current = grouped.get(procurement.project_id) ?? [];
      current.push(procurement);
      grouped.set(procurement.project_id, current);
    }
    return grouped;
  }, [procurementsAwaiting]);

  const orderedProjects = useMemo(() => [...projects].sort((a, b) => {
    const score = (projectId: string, atRisk: boolean) =>
      (atRisk ? 1_000 : 0)
      + (needs.pmOverdueTasksByProject[projectId] ?? 0) * 10
      + (procurementsByProject.get(projectId)?.length ?? 0);
    return score(b.id, projectAtRisk(b)) - score(a.id, projectAtRisk(a));
  }), [needs.pmOverdueTasksByProject, procurementsByProject, projects]);
  const visibleProjects = orderedProjects.slice(0, 6);
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);

  const contractFigure = projectMoneyFigure(
    projects,
    'contract_value',
    orgCurrency,
    t('hub.pm.contractUnavailable', 'One or more project contract values are unavailable.'),
  );
  const contractLeftFigure = projectMoneyFigure(
    projects,
    'contract_remaining',
    orgCurrency,
    t('hub.pm.contractLeftUnavailable', 'Contract remaining is unavailable until project spending is complete.'),
  );
  const marginFigure = projectMoneyFigure(
    projects,
    'realized_margin',
    orgCurrency,
    t('hub.pm.marginUnavailable', 'Billed-work margin is unavailable for one or more projects.'),
  );
  // C4: figures the system cannot know are left out of the band, and the reason is said once under it.
  const marginKnown = marginFigure.unavailableReason === undefined;
  const contractLeftKnown = contractLeftFigure.value !== '—';
  const spendingIncomplete = !marginKnown || !contractLeftKnown || projects.some((project) => projectSpendOfContractPct(project) === null);
  const atRisk = atRiskCount(projects);
  const atRiskValue = atRisk === null
    ? '—'
    : atRisk.partial
      ? t('hub.pm.atRiskAtLeast', 'At least {{count}}', { count: atRisk.count })
      : String(atRisk.count);
  const atRiskReason = atRisk === null
    ? t('hub.pm.riskUnavailable', 'Budget risk is unknown because one or more projects have incomplete actual spending or budget data.')
    : undefined;
  const approvedHours = sumAwaitingTimesheetHours(timesheetsQuery.data);
  const hoursReason = timesheetsQuery.isError
    ? t('hub.pm.hoursLoadError', 'Team hours are unavailable because the approval queue could not be loaded.')
    : approvedHours === null
      ? t('hub.pm.hoursUnavailable', 'Team hours are unavailable because one or more timesheet entries are missing.')
      : undefined;
  const projectsErrorReason = projectsQuery.isError
    ? t('hub.pm.projectsFigureUnavailable', 'Project data could not be loaded. Retry to refresh this figure.')
    : undefined;

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
        return typeof recordId === 'string'
          && ((key === 'tasks' && assignedProjectIds.has(recordId))
            || (key === 'project' && visibleProjectIds.has(recordId)));
      },
    });
    void queryClient.invalidateQueries({ queryKey: expenseClaimsAwaitingKey(orgId) });
    void queryClient.invalidateQueries({ queryKey: ['timesheets-awaiting', orgId, userId] });
  }, [assignedProjectIds, deliveryQuery, orgId, projectIds, projectsQuery, procurementsQuery, queryClient, timesheetsQuery, userId, visibleProjectIds]);

  const approvalItems = needs.items
    .filter((item) => ['approvals', 'team-timesheets', 'projects-over-budget', 'projects-risk-unchecked'].includes(item.id))
    .map((item) => ({
      ...item,
      tone: item.tone === 'lost' ? 'lost' as const : item.tone === 'neutral' ? 'neutral' as const : 'warn' as const,
      icon: item.id === 'team-timesheets' ? 'clock' as const : item.id.startsWith('projects-') ? 'alert' as const : 'check' as const,
      count: item.countLabel ?? item.count,
    }));
  const primaryError = projectsQuery.isError || needs.isError || procurementsQuery.isError;
  const primaryLoading = projectsQuery.isPending || needs.isPending || procurementsQuery.isPending;

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('hub.pm.title', 'My dashboard')}
        sub={projectsQuery.data === undefined
          ? t('hub.pm.subtitleLoading', 'Your projects and what needs you')
          : t('hub.pm.subtitle', 'Your {{count}} projects and what needs you', { count: projects.length })}
        actions={(
          <button
            type="button"
            onClick={refresh}
            aria-label={t('hub.pm.refresh', 'Refresh')}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon name="refresh" className="size-4" />
            {t('hub.pm.refresh', 'Refresh')}
          </button>
        )}
      />

      <ApprovalStrip items={approvalItems} />

      <KPIRow aria-label={t('hub.pm.kpiBand', 'My project figures')} className={marginKnown || projectsErrorReason ? 'grid-cols-2 min-[1180px]:grid-cols-5' : 'grid-cols-2 min-[1180px]:grid-cols-4'}>
        <KPITile
          testId="kpi-my-projects"
          tone="violet"
          icon="folder"
          label={t('hub.pm.myProjects', 'My projects')}
          value={projectsErrorReason ? '—' : String(projects.length)}
          unavailableReason={projectsErrorReason}
          loading={projectsQuery.isPending}
          to={PROJECTS_HREF}
          linkLabel={t('hub.pm.openMyProjects', 'Open my projects')}
          help={t('hub.pm.myProjectsHelp', 'Delivery projects assigned to you as the project manager.')}
        />
        <KPITile
          testId="kpi-my-contract-value"
          tone="green"
          icon="dollar"
          label={t('hub.pm.myContractValue', 'My contract value')}
          value={projectsErrorReason ? '—' : contractFigure.value}
          exactValue={projectsErrorReason ? undefined : contractFigure.exactValue}
          unavailableReason={projectsErrorReason ?? contractFigure.unavailableReason}
          vs={projectsErrorReason ?? (contractLeftKnown
            ? t('hub.pm.contractLeft', '{{value}} left after spending', { value: contractLeftFigure.value })
            : undefined)}
          loading={projectsQuery.isPending}
          to={PROJECTS_HREF}
          linkLabel={t('hub.pm.openMyProjects', 'Open my projects')}
          help={t('hub.pm.contractHelp', 'Contract value for your delivery projects. The line below shows the remaining contract value after recorded spending; the two use the project currency and do not convert between currencies.')}
        />
        <KPITile
          testId="kpi-at-risk"
          tone="amber"
          icon="alert"
          label={t('hub.pm.atRisk', 'At risk')}
          value={projectsErrorReason ? '—' : atRiskValue}
          unavailableReason={projectsErrorReason ?? atRiskReason}
          vs={atRisk?.partial
            ? t('hub.pm.riskPartial', 'At 90% or more of budget; other projects have incomplete budget or spending data')
            : t('hub.pm.riskDefinition', 'Projects at 90% or more of budget')}
          loading={projectsQuery.isPending}
          to="/projects?filter=at-risk"
          linkLabel={t('hub.pm.openAtRisk', 'Open at-risk projects')}
          help={t('hub.pm.atRiskHelp', 'Counts your delivery projects when actual spending is at least 90% of a positive budget in the same currency. Unknown spending or budget data makes the total unavailable.')}
        />
        {(marginKnown || projectsErrorReason) && (
          <KPITile
            testId="kpi-margin-to-date"
            tone="blue"
            icon="chart-column"
            label={t('hub.pm.marginToDate', 'Margin to date')}
            value={projectsErrorReason ? '—' : marginFigure.value}
            exactValue={projectsErrorReason ? undefined : marginFigure.exactValue}
            unavailableReason={projectsErrorReason ?? marginFigure.unavailableReason}
            loading={projectsQuery.isPending}
            to={PROJECTS_HREF}
            linkLabel={t('hub.pm.openMarginProjects', 'Open projects with billed-work margin')}
            help={t('hub.pm.marginHelp', 'Margin on billed work to date: billed-work revenue less recorded actual spending, grouped by project currency.')}
          />
        )}
        <KPITile
          testId="kpi-team-hours"
          tone="violet"
          icon="clock"
          label={t('hub.pm.teamHours', 'Team hours to approve')}
          value={timesheetsQuery.isError || approvedHours === null ? '—' : `${formatHours(approvedHours)} h`}
          unavailableReason={hoursReason}
          loading={timesheetsQuery.isPending}
          to="/approvals?scope=timesheets"
          linkLabel={t('hub.pm.openTimesheets', 'Open team timesheets to approve')}
          help={t('hub.pm.teamHoursHelp', 'Sum of hours in team timesheets currently waiting for your approval.')}
        />
      </KPIRow>
      {spendingIncomplete && !projectsErrorReason && !projectsQuery.isPending && projects.length > 0 && (
        <p className="-mt-2 text-xs text-muted-foreground">{t('hub.pm.spendingIncompleteNote', 'Some projects have incomplete spending, so margin, contract left and contract spent are shown only where they are known.')}</p>
      )}

      {primaryLoading ? (
        <ListState variant="loading" />
      ) : primaryError ? (
        <ListState
          variant="error"
          title={t('hub.pm.loadError', "Couldn't load your projects and attention items")}
          onRetry={refresh}
        />
      ) : projects.length === 0 ? (
        <ListState
          variant="empty"
          icon="folder"
          title={t('hub.pm.noProjects', 'No delivery projects assigned to you yet')}
        />
      ) : (
        <>
          <HubGrid>
            {visibleProjects.map((project) => (
              <PMProjectArea
                key={project.id}
                project={project}
                deliveryPct={deliveryQuery.data?.[project.id]}
                overdueTaskCount={needs.pmOverdueTasksByProject[project.id] ?? 0}
                procurements={procurementsByProject.get(project.id) ?? []}
                orgCurrency={orgCurrency}
              />
            ))}
          </HubGrid>
          {orderedProjects.length > 6 && (
            <div className="flex justify-center">
              <Link
                to={PROJECTS_HREF}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t('hub.pm.viewAllProjects', 'View all {{count}} projects', { count: orderedProjects.length })}
                <Icon name="chev" className="size-4" />
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
};
