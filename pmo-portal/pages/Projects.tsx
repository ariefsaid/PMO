import React, { useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ProgressBar,
  SelectField,
  Button,
  Icon,
  useToast,
  type Column,
} from '@/src/components/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import {
  useProjects,
  useClientCompanies,
  useProjectManagers,
  useProjectMutations,
  useProjectsMilestoneDates,
} from '@/src/hooks/useProjects';
import { useAuth } from '@/src/auth/useAuth';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useProjectView } from '@/src/hooks/useProjectView';
import { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatCompactCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';
import { ProjectStatus as ProjectStatusEnum } from '../types';
import { pillVariantForProjectStatus, projectIconColor } from '../components/projects';
import ProjectCard from '../components/ProjectCard';
import ProjectStatusControl from '../components/ProjectStatusControl';
import ProjectFormModal from '../components/ProjectFormModal';
import ProjectCalendarView from '../components/ProjectCalendarView';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';
import { isAtRiskByCommitted } from '@/src/lib/dashboardConstants';

/**
 * The status-group SegFilter. Model B (ADR-0020): the pre-win "Leads" partition lives in the
 * Sales Pipeline now (listProjects is scoped to on-hand ∪ internal), so the Projects list has
 * no leads to filter — the "Leads" tab is removed. Surviving filters: All / My Projects /
 * Ongoing / Completed / at-risk (AC-IXD-DASH-W5-C2A: drill destination from dashboard KPIs).
 */
type StatusFilter = 'All' | 'My Projects' | 'Ongoing' | 'Completed' | 'at-risk';
const FILTERS: StatusFilter[] = ['All', 'My Projects', 'Ongoing', 'Completed', 'at-risk'];

/** Values accepted as ?filter= URL params. Any unrecognised param falls back to the role default. */
const VALID_URL_FILTERS = new Set<StatusFilter>(FILTERS);

const ONGOING = [ProjectStatusEnum.Ongoing, ProjectStatusEnum.WonPendingKoM, ProjectStatusEnum.OnHold] as string[];
const COMPLETED = [ProjectStatusEnum.CloseOut, ProjectStatusEnum.Loss] as string[];

const Projects: React.FC = () => {
  const { effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useAuth();
  const isEngineer = effectiveRole === 'Engineer';
  // B-11 fix: an IC's "My Projects" means projects they are ASSIGNED to (have a task on),
  // NOT projects they manage (an Engineer manages none → the old PM-scoped filter was always
  // empty, so the Engineer default landed on a blank list). Derive the assigned-project set
  // from the Engineer's own tasks (the same cross-project, RLS-org-scoped read My Tasks uses;
  // cached under the shared 'my-tasks' key). Only consumed for the Engineer branch.
  const { data: myTasks } = useMyTasks();
  const myProjectIds = useMemo(
    () => new Set((myTasks ?? []).map((t) => t.project_id)),
    [myTasks],
  );
  const { data, isPending, isError, refetch } = useProjects();
  const { data: clientCompanies = [] } = useClientCompanies();
  const { data: projectManagers = [] } = useProjectManagers();
  const { create } = useProjectMutations();

  const canCreate = may('create', 'project');

  const [view, setView] = useProjectView();

  // AC-IXD-DASH-W5-C2A: URL search-param read-on-mount convention. A ?filter=<value> param
  // drills directly into the requested filter segment (e.g. from a dashboard KPI link).
  // Backward-compatible: no param => role-based default (Engineers default to "My Projects",
  // all others to "All"). Unrecognised values fall back to the role default silently.
  const roleDefault: StatusFilter = effectiveRole === 'Engineer' ? 'My Projects' : 'All';
  const urlFilter = searchParams.get('filter') as StatusFilter | null;
  const initialFilter: StatusFilter =
    urlFilter && VALID_URL_FILTERS.has(urlFilter) ? urlFilter : roleDefault;

  // B-11 (AC-W2-IXD-009): Engineers default to "My Projects" — they are ICs who
  // want their own assigned work, not the full org project list. All other roles
  // default to "All" (unscoped manager view). `effectiveRole` is used here so that
  // an impersonated-as-Engineer session also gets the scoped default, matching the
  // intent of "what would an Engineer see?" consistently.
  const [filter, setFilter] = useState<StatusFilter>(initialFilter);
  const [filterClient, setFilterClient] = useState('All');
  const [filterPM, setFilterPM] = useState('All');
  const [search, setSearch] = useState('');
  // null = closed; true = the create-deal modal is open.
  const [createOpen, setCreateOpen] = useState(false);

  const all = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);

  // NFR-DEL-PERF-001: one batched call for all project delivery summaries (no per-row N+1).
  const { data: deliverySummary, isPending: deliveryPending } = useProjectsDeliverySummary(all.map((p) => p.id));

  // I6: committed-spend-based at-risk (not stale p.spent/p.budget). Derives from the SAME
  // committed-spend summary used in the Budget used column, and routes through the shared
  // canonical rule (isAtRiskByCommitted): active-status gate + budget>0 guard + >= 0.9.
  const isAtRiskCommitted = React.useCallback(
    (p: ProjectWithRefs) => {
      const summary = deliverySummary?.[p.id];
      if (!summary) return false;
      return isAtRiskByCommitted({
        status: p.status as string,
        budget: summary.budget,
        committedSpend: summary.committedSpend,
      });
    },
    [deliverySummary],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all
      .filter((p) => {
        switch (filter) {
          case 'My Projects':
            // Managers: projects I manage. ICs (Engineer): projects I'm assigned to (via tasks).
            return isEngineer
              ? myProjectIds.has(p.id)
              : p.project_manager_id === currentUser?.id;
          case 'Ongoing':
            return ONGOING.includes(p.status as string);
          case 'Completed':
            return COMPLETED.includes(p.status as string);
          // I6: at-risk now uses committed-spend from delivery summary, not stale p.spent.
          case 'at-risk':
            return isAtRiskCommitted(p);
          default:
            return true;
        }
      })
      .filter((p) => filterClient === 'All' || p.client_id === filterClient)
      .filter((p) => filterPM === 'All' || p.project_manager_id === filterPM)
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q),
      );
    // AC-IXD-DASH-W5-C2C N18: within the result, sort at-risk rows to the top.
    // Stable: JS sort is stable, so non-at-risk rows keep their original relative order.
    // Applied to all views so the ordering is consistent regardless of the active segment.
    return rows.sort((a, b) => (isAtRiskCommitted(a) ? 0 : 1) - (isAtRiskCommitted(b) ? 0 : 1));
  }, [all, filter, filterClient, filterPM, search, currentUser?.id, isEngineer, myProjectIds, isAtRiskCommitted]);

  // Dated milestones for the calendar view — one batched read for the visible set
  // (NFR-CAL-PERF-001). Gated on view === 'calendar' so the RPC is skipped on table/cards loads.
  const { data: milestoneDates } = useProjectsMilestoneDates(
    filtered.map((p) => p.id),
    view === 'calendar',
  );

  // Filter-select option lists (the tokened SelectField consumes {value,label});
  // the leading "All …" sentinel value is the cleared state.
  const customerFilterOptions = useMemo(
    () => [
      { value: 'All', label: 'All customers' },
      ...clientCompanies.map((c) => ({ value: c.id, label: c.name })),
    ],
    [clientCompanies],
  );
  const pmFilterOptions = useMemo(
    () => [
      { value: 'All', label: 'All managers' },
      ...projectManagers.map((u) => ({ value: u.id, label: u.full_name })),
    ],
    [projectManagers],
  );

  const filtersActive =
    filter !== 'All' || filterClient !== 'All' || filterPM !== 'All' || search.trim() !== '';

  const clearFilters = () => {
    setFilter('All');
    setFilterClient('All');
    setFilterPM('All');
    setSearch('');
  };

  // Row/card drill is a plain react-router navigate (AC-NAV-006) — no tab.
  const onOpen = (p: ProjectWithRefs) => navigate(`/projects/${p.id}`);

  // The create-deal modal — rendered in every page state (the gated CTA in Header
  // can open it from loading/error/empty/success alike). Hidden when createOpen is false.
  const createModal = createOpen ? (
    <ProjectFormModal
      onClose={() => setCreateOpen(false)}
      onSubmit={async (input) => {
        await create.mutateAsync(input);
        toast('Deal created', input.name, 'success');
        setCreateOpen(false);
      }}
      onError={(err) => {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
      }}
    />
  ) : null;

  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: 'Project',
      cell: (p) => {
        const atRisk = isAtRiskCommitted(p);
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
              style={{ background: projectIconColor() }}
            >
              {(p.name.trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(p);
                  }}
                  className="block max-w-[40ch] truncate text-left font-semibold hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  title={p.name}
                >
                  {p.name}
                </button>
                {/* AC-IXD-DASH-W5-C2C N18/I3: text+dot pill (not color-only). */}
                {atRisk && <StatusPill variant="warn">At risk</StatusPill>}
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {p.code ?? p.id.slice(0, 8)}
              </div>
              {p.customer_contract_ref && (
                <div className="truncate font-mono text-[11px] text-muted-foreground/80">
                  {p.customer_contract_ref}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (p) => <span>{p.client?.name ?? '—'}</span>,
      // Hide below 1280px — frees ~120px so Progress+Action columns fit at 1180px
      colClassName: 'hidden xl:table-cell',
    },
    {
      key: 'pm',
      header: 'PM',
      // M-D: the PM name no longer truncates ("Alice Mana…"); it wraps within the
      // roomy 54px row. whitespace-normal overrides the cell's whitespace-nowrap.
      cell: (p) => (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="grid size-[18px] shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground"
          >
            {(p.pm?.full_name?.trim().charAt(0) ?? '?').toUpperCase()}
          </span>
          <span className="whitespace-normal leading-tight">{p.pm?.full_name ?? 'Unassigned'}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (
        <StatusPill variant={pillVariantForProjectStatus(p.status as string)}>{p.status}</StatusPill>
      ),
    },
    {
      key: 'contract',
      header: 'Contract',
      align: 'num',
      cell: (p) => formatCurrency(p.contract_value),
    },
    {
      key: 'actual',
      header: 'Actual',
      align: 'num',
      cell: (p) => <span className="text-muted-foreground">{formatCurrency(p.spent)}</span>,
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of false empty state.
        if (deliveryPending) {
          return <span className="text-[12px] text-muted-foreground">…</span>;
        }
        const summary = deliverySummary?.[p.id];
        if (summary?.deliveryPct == null) {
          return <span className="text-[12px] text-muted-foreground">No phases yet</span>;
        }
        const roundedDelivery = Math.round(summary.deliveryPct);
        return (
          <div className="flex flex-col gap-0.5">
            <ProgressBar value={roundedDelivery} showValue compact aria-label={`Delivery ${roundedDelivery}%`} />
          </div>
        );
      },
    },
    {
      key: 'budget-used',
      header: 'Budget used',
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of $0/$0.
        if (deliveryPending) {
          return <span className="text-[12px] text-muted-foreground">…</span>;
        }
        const summary = deliverySummary?.[p.id];
        // If no summary or no budget, show a muted dash instead of misleading "$0 of $0 budget".
        if (!summary || summary.budget <= 0) {
          return <span className="text-[12px] text-muted-foreground">—</span>;
        }
        const budgetUsedPct = Math.round((summary.committedSpend / summary.budget) * 100);
        return (
          <div className="flex flex-col gap-0.5">
            <ProgressBar value={budgetUsedPct} showValue compact aria-label={`Budget used ${budgetUsedPct}%`} />
            <div className="text-[11px] text-muted-foreground">
              {`${formatCompactCurrency(summary.committedSpend)} of ${formatCompactCurrency(summary.budget)} budget`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'transition',
      header: 'Action',
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ProjectStatusControl
            project={{
              id: p.id,
              status: p.status as ProjectStatus,
              customer_contract_ref: p.customer_contract_ref,
            }}
          />
        </div>
      ),
    },
  ];

  // ── States ──────────────────────────────────────────────────────────────
  const primaryAction = newProjectAction(canCreate, () => setCreateOpen(true));

  if (isPending) {
    return (
      <ListPage title="Projects" description={PAGE_DESCRIPTION} primaryAction={primaryAction}>
        <div data-testid="projects-loading" className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
        {createModal}
      </ListPage>
    );
  }

  if (isError || !data) {
    return (
      <ListPage title="Projects" description={PAGE_DESCRIPTION} primaryAction={primaryAction}>
        <ListState
          variant="error"
          title="Couldn't load projects"
          sub="Something went wrong fetching your projects."
          onRetry={() => refetch()}
        />
        {createModal}
      </ListPage>
    );
  }

  if (all.length === 0) {
    return (
      <ListPage title="Projects" description={PAGE_DESCRIPTION} primaryAction={primaryAction}>
        <ListState
          variant="empty"
          icon="folder"
          title="No projects yet"
          sub="Projects you create or win will appear here."
          action={
            canCreate ? { label: 'New project', onClick: () => setCreateOpen(true) } : undefined
          }
        />
        {createModal}
      </ListPage>
    );
  }

  return (
    <ListPage
      title="Projects"
      description={PAGE_DESCRIPTION}
      primaryAction={primaryAction}
      filters={
        /* AC-2: wrap in overflow-x-auto so the full filter strip (incl. "At risk") is
           reachable at 390px without clipping. scroll-fade-x adds the right-edge fade
           affordance (the project tab strip pattern). */
        <div data-testid="status-filter-scroll" className="overflow-x-auto scroll-fade-x">
          <ViewToggle<StatusFilter>
            options={FILTERS.map((f) => ({ value: f, label: f === 'at-risk' ? 'At risk' : f }))}
            value={filter}
            onChange={setFilter}
            ariaLabel="Status filter"
          />
        </div>
      }
      search={
        <SearchMini
          placeholder="Search projects…"
          aria-label="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0"
        />
      }
      secondaryFilter={
        /*
          N19 (AC-IXD-PIPE-W5-C5): The customer and PM filter dropdowns are manager-browse
          tools — an Engineer manages no projects and cares only about their assigned work.
          For the Engineer scope they are hidden so the toolbar leads with the relevant
          SegFilter (already defaulted to "My Projects" per B-11). Non-Engineer roles keep
          the full toolbar unchanged (FE-only on effectiveRole; no state/permission change).
        */
        !isEngineer ? (
          <>
            <SelectField
              hideLabel
              label="Filter by customer"
              value={filterClient}
              onChange={setFilterClient}
              options={customerFilterOptions}
              className="w-auto"
            />
            <SelectField
              hideLabel
              label="Filter by project manager"
              value={filterPM}
              onChange={setFilterPM}
              options={pmFilterOptions}
              className="w-auto"
            />
          </>
        ) : undefined
      }
      view={
        /*
          A-MIN-1 (updated, AC-MOB-VT): Wave-0 hid the entire toggle below md because Table+Cards
          were the only options and DataTable auto-renders cards on mobile (toggle was a no-op).
          Now that Calendar (day-agenda) and Kanban (horizontal-scroll) have real mobile renders,
          those views need to be reachable on phones. Fix: hide only the Table option below md via
          `wrapperClassName="hidden md:block"` on the Table ViewOption. Cards / Calendar / Kanban
          are always visible. Desktop (≥md) shows all four unchanged.
          NOTE: Must use wrapperClassName, NOT optionClassName. cn() is clsx-only (no tailwind-
          merge), so `hidden` on the button itself conflicts with the button's base `inline-flex`
          class — both land in the class string and `inline-flex` wins, leaving the option visible.
          A wrapper <span> has no competing display value, so `hidden` takes effect correctly.
        */
        <ViewToggle<'table' | 'cards' | 'calendar' | 'kanban'>
          options={[
            { value: 'table', label: 'Table', icon: 'table', wrapperClassName: 'hidden md:block' },
            { value: 'cards', label: 'Cards', icon: 'cards' },
            { value: 'calendar', label: 'Calendar', icon: 'cal' },
            { value: 'kanban', label: 'Board', icon: 'cols' },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="Projects view"
        />
      }
    >
      {/* Body */}
      {view === 'kanban' ? (
        <ProjectKanbanBoard projects={filtered} onOpen={onOpen} />
      ) : view === 'calendar' ? (
        <ProjectCalendarView
          projects={filtered}
          milestoneDates={milestoneDates}
          onOpenProject={(id) => navigate(`/projects/${id}`)}
        />
      ) : view === 'table' ? (
        <DataTable<ProjectWithRefs>
          rows={filtered}
          columns={columns}
          rowKey={(p) => p.id}
          onActivate={onOpen}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={
            filter === 'at-risk'
              ? 'Nothing at risk'
              : filtersActive ? 'No projects match these filters' : 'No projects yet'
          }
          emptySub={
            filter === 'at-risk'
              ? 'Every active project is under 90% budget — nothing needs attention right now.'
              : filtersActive
                ? 'Try a different status, customer, PM, or search term.'
                : 'Projects you create or win will appear here.'
          }
          emptyAction={
            filter === 'at-risk'
              ? undefined
              : filtersActive ? { label: 'Clear filters', onClick: clearFilters } : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <ListState
          variant="empty"
          icon="folder"
          title={
            filter === 'at-risk'
              ? 'Nothing at risk'
              : filtersActive ? 'No projects match these filters' : 'No projects yet'
          }
          sub={
            filter === 'at-risk'
              ? 'Every active project is under 90% budget — nothing needs attention right now.'
              : filtersActive
                ? 'Try a different status, customer, PM, or search term.'
                : 'Projects you create or win will appear here.'
          }
          action={
            filter === 'at-risk'
              ? undefined
              : filtersActive ? { label: 'Clear filters', onClick: clearFilters } : undefined
          }
        />
      ) : (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpen} deliverySummary={deliverySummary?.[p.id]} />
          ))}
        </div>
      )}
      {createModal}
    </ListPage>
  );
};

/** Page subtitle — shared across the loading / error / empty / list `ListPage` shells. */
const PAGE_DESCRIPTION =
  'Track your active and completed projects. Open one to drill into its budget, procurement, and detail. Pre-win projects live in the Pipeline.';

/** The single per-screen primary "New project" CTA (gated by can('create','project')). */
const newProjectAction = (canCreate: boolean | undefined, onNew: () => void) =>
  canCreate ? (
    <Button variant="primary" onClick={onNew}>
      <Icon name="plus" />
      New project
    </Button>
  ) : undefined;

export default Projects;
