import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { pickClassification } from '@/src/lib/projectClassification';
import React, { useLayoutEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, useToast } from '@/src/components/ui';
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
import { trackProjectTabViewed } from '@/src/lib/analytics';
import ProjectDetailHeader from './ProjectDetailHeader';
import PipelineLens from './PipelineLens';
import ProjectDetailRail from './ProjectDetailRail';
import ProjectFormModal from '../../components/ProjectFormModal';
import ProjectSections, { PrimaryProjectAction } from './ProjectSections';
import { areaFromParam, type Area } from './projectDetailAreas';

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
  const may = usePermission();
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

  const area = areaFromParam(tabParam);
  const setArea = (next: Area) => {
    trackProjectTabViewed(next);
    // #682: keep the captured list-return context; #879: an in-page tab switch keeps focus in the tab bar.
    navigate(`/projects/${projectId}${next === 'overview' ? '' : `/${next}`}`, { replace: true, state: withTabSwitchNavState(location.state) });
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

  const header = (
    <>
      <ProjectDetailHeader project={project} committedSpend={committedSpend} committedOtherCurrencies={committedOtherCurrencies}
        commitmentSource={commitmentSource} ledgerBasis={ledgerBasis} commitmentPending={commitmentPending}
        commitmentError={commitmentError} onEditProject={openEditProject} compact
        primaryAction={<span className="hidden md:inline-flex"><PrimaryProjectAction project={project} isPipeline={isPipelineRecord} /></span>} />
      {isPipelineRecord && <div className="mb-8"><PipelineLens project={project} locationState={location.state} /></div>}
      <ProjectDetailRail project={project} onEditProject={openEditProject} showActionSection={!isPipelineRecord}
        summaryLabel={t('projectDetail.rail.detailsShort', 'Details, codes and status')} quiet />
      <div className="mb-4" />
    </>
  );

  return (
    <div>
      {/* #735: the top-bar breadcrumb hides its parent crumbs at <= 920px, so the record shows the in-page BackBar there. */}
      <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
      <ProjectSections project={project} area={area} setArea={setArea} isPipeline={isPipelineRecord} header={header} />
      <PrimaryProjectAction project={project} isPipeline={isPipelineRecord} mobileBar />
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
