import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { pickClassification } from '@/src/lib/projectClassification';
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Tabs, tabId, tabPanelId, ListState, useToast, type TabItem } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProjectMutations, useProject } from '@/src/hooks/useProjects';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import type { ProjectHeaderInput } from '@/src/lib/db/projects';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { trackProjectTabViewed } from '@/src/lib/analytics';
import ProjectDetailHeader, { hasFinanceView } from './ProjectDetailHeader';
import PipelineLens from './PipelineLens';
import MilestoneStrip from './MilestoneStrip';
import ProjectDetailRail from './ProjectDetailRail';
import ProjectFormModal from '../../components/ProjectFormModal';

const OverviewTab = React.lazy(() => import('./tabs/OverviewTab'));
const BudgetTab = React.lazy(() => import('./tabs/BudgetTab'));
const ProcurementTab = React.lazy(() => import('./tabs/ProcurementTab'));
const TasksTab = React.lazy(() => import('./tabs/TasksTab'));
const DocumentsTab = React.lazy(() => import('./tabs/DocumentsTab'));
const WorkOrdersTab = React.lazy(() => import('./tabs/WorkOrdersTab'));
const BillingTab = React.lazy(() => import('./tabs/BillingTab'));
const ProjectProfitLossSection = React.lazy(() => import('./ProjectProfitLossSection'));
const ProjectSCurve = React.lazy(() => import('./ProjectSCurve'));
const CommentsSection = React.lazy(() =>
  import('@/src/components/comments/CommentsSection').then(({ CommentsSection }) => ({ default: CommentsSection })),
);
const RecordHistory = React.lazy(() =>
  import('@/src/components/history/RecordHistory').then(({ RecordHistory }) => ({ default: RecordHistory })),
);

type PTab = 'overview' | 'budget' | 'procurement' | 'tasks' | 'work-orders' | 'billing' | 'documents' | 'history';

/**
 * Route shell for `/projects/:projectId` — the ONE canonical detail route for a project at EVERY
 * stage (Model B, ADR-0020). It reads the record by id (`useProject`, never the whole list), which
 * resolves a record at any stage — the canonical route opens regardless of stage. ADR-0021 (supersedes ADR-0020 §1): the page is UNIFIED —
 * the shared header + the five delivery Tabs (Overview/Budget/Procurement/Tasks/Documents) render
 * at every stage; a pipeline | lost record additionally gets the PipelineLens deal-progression
 * banner above the tabs. A cold deep-link shows ListState loading; a truly-absent record shows an
 * error with a Back action.
 */
/** Resolve the active tab from the URL :tab param (B-9, AC-W2-IA-004). All five
 *  tabs are now deep-linkable symmetrically; an absent/unknown value defaults to Overview.
 *
 *  CW-7 (coherence wave §3): `/projects/:id` ALWAYS defaults to Overview for EVERY role — the URL
 *  is role-invariant (a role-variant default was a wayfinding bug: the same link landed PM/Admin on
 *  Overview but Engineer on Tasks). Engineer task entry points deep-link to `/projects/:id/tasks`
 *  explicitly (e.g. the My Tasks project headers) rather than mutating the default. An explicit
 *  :tab param always wins (every tab stays deep-linkable). */
const TAB_VALUES: PTab[] = ['overview', 'budget', 'procurement', 'tasks', 'work-orders', 'billing', 'documents', 'history'];
function tabFromParam(param: string | undefined): PTab {
  if (param && (TAB_VALUES as string[]).includes(param)) return param as PTab;
  return 'overview';
}

