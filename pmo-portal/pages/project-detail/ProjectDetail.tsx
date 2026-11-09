import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { pickClassification } from '@/src/lib/projectClassification';
import React, { useCallback, useLayoutEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, StatusPill, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProjectMutations, useProject } from '@/src/hooks/useProjects';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import type { ProjectHeaderInput } from '@/src/lib/db/projects';
import { useAgentContextPublisher } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { trackProjectTabViewed } from '@/src/lib/analytics';
import { useProjectOverviewRead } from '@/src/hooks/useProjectOverviewRead';
import ProjectDetailHeader from './ProjectDetailHeader';
import { ProjectFactsStrip } from './ProjectFactsStrip';
import { useScheduleSummary } from './useProjectOverviewFigures';
import DealBand from '../sales/DealBand';
import StageHistory from './StageHistory';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import ProjectDetailRail from './ProjectDetailRail';
import ProjectFormModal from '../../components/ProjectFormModal';
import ProjectSections, { PrimaryProjectAction, ProjectQuickActions } from './ProjectSections';
import { areaFromParam, type Area } from './projectDetailAreas';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/** "Behind plan" when a started phase is past its target or the project end has passed unfinished. */
export const BehindPlanPill: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const schedule = useScheduleSummary(project);
  if (schedule.lateCount === 0 && schedule.endLate === null) return null;
  return <StatusPill variant="overdue">{t('projectDetail.health.behind', 'Behind plan')}</StatusPill>;
};

/**
 * The on-hand project's sales-history doorway (AC-PSH-013): a collapsed disclosure around the stage
 * history. One definition, two placements — the header above the tabs on desktop (mb-8 = section
 * 32px), the record's foot on phone (mt-4 = panel-gap phone 16px) so it never pushes tab work below
 * the fold (UIP-005 AC-TH-007, #1701).
 *
 * AC-PERF-002 (plan Step 1b): the stage-entries read is the disclosure's, not the page's — StageHistory
 * mounts on the FIRST open (react-query caches it for later opens). Closed, it costs zero reads; the
 * first open trades a moment of loading for that, acceptable inside a closed disclosure.
 */
const SalesHistoryDisclosure: React.FC<{ projectId: string; className: string }> = ({ projectId, className }) => {
  const { t } = useTranslation('project');
  const [opened, setOpened] = useState(false);
  return (
    <details
      className={className}
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold">{t('projectDetail.stageHistory.salesHistory', 'Sales history')}</summary>
      <div className="pt-2">{opened && <StageHistory projectId={projectId} hideHeading />}</div>
    </details>
  );
};

/**
 * Route shell for `/projects/:projectId[/:tab]`, the one detail route for a project at every stage
 * (ADR-0021). Header, then the project's areas as tabs (#1402): Overview · Budget · Procurement · Tasks ·
 * Contract & billing · Documents. Old `work-orders`/`billing`/`history` links land on their merged area.
 * A pipeline deal gets the deal banner above the tabs. Activity opens in a drawer from the Overview foot.
 */
