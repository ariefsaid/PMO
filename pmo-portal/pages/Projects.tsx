import { projectsToolbar } from './projects/ProjectsToolbar';
import { ProjectListActions } from './projects/ProjectListActions';
import { useProjectListModel } from './projects/useProjectListModel';
import { projectTableColumns } from './projects/projectTableColumns';
import React, { useEffect, useRef, useState } from 'react';
import {
  ListPage,
  ListState,
  DataTable,
  FigureScope,
  FigureHiddenLine,
  useFigureReport,
  Button,
  Icon,
  useToast,
  type RowMenuItem,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectMutations } from '@/src/hooks/useProjects';
import { usePrefetchProject } from '@/src/hooks/usePrefetchProject';
import { useAuth } from '@/src/auth/useAuth';
import { useListReturn } from '@/src/hooks/useListReturn';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackProjectDetailOpened } from '@/src/lib/analytics';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectCard from '../components/ProjectCard';
import ProjectCalendarView from '../components/ProjectCalendarView';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';

/** The page's one hidden-figures line: names a column the table dropped, and where it is fixed. */
const ProjectsHiddenFigures: React.FC<{ reason: string | null; setupLink?: { to: string; label: string } }> = ({ reason, setupLink }) => {
  const { t } = useTranslation();
  useFigureReport(reason ? [{ label: t('projects.columns.actual', 'Actual'), reason, link: setupLink }] : []);
  return <FigureHiddenLine className="mb-2 text-control text-muted-foreground" />;
};

/**
 * The status-group SegFilter. Model B (ADR-0020): the pre-win "Leads" partition lives in the
 * Sales Pipeline now (listProjects is scoped to on-hand ∪ internal), so the Projects list has
 * no leads to filter — the "Leads" tab is removed. Surviving filters: All / My Projects /
 * Ongoing / Completed / at-risk (AC-IXD-DASH-W5-C2A: drill destination from dashboard KPIs).
 */