const ProjectDetail: React.FC = () => {
  const { projectId = '', tab: tabParam } = useParams<{ projectId: string; tab?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const canSeeBilling = may('view', 'progressClaim');
  const { t } = useTranslation();
  const {
    data: project,
    isPending,
    isError: projectError,
    refetch: refetchProject,
  } = useProject(projectId);
  const { updateHeader } = useProjectMutations();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  // Tab labels live here (not at module scope) so they can be translated; the tab
  // VALUES and their order stay in TAB_VALUES above.
  const tabItems: TabItem<PTab>[] = useMemo(
    () => [
      { value: 'overview', label: t('projectDetail.tabs.overview', 'Overview') },
      { value: 'budget', label: t('projectDetail.tabs.budget', 'Budget') },
      { value: 'procurement', label: t('projectDetail.tabs.procurement', 'Procurement') },
      { value: 'tasks', label: t('projectDetail.tabs.tasks', 'Tasks') },
      { value: 'work-orders', label: t('projectDetail.tabs.workOrders', 'Work orders') },
      ...(canSeeBilling ? [{ value: 'billing' as const, label: t('projectDetail.tabs.billing', 'Billing') }] : []),
      { value: 'documents', label: t('projectDetail.tabs.documents', 'Documents') },
      { value: 'history', label: t('projectDetail.tabs.history', 'History') },
    ],
    [t, canSeeBilling],
  );

  const committedSpendQuery = useProjectCommittedSpend(projectId || null, true);
  const { data: committedSpend, commitmentSource = 'unavailable', ledgerBasis = 'unavailable' } = committedSpendQuery;

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed project — grounding only
  // (NFR-AXP-SEC-003), never an authorization signal. Cleared on unmount/navigate.
  const { setEntity } = useAgentContext();
  // Publish before paint. Combined with AgentContextProvider's ref-backed snapshot,
  // this closes both sides of the first-turn race: late publication and stale readers.
  useLayoutEffect(() => {
    if (!project) return;
    setEntity({ type: 'project', id: project.id, label: project.name });
    return () => setEntity(undefined);
  }, [project, setEntity]);

  // B-9 (AC-W2-IA-004): tab derived from URL param. CW-7: an absent/unknown :tab defaults to
  // Overview for EVERY role — the URL is role-invariant. An explicit :tab param always wins.
  const tab = tabFromParam(tabParam);
  // OD-W5-C3-A: delivery-forward roles (Engineer, !hasFinanceView) relocate the finance strip into
  // the Overview tab's "Financial summary" aside (header stays delivery-meta). This still keys on
  // role — but only the finance-summary PLACEMENT, never the default tab (CW-7).
  const isDeliveryForward = !hasFinanceView(realRole);
  const setTab = (next: PTab) => {
    trackProjectTabViewed(next);
    // list-working-set-return (#682): forward the current router state so a captured
    // `pmoListReturn` context (and any one-shot scroll restore) survives a tab switch.
    // #879: mark the navigation as an in-page tab switch so AppShell's route-focus
    // effect keeps focus in the tab bar (WCAG 2.4.3); Tabs moves focus to the new tab.
    navigate(`/projects/${projectId}/${next}`, {
      replace: true,
      state: withTabSwitchNavState(location.state),
    });
  };

  // Back to the Projects index (AC-NAV-007/AC-LRC-003): `returnToList` navigates to the
  // captured Projects list URL when the record was opened from a narrowed list, and falls
  // back to the bare index with clean state for a direct/copied link. The desktop parent
  // breadcrumb reads the same context via App.tsx's `contextualListReturnNavigation`.
  const { returnToList } = useListReturn({ list: 'projects' });
  const goBack = () => returnToList('projects');

  const openEditProject = () => setEditOpen(true);
  const closeEditProject = () => setEditOpen(false);

  const saveProjectHeader = async (id: string, input: ProjectHeaderInput) => {
    await updateHeader.mutateAsync({ id, input });
    toast(t('projectDetail.toast.projectUpdated', 'Project updated'), input.name, 'success');
    closeEditProject();
  };

  const onProjectEditError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  if (!project) {
    if (isPending) {
      return (
        <>
          <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
          <ListState variant="loading" rows={6} />
        </>
      );
    }
    // #695: absence cannot be claimed from a FAILED read. A by-id fetch that errored says nothing
    // about whether the record exists, so it is a load error with Retry - never "not found".
    if (projectError) {
      return (
        <>
          <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
          <ListState
            variant="error"
            title={t('projectDetail.loadError.title', "Couldn't load this project")}
            sub={t('projectDetail.loadError.sub', 'The request failed. Check your connection and try again.')}
            retryLabel={t('projectDetail.loadError.retry', 'Retry')}
            onRetry={() => {
              void refetchProject();
            }}
          />
        </>
      );
    }
    return (
      <>
        <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
        <ListState
          variant="error"
          icon="inbox"
          title={t('projectDetail.notFound.title', 'Project not found')}
          sub={t(
            'projectDetail.notFound.sub',
            "This project does not exist or you don't have access to it. Use Back to Projects to return.",
          )}
        />
      </>
    );
  }

  // ADR-0021 (supersedes ADR-0020 §1): ONE unified detail page at every stage. The full delivery
  // layout (header + the five tabs) always renders, so a PM can plan budget/tasks/procurement while
  // a deal is still in the pipeline (the backend gates those writes on org/role, not project
  // status). A pre-win (pipeline) or terminal (lost) record additionally gets the PipelineLens
  // deal-progression BANNER above the tabs (stage stepper + Advance/Mark won/Mark lost + deal
  // figures); on win the banner disappears and the delivery tiles appear — one continuous page.
  const group = projectStatusGroup(project.status as never);
  const isPipeline = group === 'pipeline' || group === 'lost';
  const tabPanel = (
    <div
      role="tabpanel"
      id={tabPanelId('project-detail', tab)}
      aria-labelledby={tabId('project-detail', tab)}
    >
      <React.Suspense fallback={<ListState variant="loading" rows={4} className="min-h-80" testId="project-detail-panel-loading" />}>
        {tab === 'overview' && (
          // PD-B: one rhythm (gap-8) and no wrappers — a section with nothing to show renders
          // nothing, so it leaves no empty slot or stray margin behind.
          <div className="flex min-w-0 flex-col gap-8">
            {/* UIP-005: the full actionable planner is Overview work, not common chrome. */}
            <MilestoneStrip projectId={project.id} compactWhenEmpty={isPipeline} />
            <OverviewTab
              project={project}
              committedSpend={committedSpend}
              commitmentSource={commitmentSource}
              ledgerBasis={ledgerBasis}
              commitmentPending={committedSpendQuery.isPending}
              commitmentError={committedSpendQuery.isError}
              setTab={setTab}
              // D15 (OD-W5-C3-A): pass the finance summary to delivery-forward roles only.
              // Finance-forward roles (Admin·Exec·Finance·PM) keep the finance block in the header.
              showFinanceSummary={isDeliveryForward && !isPipeline}
            />
            <React.Suspense fallback={null}>
              <ProjectProfitLossSection projectId={project.id} />
            </React.Suspense>
            {/* AC-IFW-RECORD-02: S-curve is an Overview-panel widget, hidden for pre-win records
                (no real progress data). Scoped here, not at shell level, so it never bleeds into
                the other tabs. */}
            {!isPipeline && (
              <React.Suspense fallback={null}>
                <ProjectSCurve projectId={project.id} />
              </React.Suspense>
            )}
            <React.Suspense fallback={<ListState variant="loading" rows={2} className="min-h-32" />}>
              <CommentsSection entityType="project" entityId={project.id} />
            </React.Suspense>
          </div>
        )}
        {tab === 'budget' && <BudgetTab projectId={project.id} />}
        {tab === 'procurement' && <ProcurementTab projectId={project.id} />}
        {tab === 'tasks' && <TasksTab projectId={project.id} projectName={project.name} />}
        {tab === 'work-orders' && (
          <WorkOrdersTab
            projectId={project.id}
            currency={project.currency}
            clientId={project.client_id ?? null}
            focusWorkOrderId={new URLSearchParams(location.search).get('wo')}
          />
        )}
        {tab === 'billing' && canSeeBilling && (
          <BillingTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null}
            projectManagerId={project.project_manager_id ?? null} />
        )}
        {tab === 'documents' && <DocumentsTab projectId={project.id} />}
        {tab === 'history' && (
          <RecordHistory entityType="project" entityId={project.id} includeChildren kindFilters />
        )}
      </React.Suspense>
    </div>
  );

  return (
    <div>
      {/* C-IMP-1 / #735: the top-bar breadcrumb hides its parent crumbs at <= 920px, so the
          loaded record shows the in-page BackBar up to 920px (CSS-only via `phoneOnly`, same
          rule as every other record page and this page's loading / not-found states). */}
      <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
      {/* I7: no in-page Breadcrumb on the success render — above 920px the top-bar
          breadcrumb (Projects/Sales Pipeline > record) is the single wayfinding surface.
          The Breadcrumb is kept on the loading / not-found branches above. The shared header renders
          at every stage so a record's wayfinding is identical regardless of stage. */}

      {/* AC-IFW-RECORD-01 (Lens-D): pre-win layout — sales levers first so the deal
          actions are above the fold; delivery planner is demoted below; S-curve is hidden
          (buildSCurve([]) shows an empty chart for a pre-win record — cut the noise).
          AC-IFW-RECORD-02 (Lens-D): delivery layout — stepper → tabs → S-curve, so the
          actionable tab bar surfaces above the fold rather than buried beneath the S-curve. */}
      {isPipeline ? (
        <>
          <ProjectDetailHeader
            project={project}
            committedSpend={committedSpend}
            commitmentSource={commitmentSource}
            ledgerBasis={ledgerBasis}
            commitmentPending={committedSpendQuery.isPending}
            commitmentError={committedSpendQuery.isError}
            onEditProject={openEditProject}
          />

          {/* Pre-win: deal-progression banner FIRST (the sales levers). */}
          <div className="mb-8">
            <PipelineLens project={project} locationState={location.state} />
          </div>
          {/* Classification, codes and the ERP project link live in the one closed details disclosure. */}
          <ProjectDetailRail project={project} showActionSection={false} />

          {/* Phase planning stays available in Overview at every stage. */}
          {tab !== 'overview' && <MilestoneStrip projectId={project.id} summary />}

          {/* Pre-win: S-curve is hidden — no real progress data exists yet for an opportunity.
              Guard: {!isPipeline && <ProjectSCurve …/>} per the design plan. */}

          {/* Delivery tabs rendered for pre-win so budget/tasks/procurement are reachable (ADR-0021). */}
          <Tabs<PTab>
            items={tabItems}
            value={tab}
            onChange={setTab}
            ariaLabel={t('projectDetail.tabs.ariaLabel', 'Project sections')}
            idBase="project-detail"
          />
          {tabPanel}
        </>
      ) : (
        <>
          <div className="min-w-0">
            <ProjectDetailHeader
              project={project}
              committedSpend={committedSpend}
              commitmentSource={commitmentSource}
              ledgerBasis={ledgerBasis}
              commitmentPending={committedSpendQuery.isPending}
              commitmentError={committedSpendQuery.isError}
              onEditProject={openEditProject}
            />
            <ProjectDetailRail project={project} onEditProject={openEditProject} />

            {/* Common chrome stays compact; the selected section follows immediately. */}
            {tab !== 'overview' && <MilestoneStrip projectId={project.id} summary />}

            <Tabs<PTab>
              items={tabItems}
              value={tab}
              onChange={setTab}
              ariaLabel={t('projectDetail.tabs.ariaLabel', 'Project sections')}
              idBase="project-detail"
            />
            {tabPanel}
          </div>
        </>
      )}
      {editOpen && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            ...pickClassification(project),
            id: project.id,
            name: project.name,
            code: project.code,
            client_id: project.client_id,
            project_manager_id: project.project_manager_id,
            clientName: project.client ? companyDisplayName(project.client) : null,
            end_client_id: project.end_client_id,
            endClientName: project.end_client ? companyDisplayName(project.end_client) : null,
            pmName: project.pm?.full_name ?? null,
            start_date: project.start_date,
            end_date: project.end_date,
          }}
          onClose={closeEditProject}
          onSave={saveProjectHeader}
          onError={onProjectEditError}
        />
      )}
    </div>
  );
};

export default ProjectDetail;