const ProjectDetail: React.FC = () => {
  const { projectId = '', tab: tabParam } = useParams<{ projectId: string; tab?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('project');
  const {
    data: project,
    isPending,
    isError: projectError,
    refetch: refetchProject,
  } = useProject(projectId);
  const area = areaFromParam(tabParam);
  // AC-PERF-007/008: the Overview's summaries arrive in one request, in parallel with the project; leaf hooks mount
  // only after it settles (success or error), so they find seeded data or fall back to their own reads.
  const overview = useProjectOverviewRead(projectId, true);
  const { updateHeader } = useProjectMutations();
  const pipelineGroup = project ? projectStatusGroup(project.status as never) : null;
  const isPipelineRecord = pipelineGroup === 'pipeline' || pipelineGroup === 'lost';
  const isDesktop = useIsDesktop();
  const primaryActionAllowed = area === 'overview' || area === 'contract';
  const chaseOnly = area === 'contract';
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed project — grounding only
  // (NFR-AXP-SEC-003), never an authorization signal. Cleared on unmount/navigate.
  const { setEntity } = useAgentContextPublisher();
  // Publish before paint. Combined with AgentContextProvider's ref-backed snapshot,
  // this closes both sides of the first-turn race: late publication and stale readers.
  useLayoutEffect(() => {
    if (!project) return;
    setEntity({ type: 'project', id: project.id, label: project.name });
    return () => setEntity(undefined);
  }, [project, setEntity]);

  const setArea = useCallback((next: Area) => {
    trackProjectTabViewed(next);
    // #682: keep the captured list-return context; #879: an in-page tab switch keeps focus in the tab bar.
    navigate(`/projects/${projectId}${next === 'overview' ? '' : `/${next}`}`, { replace: true, state: withTabSwitchNavState(location.state) });
  }, [navigate, projectId, location.state]);

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

  const loadingView = (
    <>
      <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
      {/* O18: the page keeps a level-one heading while the project loads. */}
      <h1 className="sr-only">{t('projectDetail.loadingTitle', 'Loading project')}</h1>
      <ListState variant="loading" shape="detail" loadingLabel={t('projectDetail.loadingTitle', 'Loading project')} rows={6} />
    </>
  );
  // Only the Overview waits: swapping the page for a skeleton on a tab change would unmount the tablist and drop focus.
  if (project && area === 'overview' && overview.isLoading) return loadingView;

  if (!project) {
    if (isPending) return loadingView;
    // #695: absence cannot be claimed from a FAILED read. A by-id fetch that errored says nothing
    // about whether the record exists, so it is a load error with Retry - never "not found".
    if (projectError) {
      return (
        <>
          <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
          <ListState
            variant="error"
            titleAsPageHeading
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
          titleAsPageHeading
          title={t('projectDetail.notFound.title', 'Project not found')}
          sub={t(
            'projectDetail.notFound.sub',
            "This project does not exist or you don't have access to it. Use Back to Projects to return.",
          )}
        />
      </>
    );
  }

  const header = (
    <>
      <ProjectDetailHeader project={project} onEditProject={openEditProject} compact
        primaryAction={primaryActionAllowed ? <span className="hidden md:inline-flex"><PrimaryProjectAction project={project} isPipeline={isPipelineRecord} chaseOnly={chaseOnly} /></span> : undefined}
        secondaryAction={!isPipelineRecord && area === 'overview' ? <span className="hidden items-center gap-2 md:inline-flex"><ProjectQuickActions project={project} /></span> : undefined}
        healthPill={!isPipelineRecord ? <BehindPlanPill project={project} /> : undefined}
        menuContent={<ProjectDetailRail project={project} detailsOnly />} />
      <ProjectFactsStrip project={project} />
      {isPipelineRecord && <div className="mb-8"><DealBand project={project} /></div>}
      {/* UIP-005 (#1701): the sales-history doorway sits in the header only on desktop — on phone it
          moves below the tab work so every tab's work still arrives above the fold (AC-TH-007). */}
      {pipelineGroup === 'onHand' && isDesktop && <SalesHistoryDisclosure projectId={project.id} className="mb-8" />}
      <div className="md:mb-4" />
    </>
  );

  return (
    <div>
      {/* #735: the top-bar breadcrumb hides its parent crumbs at <= 920px, so the record shows the in-page BackBar there. */}
      <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
      <ProjectSections project={project} area={area} setArea={setArea} isPipeline={isPipelineRecord} header={header} />
      {/* Phone: the doorway keeps its disclosure affordance at the record's foot (panel-gap phone = 16px),
          costing the fold nothing; react-query dedupes its reads with the desktop instance's. */}
      {pipelineGroup === 'onHand' && !isDesktop && <SalesHistoryDisclosure projectId={project.id} className="mt-4" />}
      {primaryActionAllowed && <PrimaryProjectAction project={project} isPipeline={isPipelineRecord} chaseOnly={chaseOnly} mobileBar />}
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