const Projects: React.FC = () => {
  const { t } = useTranslation();
  const { effectiveRole, realRole } = useEffectiveRole();
  const may = usePermission();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const prefetchProject = usePrefetchProject();
  // Contract amounts follow the shared money-view permission (same as project detail).
  const canViewMoney = may('view', 'salesInvoice');
  const canManageAccounting = may('manage', 'orgAccounting');
  const model = useProjectListModel(effectiveRole, currentUser, t, canViewMoney);
  const { isEngineer, tasksPending, tasksError, refetchTasks, data, isPending, isError, refetch,
    filter, view, calendarCursor, onCalendarCursorChange,
    all, filtered, deliverySummary, deliveryPending, deliveryError, projectMoney, moneyPending, moneyError, refetchMoney,
    isAtRiskActual, milestoneDates, datesPending, datesError, refetchDates, filtersActive, clearFilters } = model;
  const projectScopeRead = isEngineer && filter === 'My Projects';
  const riskScopeRead = filter === 'at-risk' && all.length > 0;
  const secondaryReadPending = (projectScopeRead && tasksPending) || (riskScopeRead && moneyPending);
  const secondaryReadError = (projectScopeRead && tasksError) || (riskScopeRead && moneyError);
  const secondaryReadUnavailable = secondaryReadPending || secondaryReadError;
  const filteredSnapshotKey = JSON.stringify([effectiveRole, currentUser?.id, currentUser?.org_id, model.workingSet, model.search]);
  const lastFilteredSnapshot = useRef<{ key: string; rows: ProjectWithRefs[] } | null>(null);
  const lastAtRiskSnapshot = useRef<{ viewerId: string | undefined; byProjectId: Map<string, boolean> } | null>(null);
  const currentProjectsById = new Map<string, ProjectWithRefs>(all.map((project) => [project.id, project] as const));
  const cachedFiltered = lastFilteredSnapshot.current?.key === filteredSnapshotKey
    ? lastFilteredSnapshot.current.rows.flatMap((project) => {
      const current = currentProjectsById.get(project.id);
      return current ? [current] : [];
    })
    : null;
  const displayFiltered = secondaryReadUnavailable && cachedFiltered ? cachedFiltered : filtered;
  const displayIsAtRiskActual = (project: ProjectWithRefs) => {
    const cachedRisk = lastAtRiskSnapshot.current;
    if ((moneyPending || moneyError) && cachedRisk && cachedRisk.viewerId === currentUser?.id && cachedRisk.byProjectId.has(project.id)) {
      return cachedRisk.byProjectId.get(project.id)!;
    }
    return isAtRiskActual(project);
  };
  useEffect(() => {
    if (secondaryReadUnavailable) return;
    lastFilteredSnapshot.current = { key: filteredSnapshotKey, rows: filtered };
  }, [filtered, filteredSnapshotKey, secondaryReadUnavailable]);
  useEffect(() => {
    if (moneyPending || moneyError) return;
    lastAtRiskSnapshot.current = {
      viewerId: currentUser?.id,
      byProjectId: new Map<string, boolean>(all.map((project) => [project.id, isAtRiskActual(project)] as const)),
    };
  }, [all, currentUser?.id, isAtRiskActual, moneyError, moneyPending]);
  const { openRecord } = useListReturn({ list: 'projects', contentReady: !isPending && !isError });
  const { updateHeader, archive } = useProjectMutations();

  const canCreate = may('create', 'project');
  const canEdit = may('edit', 'project');
  const canArchive = may('archive', 'project');
  const canRowWrite = canEdit || canArchive;

  // More actions closes after an export dispatch but is deliberately left OPEN when an Import wizard
  // opens (the wizard must stay mounted for its own lifecycle — DD-BIMP-3); controlled here so the
  // toolbar can drive it.
  const [moreOpen, setMoreOpen] = useState(false);
  // null = closed; { project } = edit modal open.
  const [editTarget, setEditTarget] = useState<ProjectWithRefs | null>(null);
  // null = closed; project = archive confirm open.
  const [archiveTarget, setArchiveTarget] = useState<ProjectWithRefs | null>(null);

  // Row/card drill captures the current list URL + scroll as validated return context
  // via `openRecord` (AC-LRC-003) — the canonical `/projects/:id` route is unchanged
  // (AC-NAV-006, no tab). `source` distinguishes the table/list row path from every
  // card-shaped surface (cards, kanban, calendar) for `project_detail_opened`.
  const onOpen = (p: ProjectWithRefs, source: 'list' | 'card' = 'list') => {
    prefetchProject(p.id);
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

  const { tableColumns, exportColumns, actualHiddenReason, sharedBasis, sharedManager, mobileCardTitle, mobileCardDetails } = projectTableColumns({
    filtered: displayFiltered, deliverySummary, deliveryPending, deliveryError, projectMoney, moneyPending,
    moneyError, canViewMoney, viewerId: currentUser?.id, isAtRiskActual: displayIsAtRiskActual, onOpen, onPrefetch: prefetchProject, t,
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
        primaryAction={primaryAction}
      >
        <div data-testid="projects-loading" className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={6} rows={6} />
        </div>
      </ListPage>
    );
  }

  if (isError || !data) {
    return (
      <ListPage
        title={t('projects.title', 'Projects')}
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
        count={0}
        total={0}
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

  const toolbar = projectsToolbar({ model, exportColumns, t, canViewMoney, moreOpen, setMoreOpen });

  return (
    <ListPage
      title={t('projects.title', 'Projects')}
      primaryAction={primaryAction}
      mobileToolbarBreakpoint={1280}
      {...toolbar}
    >
      {/* Body */}
      {projectScopeRead && tasksError && (
        <ListState variant="error" title={t('projectDetail.tasks.errorTitle', "Couldn't load tasks")} onRetry={() => void refetchTasks()} />
      )}
      {riskScopeRead && moneyError && (
        <ListState
          variant="error"
          title={t('uxs02.riskUnavailableTitle', "Couldn't check project budget risk")}
          sub={t('uxs02.riskUnavailableSub', 'Project spending and Active budget information could not be checked.')}
          onRetry={() => void refetchMoney()}
        />
      )}
      {secondaryReadPending && <span role="status" className="sr-only">{t('common.ui.listState.loading', 'Loading…')}</span>}
      {view === 'kanban' ? (
        <ProjectKanbanBoard projects={displayFiltered} onOpen={(p) => onOpen(p, 'card')} />
      ) : view === 'calendar' ? (
        <ProjectCalendarView
          projects={displayFiltered}
          milestoneDates={milestoneDates}
          isPending={filtered.length > 0 && datesPending}
          isError={datesError}
          onRetry={() => void refetchDates()}
          cursor={calendarCursor}
          onCursorChange={onCalendarCursorChange}
          onOpenProject={(id) => {
            prefetchProject(id);
            trackProjectDetailOpened('/projects/:projectId', 'card');
            openRecord(`/projects/${id}`);
          }}
        />
      ) : view === 'table' ? (
        <div
          data-testid="projects-table-container"
          onPointerOver={(e) => {
            const tr = (e.target as HTMLElement).closest('tr');
            if (tr?.id) prefetchProject(tr.id);
          }}
          onFocusCapture={(e) => {
            const tr = (e.target as HTMLElement).closest('tr');
            if (tr?.id) prefetchProject(tr.id);
          }}
        >
          <FigureScope>
            <ProjectsHiddenFigures reason={actualHiddenReason} setupLink={canManageAccounting ? { to: '/administration/accounting#budget-account-map', label: t('projects:coverage.setUp', 'Set up') } : undefined} />
          </FigureScope>
          {sharedBasis && canViewMoney && <p className="mb-2 text-control text-muted-foreground md:hidden">{t('projects:contractBasisNote', 'Contract amounts are {{basis}}.', { basis: sharedBasis })}</p>}
          {sharedManager && <p className="mb-2 text-control text-muted-foreground">{t('projects:sharedManagerNote', 'Project manager: {{name}}', { name: sharedManager })}</p>}
          <DataTable<ProjectWithRefs>
            rows={displayFiltered}
            columns={tableColumns}
            className="[--table-row-min-height:40px]"
            compactRows
            mobileCardTitle={mobileCardTitle}
            mobileCardDetails={mobileCardDetails}
            cardBelow={1120}
            rowKey={(p) => p.id}
            rowTarget={(p) => p.id}
            tableId="projects-list"
            onActivate={onOpen}
            rowMenu={canRowWrite ? rowMenu : undefined}
            state={displayFiltered.length === 0 && !secondaryReadUnavailable ? 'empty' : undefined}
            emptyTitle={emptyState.title}
            emptySub={emptyState.sub}
            emptyAction={emptyState.action}
          />
        </div>
      ) : displayFiltered.length === 0 && !secondaryReadUnavailable ? (
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
          {displayFiltered.map((p) => (
            <div
              key={p.id}
              onPointerEnter={() => prefetchProject(p.id)}
              onFocusCapture={() => prefetchProject(p.id)}
            >
              <ProjectCard
                project={p}
                onOpen={(proj) => onOpen(proj, 'card')}
                deliverySummary={deliverySummary?.[p.id]}
                projectMoney={projectMoney?.[p.id]}
                moneyPending={moneyPending}
                moneyError={moneyError}
                onEdit={canEdit ? (proj) => setEditTarget(proj) : undefined}
              />
            </div>
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
