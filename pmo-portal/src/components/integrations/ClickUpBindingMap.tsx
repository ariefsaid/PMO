import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, RecordReference, type Column } from '@/src/components/ui';
import { TaskListMatchReview } from './TaskListMatchReview';
import { proposeTaskListMatches } from '@/src/lib/repositories/taskListMatchReview';
import type { ClickUpListItem, LinkClickUpProjectInput, ProjectBinding } from '@/src/lib/repositories/types';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * The ClickUp binding map of the organization integrations surface (extracted from
 * IntegrationsView, #1941): the project → ClickUp List table, its match proposals, the
 * source-specific unavailability notices (AC-IRUX-006) and the untracked-Lists note.
 *
 * Data lives in the view; this component derives the per-project binding view model
 * (AC-IRUX-006: a PMO-native/bound conclusion needs EVERY map input) and raises the
 * review/link actions back up — the view owns the mutations and the review-dialog state.
 */
interface TaskListReview {
  projectId: string;
  projectName: string;
  proposedListId: string | null;
}

interface ClickUpBindingMapProps {
  projects: ProjectWithRefs[];
  projectsPending: boolean;
  projectsError: boolean;
  onRetryProjects: () => void;
  clickupLists: ClickUpListItem[];
  isListsPending: boolean;
  isListsError: boolean;
  onRetryLists: () => void;
  projectBindings: ProjectBinding[];
  isBindingsPending: boolean;
  isBindingsError: boolean;
  onRetryBindings: () => void;
  canManageIntegrations: boolean;
  /** True while the link-project mutation is in flight (TaskListMatchReview saving state). */
  linkPending: boolean;
  taskListReview: TaskListReview | null;
  taskListReviewError: string | null;
  /** Open the review dialog for a project (the view owns the dialog state). */
  onStartReview: (review: TaskListReview) => void;
  onLinkConfirm: (input: LinkClickUpProjectInput) => Promise<void>;
  onCloseReview: () => void;
}

export const ClickUpBindingMap: React.FC<ClickUpBindingMapProps> = ({
  projects,
  projectsPending,
  projectsError,
  onRetryProjects,
  clickupLists,
  isListsPending,
  isListsError,
  onRetryLists,
  projectBindings,
  isBindingsPending,
  isBindingsError,
  onRetryBindings,
  canManageIntegrations,
  linkPending,
  taskListReview,
  taskListReviewError,
  onStartReview,
  onLinkConfirm,
  onCloseReview,
}) => {
  const { t } = useTranslation();

  const activeProjectIds = useMemo(
    () => new Set(projects.filter((project) => !project.archived_at).map((project) => project.id)),
    [projects],
  );
  const clickUpBindings = useMemo(
    () => projectBindings.filter(
      (binding) => binding.external_tier === 'clickup' && activeProjectIds.has(binding.project_id),
    ),
    [projectBindings, activeProjectIds],
  );
  const activeProjects = useMemo(() => projects.filter((project) => !project.archived_at), [projects]);
  const bindingByProjectId = useMemo(() => new Map(clickUpBindings.map((binding) => [binding.project_id, binding])), [clickUpBindings]);
  const boundListIds = useMemo(() => new Set(clickUpBindings.map((binding) => binding.external_container_id)), [clickUpBindings]);
  const matchProposals = useMemo(
    () => proposeTaskListMatches(
      activeProjects.map(({ id, name }) => ({ id, name })),
      clickupLists,
      clickUpBindings,
    ),
    [activeProjects, clickupLists, clickUpBindings],
  );
  const matchProposalByProjectId = useMemo(() => new Map(matchProposals.map((proposal) => [proposal.projectId, proposal])), [matchProposals]);
  const clickUpListById = useMemo(() => new Map(clickupLists.map((list) => [list.id, list])), [clickupLists]);
  const clickUpListsUnavailable = isListsError || isListsPending;
  // AC-IRUX-006: a PMO-native/bound conclusion needs EVERY map input (lists, bindings, projects).
  const bindingMapDataUnavailable =
    clickUpListsUnavailable ||
    isBindingsPending ||
    isBindingsError ||
    projectsPending ||
    projectsError;
  const bindingMapColumns: Column<(typeof activeProjects)[number]>[] = [
    { key: 'project', header: t('integrations.organization.readiness.map.projectColumn', 'PMO project'), kind: 'primary', rowHeader: true, cell: (project) => project.name, primaryTitle: (project) => project.name },
    { key: 'list', header: t('integrations.organization.readiness.map.listColumn', 'ClickUp List'), kind: 'text', cell: (project) => {
      const binding = bindingByProjectId.get(project.id);
      const proposal = matchProposalByProjectId.get(project.id);
      const list = binding ? clickUpListById.get(binding.external_container_id) : undefined;
      const suggestedList = proposal?.state === 'proposed' && proposal.listId ? clickUpListById.get(proposal.listId) : undefined;
      return bindingMapDataUnavailable ? t('integrations.organization.readiness.map.unknown', 'Unknown') : binding ? (list ? list.name : <span className="inline-flex flex-wrap items-center gap-x-2">{t('uxs21.savedListUnavailable', 'List unavailable. The saved link is kept.')}<RecordReference ids={[binding.external_container_id]} /></span>) : suggestedList ? <>{t('uxs21.suggestedList', 'Suggested')}: {suggestedList.name}</> : proposal?.state === 'ambiguous' ? t('uxs21.ambiguousMatch', 'Several lists have this project name') : '—';
    } },
    { key: 'status', header: t('integrations.organization.readiness.map.statusColumn', 'Status'), kind: 'status', cell: (project) => {
      const binding = bindingByProjectId.get(project.id);
      return bindingMapDataUnavailable ? t('integrations.organization.readiness.map.unknown', 'Unknown') : binding ? <>{t('integrations.organization.readiness.map.bound', 'Bound')} · {t('uxs21.initialTransferPendingShort', 'Initial transfer not confirmed')}</> : t('integrations.organization.readiness.map.pmoNative', 'PMO-native');
    } },
    ...(canManageIntegrations ? [{ key: 'review', header: t('uxs21.reviewColumn', 'Review'), kind: 'actions' as const, cell: (project: (typeof activeProjects)[number]) => {
      const binding = bindingByProjectId.get(project.id);
      if (binding || bindingMapDataUnavailable) return null;
      const proposal = matchProposalByProjectId.get(project.id);
      return <Button variant="outline" size="sm" onClick={() => { onStartReview({ projectId: project.id, projectName: project.name, proposedListId: proposal?.state === 'proposed' ? proposal.listId : null }); }}>{t('uxs21.reviewMatch', 'Review list match')}</Button>;
    } } satisfies Column<(typeof activeProjects)[number]>] : []),
  ];

  return (
    <section className="mt-6" aria-labelledby="clickup-binding-map-title" data-testid="clickup-binding-map">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="plug" aria-hidden="true" />
        <h4 id="clickup-binding-map-title" className="text-sm font-semibold text-foreground">
          {t('integrations.organization.readiness.map.title', 'ClickUp binding map')}
        </h4>
      </div>

      {/* AC-IRUX-006: source-specific load and unavailability notices + retries */}
      {isListsPending && !isListsError && (
        <p className="mb-2 text-sm text-muted-foreground" role="status">
          {t('integrations.organization.readiness.map.listsLoading', 'Loading ClickUp lists…')}
        </p>
      )}
      {isListsError && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
          <span>{t('integrations.organization.readiness.map.listsUnavailable', 'ClickUp lists are unavailable, so project-to-List bindings cannot be determined.')}</span>
          <Button variant="outline" size="sm" onClick={onRetryLists}>
            <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.map.listsRetry', 'Retry lists')}
          </Button>
        </div>
      )}
      {isBindingsPending && (
        <p className="mb-2 text-sm text-muted-foreground" role="status">
          {t('integrations.organization.readiness.map.bindingsLoading', 'Loading project bindings…')}
        </p>
      )}
      {isBindingsError && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
          <span>{t('integrations.organization.readiness.map.bindingsUnavailable', 'Project bindings are unavailable, so ClickUp connections cannot be determined.')}</span>
          <Button variant="outline" size="sm" onClick={onRetryBindings}>
            <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.map.bindingsRetry', 'Retry bindings')}
          </Button>
        </div>
      )}
      {projectsPending && (
        <p className="mb-2 text-sm text-muted-foreground" role="status">
          {t('integrations.organization.readiness.map.projectsLoading', 'Loading projects…')}
        </p>
      )}
      {projectsError && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
          <span>{t('integrations.organization.readiness.map.projectsUnavailable', 'Projects are unavailable, so the project breakdown cannot be determined.')}</span>
          <Button variant="outline" size="sm" onClick={onRetryProjects}>
            <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.map.projectsRetry', 'Retry projects')}
          </Button>
        </div>
      )}

      {!clickUpListsUnavailable && !isBindingsPending && !isBindingsError && !projectsPending && !projectsError && clickUpBindings.length === 0 && (
        <p className="mb-3 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground" data-testid="clickup-binding-map-empty">
          {t('integrations.organization.readiness.map.empty', 'No PMO projects are bound to ClickUp yet. Projects remain PMO-native until an admin links them.')}
        </p>
      )}
      <DataTable
        rows={activeProjects}
        columns={bindingMapColumns}
        rowKey={(project) => project.id}
        accessibleName={t('integrations.organization.readiness.map.caption', 'PMO projects and their ClickUp List bindings')}
        tableId="components-integrations-integrationsview-clickup-bindings-table"
        state={projectsPending ? 'loading' : undefined}
        className="text-sm"
      />
      {taskListReview && (
        <TaskListMatchReview
          open
          projectId={taskListReview.projectId}
          projectName={taskListReview.projectName}
          lists={clickupLists.filter((list) => !boundListIds.has(list.id))}
          proposedListId={taskListReview.proposedListId}
          canConfirm={canManageIntegrations}
          saving={linkPending}
          error={taskListReviewError}
          onClose={onCloseReview}
          onConfirm={onLinkConfirm}
        />
      )}
      {!clickUpListsUnavailable && !isBindingsPending && !isBindingsError && !projectsPending && !projectsError && (
        <>
          <h5 className="mb-2 mt-5 text-sm font-semibold text-foreground">{t('integrations.organization.readiness.map.untrackedTitle', 'ClickUp Lists PMO does not track')}</h5>
          <ul className="rounded-lg border border-border" aria-label={t('integrations.organization.readiness.map.untrackedAria', 'Untracked ClickUp Lists')}>
            {clickupLists.filter((list) => !boundListIds.has(list.id)).map((list) => (
              <li key={list.id} className="border-b border-border px-3 py-2 text-sm last:border-b-0">
                <span className="font-medium text-foreground">{list.name}</span>
                <span className="ml-2 text-muted-foreground">({list.space_name}{list.folder_name ? ` / ${list.folder_name}` : ''}) — {t('integrations.organization.readiness.map.untrackedNote', 'PMO does not track')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
