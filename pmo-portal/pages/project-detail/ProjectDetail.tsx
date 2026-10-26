import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { pickClassification } from '@/src/lib/projectClassification';
import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProjectMutations, useProject } from '@/src/hooks/useProjects';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import type { ProjectHeaderInput } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { listReturnNavigation } from '@/src/lib/listReturnContext';
import { trackProjectTabViewed } from '@/src/lib/analytics';
import ProjectDetailHeader from './ProjectDetailHeader';
import PipelineLens, { type PipelinePrimaryAction } from './PipelineLens';
import MilestoneStrip from './MilestoneStrip';
import ProjectDetailRail from './ProjectDetailRail';
import ProjectSectionNavigation, { type ProjectSectionGroup } from './ProjectSectionNavigation';
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
  const pipelineGroup = project ? projectStatusGroup(project.status as never) : null;
  const isPipelineRecord = pipelineGroup === 'pipeline' || pipelineGroup === 'lost';
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  // Section labels live here so the canonical URL values stay independent of locale.
  const sectionGroups = useMemo<ProjectSectionGroup<PTab>[]>(
    () => [
      {
        label: t('project:projectDetail.sectionNav.overview', 'Overview'),
        items: [{ value: 'overview', label: t('projectDetail.tabs.overview', 'Overview') }],
      },
      {
        label: t('project:projectDetail.sectionNav.delivery', 'Delivery'),
        items: [
          { value: 'tasks', label: t('projectDetail.tabs.tasks', 'Tasks') },
          ...(!isPipelineRecord ? [{ value: 'work-orders' as const, label: t('projectDetail.tabs.workOrders', 'Work orders') }] : []),
        ],
      },
      {
        label: t('project:projectDetail.sectionNav.money', 'Money'),
        items: [
          { value: 'budget', label: t('projectDetail.tabs.budget', 'Budget') },
          { value: 'procurement', label: t('projectDetail.tabs.procurement', 'Procurement') },
          ...(canSeeBilling && !isPipelineRecord ? [{ value: 'billing' as const, label: t('projectDetail.tabs.billing', 'Billing') }] : []),
        ],
      },
      {
        label: t('project:projectDetail.sectionNav.evidence', 'Evidence'),
        items: [
          { value: 'documents', label: t('projectDetail.tabs.documents', 'Documents') },
          { value: 'history', label: t('projectDetail.tabs.history', 'History') },
        ],
      },
    ],
    [t, canSeeBilling, isPipelineRecord],
  );

  // Committed spend sums every request on the project. A role that reads only the requests it raised
  // (Engineer, migration 0350) would get a partial sum, so it gets no project-wide figure at all.
  const readsProjectWideSpend = may('view', 'procurement');
  const committedSpendQuery = useProjectCommittedSpend(readsProjectWideSpend ? projectId || null : null, readsProjectWideSpend);
  const committedSpend = readsProjectWideSpend ? committedSpendQuery.data : undefined;
  const committedOtherCurrencies = readsProjectWideSpend ? committedSpendQuery.otherCurrencies : undefined;
  const commitmentSource = (readsProjectWideSpend && committedSpendQuery.commitmentSource) || 'unavailable';
  const ledgerBasis = (readsProjectWideSpend && committedSpendQuery.ledgerBasis) || 'unavailable';
  const commitmentPending = readsProjectWideSpend && committedSpendQuery.isPending;
  const commitmentError = readsProjectWideSpend && committedSpendQuery.isError;

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
  const requestedTab = tabFromParam(tabParam);
  // SUB-A: pre-win records land on Overview for Work orders/Billing; ineligible billing readers
  // return to the delivery work they can act on.
  const tab: PTab = isPipelineRecord && (requestedTab === 'work-orders' || requestedTab === 'billing')
    ? 'overview'
    : requestedTab === 'billing' && !canSeeBilling ? 'tasks' : requestedTab;
  const showPipelinePrimaryAction = pipelineGroup === 'pipeline' && tab === 'overview' && may('edit', 'project');
  const [pipelinePrimaryAction, setPipelinePrimaryAction] = useState<PipelinePrimaryAction | null>(null);
  const setTab = (next: PTab) => {
    trackProjectTabViewed(next);
    // Preserve collection return context, section-level query state and task/WO anchors.
    navigate({
      pathname: `/projects/${projectId}/${next}`,
      search: location.search,
      hash: location.hash,
    }, {
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
  const returnToSales = () => {
    const destination = listReturnNavigation(location.state, 'sales');
    navigate(destination.path, { state: destination.state });
  };
  const backNavigation = isPipelineRecord ? (
    <a href={listReturnNavigation(location.state, 'sales').path}
      onClick={(event) => { event.preventDefault(); returnToSales(); }}
      className="mb-4 inline-flex min-h-11 min-w-11 items-center text-sm text-primary-text underline underline-offset-4">
      {t('project:projectDetail.pipeline.backToSalesPipeline', '← Back to Sales Pipeline')}
    </a>
  ) : <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />;


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
          {backNavigation}
          <ListState variant="loading" rows={6} />
        </>
      );
    }
    // #695: absence cannot be claimed from a FAILED read. A by-id fetch that errored says nothing
    // about whether the record exists, so it is a load error with Retry - never "not found".
    if (projectError) {
      return (
        <>
          {backNavigation}
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
        {backNavigation}
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

  // ADR-0021 (supersedes ADR-0020 §1): one unified detail page at every stage. Pipeline journey
  // evidence is the first Overview content after named section navigation; the same canonical
  // sections remain reachable while a deal is open or lost.
  const isPipeline = isPipelineRecord;
  const tabPanel = (
    <div id="project-section-content" className="min-w-0">
      <React.Suspense fallback={<ListState variant="loading" rows={4} className="min-h-80" testId="project-detail-panel-loading" />}>
        {tab === 'overview' && (
          // PD-B: one rhythm (gap-8) and no wrappers — a section with nothing to show renders
          // nothing, so it leaves no empty slot or stray margin behind.
          <div className="flex min-w-0 flex-col gap-8">
            {isPipelineRecord && (
              <PipelineLens
                project={project}
                locationState={location.state}
                onReturnToSales={returnToSales}
                onPrimaryActionChange={showPipelinePrimaryAction ? setPipelinePrimaryAction : undefined}
              />
            )}
            {!isPipeline && <>
            <OverviewTab
              project={project}
              committedSpend={committedSpend}
              committedOtherCurrencies={committedOtherCurrencies}
              commitmentSource={commitmentSource}
              ledgerBasis={ledgerBasis}
              commitmentPending={commitmentPending}
              commitmentError={commitmentError}
              setTab={setTab}
              phaseSummary={<MilestoneStrip projectId={project.id} summary showSummaryRollup={false} />}
              phasePlanner={!isPipelineRecord ? <MilestoneStrip projectId={project.id} /> : undefined}
              showMoneyPosition={!isPipeline}
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
            </>}
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
            projectManagerId={project.project_manager_id ?? null}
          />
        )}
        {tab === 'billing' && canSeeBilling && (
          <BillingTab projectId={project.id} currency={project.currency} taxTreatment={project.tax_treatment} clientId={project.client_id ?? null}
            projectManagerId={project.project_manager_id ?? null} />
        )}
        {tab === 'documents' && <DocumentsTab projectId={project.id} projectCode={project.code} />}
        {tab === 'history' && (
          <RecordHistory entityType="project" entityId={project.id} includeChildren kindFilters />
        )}
      </React.Suspense>
      <ProjectDetailRail project={project} />
    </div>
  );

  return (
    <div className="project-detail-record min-w-0">
      {backNavigation}
      <ProjectDetailHeader
        project={project}
        onEditProject={openEditProject}
        isOverview={tab === 'overview'}
        showPipelinePrimaryAction={showPipelinePrimaryAction}
        primaryAction={showPipelinePrimaryAction && pipelinePrimaryAction && (
          <Button
            variant="primary"
            disabled={pipelinePrimaryAction.disabled}
            onClick={pipelinePrimaryAction.activate}
            className="min-h-11 max-[920px]:w-full"
          >
            {pipelinePrimaryAction.label}
          </Button>
        )}
      />

      <div className="grid min-w-0 grid-cols-1 gap-5 min-[921px]:grid-cols-[13rem_minmax(0,1fr)] min-[921px]:gap-8">
        <ProjectSectionNavigation
          recordName={project.name}
          projectId={projectId}
          groups={sectionGroups}
          activeSection={tab}
          search={location.search}
          hash={location.hash}
          navigationState={withTabSwitchNavState(location.state)}
          onNavigate={(next) => trackProjectTabViewed(next)}
        />
        {tabPanel}
      </div>
      {editOpen && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            ...pickClassification(project),
            id: project.id,
            name: project.name,
            short_name: project.short_name,
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
