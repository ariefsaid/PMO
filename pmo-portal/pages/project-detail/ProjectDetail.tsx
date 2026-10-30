import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { pickClassification } from '@/src/lib/projectClassification';
import React, { useLayoutEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, ProgressBar, Tooltip, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProjectMutations, useProject } from '@/src/hooks/useProjects';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import type { ProjectHeaderInput } from '@/src/lib/db/projects';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { useListReturn } from '@/src/hooks/useListReturn';
import { trackProjectTabViewed } from '@/src/lib/analytics';
import { useMilestones } from '@/src/hooks/useMilestones';
import { completionPct, formatDateOnly, formatInstantDate, formatRelativeTime } from '@/src/lib/format';
import ProjectDetailHeader from './ProjectDetailHeader';
import PipelineLens from './PipelineLens';
import ProjectDetailRail from './ProjectDetailRail';
import ProjectFormModal from '../../components/ProjectFormModal';
import ProjectSections, { PrimaryProjectAction } from './ProjectSections';
import { areaFromParam, type Area } from './projectDetailAreas';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const ProjectHeaderFacts: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const phases = useMilestones(project.id);
  const milestones = phases.data ?? [];
  const totalWeight = milestones.reduce((sum, phase) => sum + phase.weight, 0);
  const progress = totalWeight > 0
    ? completionPct(milestones.reduce((sum, phase) => sum + phase.weight * phase.effective_pct, 0) / totalWeight)
    : null;
  const manager = project.pm?.full_name;
  const initial = manager?.trim().charAt(0).toUpperCase() || '?';
  const dates = project.start_date || project.end_date
    ? `${formatDateOnly(project.start_date)} – ${formatDateOnly(project.end_date)}`
    : t('projectDetail.facts.noDates', 'Dates not set');
  const updated = project.last_update ? formatRelativeTime(project.last_update) : null;
  return (
    <section aria-label={t('projectDetail.facts.ariaLabel', 'Project facts')} className="mb-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 pb-2 text-control font-normal text-muted-foreground md:mb-6 md:gap-y-2 md:pb-4">
      {manager && (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">{initial}</span>
          <span className="truncate">{manager}</span>
        </span>
      )}
      <span>{dates}</span>
      {/* L6: the contract value lives once on the screen — in Money position (Overview) / Contract & billing. */}
      {progress !== null && (
        <Tooltip content={t('projectDetail.facts.progressTooltip', 'Weighted average of phase completion using each phase weight; source: project phase plan.')}>
          {/* Owner tidy ruling 2026-10-29: the segment is content-sized (compact bar,
              label and value tight) so the meta row keeps ONE consistent gap before
            "Updated" — the old min-w-40 left dead slack that read as a hole. */}
          <span tabIndex={0} className="inline-flex items-center gap-2">
            <span>{t('projectDetail.facts.progress', 'Progress')}</span>
            <ProgressBar value={progress} tone={progress >= 100 ? 'success' : 'primary'} showValue compact className="[&>span:last-child]:text-control [&>span:last-child]:font-normal" aria-label={t('projectDetail.facts.progressAria', 'Project progress {{percent}}%', { percent: progress })} />
          </span>
        </Tooltip>
      )}
      {phases.isPending && <span>{t('projectDetail.facts.progressLoading', 'Progress loading')}</span>}
      {updated && (
        <Tooltip content={t('projectDetail.facts.updatedTooltip', 'Last updated on {{date}}.', { date: formatInstantDate(project.last_update) })}>
          <time tabIndex={0} dateTime={project.last_update} className="text-muted-foreground">
            {t('projectDetail.facts.updated', 'Updated {{when}}', { when: updated })}
          </time>
        </Tooltip>
      )}
    </section>
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
  const { updateHeader } = useProjectMutations();
  const pipelineGroup = project ? projectStatusGroup(project.status as never) : null;
  const isPipelineRecord = pipelineGroup === 'pipeline' || pipelineGroup === 'lost';
  const area = areaFromParam(tabParam);
  const primaryActionAllowed = area === 'overview' || area === 'contract';
  const chaseOnly = area === 'contract';
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

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
          {/* O18: the page keeps a level-one heading while the project loads. */}
          <h1 className="sr-only">{t('projectDetail.loadingTitle', 'Loading project')}</h1>
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
        menuContent={<ProjectDetailRail project={project} detailsOnly />} />
      <ProjectHeaderFacts project={project} />
      {isPipelineRecord && <div className="mb-8"><PipelineLens project={project} locationState={location.state} /></div>}
      <div className="md:mb-4" />
    </>
  );

  return (
    <div>
      {/* #735: the top-bar breadcrumb hides its parent crumbs at <= 920px, so the record shows the in-page BackBar there. */}
      <BackBar label={t('projectDetail.backToProjects', 'Projects')} phoneOnly onBack={goBack} />
      <ProjectSections project={project} area={area} setArea={setArea} isPipeline={isPipelineRecord} header={header} />
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
