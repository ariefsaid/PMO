import { projectsToolbar } from './projects/ProjectsToolbar';
import { ProjectListActions } from './projects/ProjectListActions';
import { useProjectListModel } from './projects/useProjectListModel';
import { projectTableColumns } from './projects/projectTableColumns';
import React, { useState } from 'react';
import {
  ListPage,
  ListState,
  DataTable,
  Button,
  Icon,
  useToast,
  type RowMenuItem,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { useAuth } from '@/src/auth/useAuth';
import { useListReturn } from '@/src/hooks/useListReturn';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackProjectDetailOpened } from '@/src/lib/analytics';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectCard from '../components/ProjectCard';
import ProjectCalendarView from '../components/ProjectCalendarView';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';

/**
 * The status-group SegFilter. Model B (ADR-0020): the pre-win "Leads" partition lives in the
 * Sales Pipeline now (listProjects is scoped to on-hand ∪ internal), so the Projects list has
 * no leads to filter — the "Leads" tab is removed. Surviving filters: All / My Projects /
 * Ongoing / Completed / at-risk (AC-IXD-DASH-W5-C2A: drill destination from dashboard KPIs).
 */

const Projects: React.FC = () => {
  const { t } = useTranslation();
  const projectStatusLabel = useProjectStatusLabel();
  const { effectiveRole, realRole } = useEffectiveRole();
  const may = usePermission();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const model = useProjectListModel(effectiveRole, currentUser, t);
  const { isEngineer, tasksPending, tasksError, refetchTasks, data, isPending, isError, refetch,
    filter, view, calendarCursor, onCalendarCursorChange,
    all, filtered, deliverySummary, deliveryPending, deliveryError, projectMoney, moneyPending, moneyError, refetchMoney,
    isAtRiskActual, milestoneDates, datesPending, datesError, refetchDates, filtersActive, clearFilters } = model;
  const { openRecord } = useListReturn({ list: 'projects', contentReady: !isPending && !isError });
  const { updateHeader, archive } = useProjectMutations();

  const canCreate = may('create', 'project');
  const canEdit = may('edit', 'project');
  const canArchive = may('archive', 'project');
  const canRowWrite = canEdit || canArchive;
  // Contract amounts follow the shared money-view permission (same as project detail).
  const canViewMoney = may('view', 'salesInvoice');

  // Mobile disclosure state (FR-PRJUX-003): Filters closes after a selection; More actions
  // closes after an export dispatch but is deliberately left OPEN when an Import wizard opens
  // (the wizard must stay mounted for its own lifecycle — DD-BIMP-3). Both are controlled here
  // so the mobile toolbar can drive them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // null = closed; { project } = edit modal open.
  const [editTarget, setEditTarget] = useState<ProjectWithRefs | null>(null);
  // null = closed; project = archive confirm open.
  const [archiveTarget, setArchiveTarget] = useState<ProjectWithRefs | null>(null);

  const pageDescription = t('projects.description', 'Pre-win projects live in the Pipeline.');

  // Row/card drill captures the current list URL + scroll as validated return context
  // via `openRecord` (AC-LRC-003) — the canonical `/projects/:id` route is unchanged
  // (AC-NAV-006, no tab). `source` distinguishes the table/list row path from every
  // card-shaped surface (cards, kanban, calendar) for `project_detail_opened`.
  const onOpen = (p: ProjectWithRefs, source: 'list' | 'card' = 'list') => {
    trackProjectDetailOpened('/projects/:projectId', source);
    openRecord(`/projects/${p.id}`);
  };

  // ── rowMenu: Edit (→ editHeader modal) + Archive (→ confirm) ───────────────
  // Mirrors Companies.tsx:141-147 pattern. Gated by the same can() checks the
  // detail-header uses (edit | archive project). ARCHIVE_ROLES = Admin·Exec.
  const rowMenu = (p: ProjectWithRefs): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit)
      items.push({ label: t('projects.actions.edit', 'Edit'), onClick: () => setEditTarget(p) });
    if (canArchive)
      items.push({
        label: t('projects.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(p),
      });
    return items;
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast(t('projects.toast.archived', 'Project archived'), target.name, 'success');
      setArchiveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setArchiveTarget(null);
    }
  };

  const { visibleColumns, exportColumns } = projectTableColumns({
    filtered, deliverySummary, deliveryPending, deliveryError, projectMoney, moneyPending,
    moneyError, canViewMoney, isAtRiskActual, onOpen, projectStatusLabel, t,
  });

  // ── States ──────────────────────────────────────────────────────────────
  const primaryAction = newProjectAction(
    canCreate,
    () => openRecord('/projects/new'),
    t('projects.actions.new', 'New project'),
  );

  if (isPending) {
    return (
      <ListPage
        title={t('projects.title', 'Projects')}
        description={pageDescription}
        primaryAction={primaryAction}
      >
        <div data-testid="projects-loading" className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      </ListPage>
    );
  }

  if (isError || !data) {
    return (
      <ListPage
        title={t('projects.title', 'Projects')}
        description={pageDescription}
        primaryAction={primaryAction}
      >
        <ListState
          variant="error"
          title={t('projects.states.errorTitle', "Couldn't load projects")}
          sub={t('projects.states.errorSub', 'Something went wrong fetching your projects.')}
          onRetry={() => refetch()}
        />
      </ListPage>
    );
  }

  if (all.length === 0 && filter !== 'at-risk') {
    return (
      <ListPage
        title={t('projects.title', 'Projects')}
        description={pageDescription}
        primaryAction={primaryAction}
      >
        <ListState
          variant="empty"
          icon="folder"
          title={t('projects.states.emptyTitle', 'No projects yet')}
          sub={t('projects.states.emptySub', 'Projects you create or win will appear here.')}
          stateId="projects-empty"
          role={realRole ?? undefined}
          module="projects"
          action={
            canCreate
              ? {
                  label: t('projects.actions.new', 'New project'),
                  onClick: () => openRecord('/projects/new'),
                }
              : undefined
          }
        />
      </ListPage>
    );
  }

  const emptyState = {
    title: filter === 'at-risk'
      ? t('projects.empty.nothingAtRiskTitle', 'Nothing at risk')
      : filtersActive ? t('projects.empty.noMatchTitle', 'No projects match these filters')
        : t('projects.states.emptyTitle', 'No projects yet'),
    sub: filter === 'at-risk'
      ? t('projects.empty.nothingAtRiskSub', "No confirmed budget-risk signal is showing. Missing spending or Active budget data can't be assessed.")
      : filtersActive ? t('projects.empty.noMatchSub', 'Try a different status, customer, PM, or search term.')
        : t('projects.states.emptySub', 'Projects you create or win will appear here.'),
    action: filter !== 'at-risk' && filtersActive
      ? { label: t('projects.empty.clearFilters', 'Clear filters'), onClick: clearFilters } : undefined,
  };

  const toolbar = projectsToolbar({ model, exportColumns, t, filtersOpen, setFiltersOpen, moreOpen, setMoreOpen });

  return (
    <ListPage
      title={t('projects.title', 'Projects')}
      description={pageDescription}
      primaryAction={primaryAction}
      {...toolbar}
    >
      {/* Body */}
      {isEngineer && filter === 'My Projects' && tasksPending ? (
        <ListState variant="loading" rows={3} />
      ) : isEngineer && filter === 'My Projects' && tasksError ? (
        <ListState variant="error" title={t('projectDetail.tasks.errorTitle', "Couldn't load tasks")} onRetry={() => void refetchTasks()} />
      ) : filter === 'at-risk' && all.length > 0 && moneyPending ? (
        <ListState variant="loading" rows={3} />
      ) : filter === 'at-risk' && all.length > 0 && moneyError ? (
        <ListState
          variant="error"
          title={t('uxs02.riskUnavailableTitle', "Couldn't check project budget risk")}
          sub={t('uxs02.riskUnavailableSub', 'Project spending and Active budget information could not be checked.')}
          onRetry={() => void refetchMoney()}
        />
      ) : view === 'kanban' ? (
        <ProjectKanbanBoard projects={filtered} onOpen={(p) => onOpen(p, 'card')} />
      ) : view === 'calendar' ? (
        <ProjectCalendarView
          projects={filtered}
          milestoneDates={milestoneDates}
          isPending={filtered.length > 0 && datesPending}
          isError={datesError}
          onRetry={() => void refetchDates()}
          cursor={calendarCursor}
          onCursorChange={onCalendarCursorChange}
          onOpenProject={(id) => {
            trackProjectDetailOpened('/projects/:projectId', 'card');
            openRecord(`/projects/${id}`);
          }}
        />
      ) : view === 'table' ? (
        <>
          <DataTable<ProjectWithRefs>
            rows={filtered}
            columns={visibleColumns}
            rowKey={(p) => p.id}
            tableId="projects-list"
            onActivate={onOpen}
            rowMenu={canRowWrite ? rowMenu : undefined}
            state={filtered.length === 0 ? 'empty' : undefined}
            emptyTitle={emptyState.title}
            emptySub={emptyState.sub}
            emptyAction={emptyState.action}
          />
        </>
      ) : filtered.length === 0 ? (
        <ListState
          variant="empty"
          icon="folder"
          title={emptyState.title}
          sub={emptyState.sub}
          action={emptyState.action}
        />
      ) : (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={(proj) => onOpen(proj, 'card')}
              deliverySummary={deliverySummary?.[p.id]}
              projectMoney={projectMoney?.[p.id]}
              onEdit={canEdit ? (proj) => setEditTarget(proj) : undefined}
            />
          ))}
        </div>
      )}

      <ProjectListActions
        editTarget={editTarget}
        setEditTarget={setEditTarget}
        archiveTarget={archiveTarget}
        setArchiveTarget={setArchiveTarget}
        archivePending={archive?.isPending ?? false}
        onArchiveConfirm={onArchiveConfirm}
        onSave={async (id, input) => {
          await updateHeader.mutateAsync({ id, input });
          toast(t('projects.toast.updated', 'Project updated'), input.name, 'success');
          setEditTarget(null);
        }}
        onError={(err) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        }}
      />
    </ListPage>
  );
};

/**
 * The single per-screen primary "New project" CTA (gated by can('create','project')).
 *
 * The label is passed in rather than written here: this is module scope, so it cannot call a hook,
 * and a literal here would be the one CTA on the page that never follows the viewer's language.
 */
const newProjectAction = (canCreate: boolean | undefined, onNew: () => void, label: string) =>
  canCreate ? (
    <Button variant="primary" onClick={onNew}>
      <Icon name="plus" />
      {label}
    </Button>
  ) : undefined;

export default Projects;
