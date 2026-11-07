import React, { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, StatusPill, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useProject, useProjectMutations } from '@/src/hooks/useProjects';
import { useListReturn } from '@/src/hooks/useListReturn';
import { withTabSwitchNavState } from '@/src/lib/tabSwitchNav';
import { listReturnNavigation } from '@/src/lib/listReturnContext';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { pickClassification } from '@/src/lib/projectClassification';
import { formatDateOnly, formatRelativeTime } from '@/src/lib/format';
import type { ProjectWithRefs, ProjectHeaderInput } from '@/src/lib/db/projects';
import { useProjectOverviewRead } from '@/src/hooks/useProjectOverviewRead';
import ProjectFormModal from '../../../components/ProjectFormModal';
import ProjectDetailHeader from '../../project-detail/ProjectDetailHeader';
import ProjectDetailRail from '../../project-detail/ProjectDetailRail';
import StageHistory from '../../project-detail/StageHistory';
import ProjectSections from '../../project-detail/ProjectSections';
import { areaFromParam, type Area } from '../../project-detail/projectDetailAreas';
import { pillVariantForStatus } from '../../../components/salesPipeline';
import { useDealActions, type DealActions } from './useDealActions';
import { DealActionButtons, DealActionsZone, DealDialogs, DealFigures, DealJourney } from './DealParts';

type Layout = 'a' | 'b' | 'c';

const Facts: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const dates = project.start_date || project.end_date
    ? `${formatDateOnly(project.start_date)} – ${formatDateOnly(project.end_date)}`
    : t('projectDetail.facts.noDates', 'Dates not set');
  return (
    <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-control text-muted-foreground">
      {project.pm?.full_name && <span>{project.pm.full_name}</span>}
      <span>{dates}</span>
      {project.last_update && <time dateTime={project.last_update}>{t('projectDetail.facts.updated', 'Updated {{when}}', { when: formatRelativeTime(project.last_update) })}</time>}
    </p>
  );
};

/** Loads the deal, owns the edit modal, and hands each layout the same pieces. */
const Shell: React.FC<{ layout: Layout }> = ({ layout }) => {
  const { opportunityId = '' } = useParams<{ opportunityId: string }>();
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation('project');
  const location = useLocation();
  const { toast } = useToast();
  const { data: project, isPending, isError, refetch } = useProject(opportunityId);
  const overview = useProjectOverviewRead(opportunityId, true);
  const { updateHeader } = useProjectMutations();
  const { returnToList } = useListReturn({ list: 'sales' });
  const [editOpen, setEditOpen] = useState(false);
  const area = areaFromParam(params.get('tab') ?? undefined);
  const back = () => returnToList('sales');
  const backTo = listReturnNavigation(location.state, 'sales');
  const setArea = (next: Area) =>
    setParams((p) => { const n = new URLSearchParams(p); if (next === 'overview') n.delete('tab'); else n.set('tab', next); return n; }, { replace: true, state: withTabSwitchNavState(location.state) });

  if (!project) {
    return (
      <>
        <BackBar label={t('projectDetail.pipeline.backToSalesPipeline', '← Back to Sales Pipeline')} phoneOnly onBack={back} />
        {isPending ? (
          <>
            <h1 className="sr-only">{t('projectDetail.loadingTitle', 'Loading project')}</h1>
            <ListState variant="loading" shape="detail" loadingLabel={t('projectDetail.loadingTitle', 'Loading project')} rows={6} />
          </>
        ) : isError ? (
          <ListState variant="error" titleAsPageHeading title={t('projectDetail.loadError.title', "Couldn't load this project")}
            sub={t('projectDetail.loadError.sub', 'The request failed. Check your connection and try again.')} retryLabel={t('projectDetail.loadError.retry', 'Retry')} onRetry={() => void refetch()} />
        ) : (
          <ListState variant="error" icon="inbox" titleAsPageHeading title={t('projectDetail.notFound.title', 'Project not found')}
            sub={t('projectDetail.notFound.sub', "This project does not exist or you don't have access to it. Use Back to Projects to return.")} />
        )}
      </>
    );
  }
  if (area === 'overview' && overview.isLoading) {
    return <ListState variant="loading" shape="detail" loadingLabel={t('projectDetail.loadingTitle', 'Loading project')} rows={6} />;
  }
  return (
    <Loaded layout={layout} project={project} area={area} setArea={setArea} back={back} backTo={backTo}
      editOpen={editOpen} setEditOpen={setEditOpen}
      save={async (id, input) => {
        await updateHeader.mutateAsync({ id, input });
        toast(t('projectDetail.toast.projectUpdated', 'Project updated'), input.name, 'success');
        setEditOpen(false);
      }}
      onError={(err) => { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }} />
  );
};

interface LoadedProps {
  layout: Layout; project: ProjectWithRefs; area: Area; setArea: (a: Area) => void; back: () => void;
  backTo: ReturnType<typeof listReturnNavigation>; editOpen: boolean; setEditOpen: (v: boolean) => void;
  save: (id: string, input: ProjectHeaderInput) => Promise<void>; onError: (e: unknown) => void;
}

const Loaded: React.FC<LoadedProps> = ({ layout, project, area, setArea, back, backTo, editOpen, setEditOpen, save, onError }) => {
  const { t } = useTranslation('project');
  const d = useDealActions(project);
  const isPipeline = true;
  const identity = (
    <>
      <ProjectDetailHeader project={project} onEditProject={() => setEditOpen(true)} compact menuContent={<ProjectDetailRail project={project} detailsOnly />} />
      <Facts project={project} />
    </>
  );
  const stagePill = <StatusPill variant={pillVariantForStatus(project.status as never)}>{project.status}</StatusPill>;
  const backLink = (
    <Link to={backTo.path} state={backTo.state} className="inline-flex text-xs font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
      {t('projectDetail.pipeline.backToSalesPipeline', '← Back to Sales Pipeline')}
    </Link>
  );
  let header: React.ReactNode;
  let aside: React.ReactNode = null;
  if (layout === 'a') {
    // A: the CRM record. Journey bar across the top, tabs on the left, a sticky deal panel on the right.
    header = (
      <>
        {identity}
        <div className="mb-6"><DealJourney d={d} history={false} /></div>
      </>
    );
    aside = (
      <aside aria-label={t('sales:options.dealPanel', 'Deal')} className="panel-card space-y-5 p-[var(--panel-inset)] lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t('sales:options.dealPanel', 'Deal')}</h2>{stagePill}</div>
        <DealFigures d={d} className="grid grid-cols-1 gap-y-3" />
        <DealActionsZone d={d} />
        <DealJourneyHistory d={d} />
        {backLink}
      </aside>
    );
  } else if (layout === 'b') {
    // B: decision first. One band says where the deal is and what to do; the tabs follow.
    header = (
      <>
        {identity}
        <section aria-label={t('sales:options.decisionBand', 'Where this stands')} className="panel-card mb-8 grid gap-6 p-[var(--panel-inset)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-w-0 space-y-4">
            <div className="flex items-center gap-2"><span className="text-xs font-medium text-muted-foreground">{t('projectDetail.pipeline.currentStage', 'Current stage')}</span>{stagePill}</div>
            <DealActionsZone d={d} />
            {backLink}
          </div>
          <div className="min-w-0 space-y-4">
            <DealFigures d={d} className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" />
            <DealJourneyHistory d={d} />
          </div>
        </section>
      </>
    );
  } else {
    // C: the journey is the page. A vertical timeline carries the stage, history and the action at its current node.
    aside = (
      <aside aria-label={t('projectDetail.pipeline.journeyHeading', 'Project journey')} className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <DealJourney d={d} />
        <DealActionsZone d={d} />
        {backLink}
      </aside>
    );
    header = (
      <>
        {identity}
        <section aria-label={t('sales:options.dealFiguresLabel', 'Deal figures')} className="panel-card mb-6 p-[var(--panel-inset)]"><DealFigures d={d} className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5" /></section>
      </>
    );
  }
  const tabs = <ProjectSections project={project} area={area} setArea={setArea} isPipeline={isPipeline} header={header} />;
  return (
    <div>
      <BackBar label={t('projectDetail.pipeline.backToSalesPipeline', '← Back to Sales Pipeline')} phoneOnly onBack={back} />
      {aside && layout !== 'b' ? (
        <div className={layout === 'c' ? 'grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]' : 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]'}>
          {layout === 'c' && aside}
          <div className="min-w-0">{tabs}</div>
          {layout === 'a' && aside}
        </div>
      ) : tabs}
      {d.isTerminal ? null : (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background p-3 md:hidden">
          <DealActionButtons d={d} primaryOnly />
        </div>
      )}
      <DealDialogs d={d} />
      {editOpen && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            ...pickClassification(project),
            id: project.id, name: project.name, short_name: project.short_name, code: project.code,
            client_id: project.client_id, project_manager_id: project.project_manager_id,
            clientName: project.client ? companyDisplayName(project.client) : null,
            end_client_id: project.end_client_id,
            endClientName: project.end_client ? companyDisplayName(project.end_client) : null,
            pmName: project.pm?.full_name ?? null, start_date: project.start_date, end_date: project.end_date,
          }}
          onClose={() => setEditOpen(false)} onSave={save} onError={onError}
        />
      )}
    </div>
  );
};

/** Stage history only (the stepper is shown elsewhere in layouts A and B). */
const DealJourneyHistory: React.FC<{ d: DealActions }> = ({ d }) => {
  const { t } = useTranslation('project');
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-sm font-semibold">{t('projectDetail.stageHistory.salesHistory', 'Sales history')}</summary>
      <div className="pt-2"><StageHistory projectId={d.project.id} hideHeading /></div>
    </details>
  );
};

export const OpportunityOption: React.FC<{ layout: Layout }> = ({ layout }) => <Shell layout={layout} />;
export default OpportunityOption;
