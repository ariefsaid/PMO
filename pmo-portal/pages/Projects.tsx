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
  ConfirmDialog,
  Button,
  Icon,
  useToast,
  CompanyNameLink,
  MobileToolbarDisclosure,
  type Column,
  type RowMenuItem,
  TaxBasisLabel,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { makeProjectImportDescriptor, makeBudgetImportDescriptor } from '@/src/lib/import';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
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
import { trackProjectDetailOpened, trackFilterApplied } from '@/src/lib/analytics';
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
import { projectManagerLabel, UNASSIGNED_PROJECT_MANAGER } from '@/src/lib/projects/projectManagerLabel';

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
  const { t } = useTranslation();
  const { effectiveRole, realRole } = useEffectiveRole();
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
  const clientCompaniesResult = useClientCompanies();
  const projectManagersResult = useProjectManagers();
  // Stable array references so the option-list/import useMemos (which list them as deps)
  // don't recompute every render when a query is still resolving to `undefined`.
  const clientCompanies = useMemo(() => clientCompaniesResult.data ?? [], [clientCompaniesResult.data]);
  const projectManagers = useMemo(() => projectManagersResult.data ?? [], [projectManagersResult.data]);
  const { create, updateHeader, archive } = useProjectMutations();

  const canCreate = may('create', 'project');
  const canEdit = may('edit', 'project');
  const canArchive = may('archive', 'project');
  const canRowWrite = canEdit || canArchive;

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
  // Mobile disclosure state (FR-PRJUX-003): Filters closes after a selection; More actions
  // closes after an export dispatch but is deliberately left OPEN when an Import wizard opens
  // (the wizard must stay mounted for its own lifecycle — DD-BIMP-3). Both are controlled here
  // so the mobile toolbar can drive them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // null = closed; true = the create-deal modal is open.
  const [createOpen, setCreateOpen] = useState(false);
  // null = closed; { project } = edit modal open.
  const [editTarget, setEditTarget] = useState<ProjectWithRefs | null>(null);
  // null = closed; project = archive confirm open.
  const [archiveTarget, setArchiveTarget] = useState<ProjectWithRefs | null>(null);

  const all = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);

  // NFR-DEL-PERF-001: one batched call for all project delivery summaries (no per-row N+1).
  const { data: deliverySummary, isPending: deliveryPending, isError: deliveryError } = useProjectsDeliverySummary(all.map((p) => p.id));

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
      // FR-PRJUX-005: three explicit PM branches — All bypasses; the sentinel matches
      // ONLY `project_manager_id == null`; a real ID matches equality. An unnamed-but-
      // ASSIGNED profile therefore never reads as unassigned.
      .filter((p) => {
        if (filterPM === 'All') return true;
        if (filterPM === UNASSIGNED_PROJECT_MANAGER) return p.project_manager_id == null;
        return p.project_manager_id === filterPM;
      })
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

  /**
   * The label for each status segment. The VALUE stays the untranslated English token — it is
   * `?filter=` URL state, analytics input and `filtersActive`'s comparison basis, so translating
   * it would break a shared drill-in link the moment the viewer's language differs from the
   * sender's. Only the word on the button moves.
   */
  const filterLabels: Record<StatusFilter, string> = {
    All: t('projects.filters.all', 'All'),
    'My Projects': t('projects.filters.myProjects', 'My Projects'),
    Ongoing: t('projects.filters.ongoing', 'Ongoing'),
    Completed: t('projects.filters.completed', 'Completed'),
    'at-risk': t('projects.filters.atRisk', 'At risk'),
  };

  const pageDescription = t(
    'projects.description',
    'Track your active and completed projects. Open one to drill into its budget, procurement, and detail. Pre-win projects live in the Pipeline.',
  );

  // Filter-select option lists (the tokened SelectField consumes {value,label});
  // the leading "All …" sentinel value is the cleared state.
  const customerFilterOptions = useMemo(
    () => [
      { value: 'All', label: t('projects.filters.allCustomers', 'All customers') },
      ...clientCompanies.map((c) => ({ value: c.id, label: c.name })),
    ],
    [clientCompanies, t],
  );
  const importDescriptor = useMemo(
    () =>
      makeProjectImportDescriptor(
        clientCompanies,
        projectManagers.map((m) => ({ id: m.id, name: m.full_name })),
      ),
    [clientCompanies, projectManagers],
  );
  // #495: budget lines are a SECOND importer on this page. There is no budgets route to hang it on
  // (budget is a project tab, `appRouteConfig`), and the sheet is cross-project by construction —
  // its first column is a project ref (DD-BIMP-4).
  // ⚑ The batch id is minted ONCE per mount, exactly as `useProcurementCycleImport` does. It is
  // provenance, NOT the idempotency key: keying on it is what made 0072's re-run leak (DD-BIMP-3).
  const budgetImportBatchId = useMemo(() => crypto.randomUUID(), []);
  const budgetImportDescriptor = useMemo(
    () => makeBudgetImportDescriptor(all.map((p) => ({ id: p.id, name: p.name })), budgetImportBatchId),
    [all, budgetImportBatchId],
  );
  // FR-PRJUX-004/005: every PM option carries a nonempty visible label. A blank-name
  // assigned profile renders `Unnamed user · <short ID>` (still filters by its real ID);
  // the genuinely-unassigned filter is a non-ID sentinel, never a profile ID.
  const pmFilterOptions = useMemo(
    () => [
      { value: 'All', label: t('projects.filters.allManagers', 'All managers') },
      {
        value: UNASSIGNED_PROJECT_MANAGER,
        label: t('projects.unassigned', 'Unassigned'),
      },
      ...projectManagers.map((u) => ({
        value: u.id,
        label: projectManagerLabel({
          managerId: u.id,
          fullName: u.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        }),
      })),
    ],
    [projectManagers, t],
  );

  const filtersActive =
    filter !== 'All' || filterClient !== 'All' || filterPM !== 'All' || search.trim() !== '';
  const hasNonDefaultFilter =
    filter !== roleDefault || filterClient !== 'All' || filterPM !== 'All' || search.trim() !== '';

  // AC-PRJUX-002: Clear all returns the list to the role-default status (All for
  // PM/Admin, My Projects for Engineer), not a literal 'All', while clearing customer,
  // PM, and search. Keeps the status URL/analytics inputs unchanged.
  const clearFilters = () => {
    setFilter(roleDefault);
    setFilterClient('All');
    setFilterPM('All');
    setSearch('');
  };

  // Row/card drill is a plain react-router navigate (AC-NAV-006) — no tab.
  // `source` distinguishes the table/list row path from every card-shaped surface
  // (cards, kanban, calendar) for `project_detail_opened` (2026-07-13 wiring plan).
  const onOpen = (p: ProjectWithRefs, source: 'list' | 'card' = 'list') => {
    trackProjectDetailOpened('/projects/:projectId', source);
    navigate(`/projects/${p.id}`);
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

  // The create-deal modal — rendered in every page state (the gated CTA in Header
  // can open it from loading/error/empty/success alike). Hidden when createOpen is false.
  const createModal = createOpen ? (
    <ProjectFormModal
      onClose={() => setCreateOpen(false)}
      onSubmit={async (input) => {
        await create.mutateAsync(input);
        toast(t('projects.toast.created', 'Project created'), input.name, 'success');
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
      header: t('projects.columns.project', 'Project'),
      exportValue: (p) => p.name,
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
                  className="block max-w-[40ch] truncate text-left font-semibold hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  title={p.name}
                >
                  {p.name}
                </button>
                {/* AC-IXD-DASH-W5-C2C N18/I3: text+dot pill (not color-only). */}
                {atRisk && (
                  <StatusPill variant="warn">{t('projects.atRiskPill', 'At risk')}</StatusPill>
                )}
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
      header: t('projects.columns.customer', 'Customer'),
      exportValue: (p) => p.client?.name ?? '',
      // PL-1 (AC-JR-W3B-E1): customer name is now a CompanyNameLink so execs/PMs
      // can navigate directly to the client record. stopPropagation prevents the
      // row's own click handler (which opens the project detail) from firing when
      // the user clicks the company link.
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          <CompanyNameLink
            companyId={p.client_id}
            name={p.client?.name ?? null}
            className="text-[13px]"
          />
        </div>
      ),
      // Hide below 1280px — frees ~120px so Progress+Action columns fit at 1180px
      colClassName: 'hidden xl:table-cell',
    },
    {
      key: 'pm',
      header: t('projects.columns.pm', 'PM'),
      // FR-PRJUX-004/005: an assigned blank-name profile exports its readable fallback,
      // and is never exported as "unassigned".
      exportValue: (p) =>
        projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        }),
      // M-D: the PM name no longer truncates ("Alice Mana…"); it wraps within the
      // roomy 54px row. whitespace-normal overrides the cell's whitespace-nowrap.
      cell: (p) => {
        const label = projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        });
        return (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="grid size-[18px] shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground"
            >
              {(label.trim().charAt(0) || '?').toUpperCase()}
            </span>
            <span className="whitespace-normal leading-tight">{label}</span>
          </span>
        );
      },
    },
    {
      key: 'status',
      // ⚑ The pill CONTENT (`p.status`) is a database enum, not a literal — localising workflow
      // status labels is its own decision (it needs one map every surface shares) and is not in
      // this pass. Only the column header moves.
      header: t('projects.columns.status', 'Status'),
      exportValue: (p) => String(p.status),
      cell: (p) => (
        <StatusPill variant={pillVariantForProjectStatus(p.status as string)}>{p.status}</StatusPill>
      ),
    },
    {
      key: 'contract',
      header: t('projects.columns.contract', 'Contract'),
      align: 'num',
      exportValue: (p) => p.contract_value,
      // FR-L10N-020: each row is one project, so the currency is that project's own (0187's
      // per-record column) — an org default would be wrong the moment two currencies coexist.
      // OD-TAX-1 §2: a contract figure carries its basis wherever it is rendered. A list is the
      // surface where two projects on OPPOSITE bases sit one row apart — a column of bare numbers
      // there reads as comparable when it is not.
      cell: (p) => (
        <span className="inline-flex items-baseline gap-1.5">
          {formatCurrency(p.contract_value, p.currency)}
          <TaxBasisLabel treatment={p.tax_treatment} />
        </span>
      ),
    },
    {
      key: 'actual',
      header: t('projects.columns.actual', 'Actual'),
      align: 'num',
      // AC-MONEY-01: use the live committed-PO basis from deliverySummary, not the dead
      // stored projects.spent column (always 0 — 0001_init_schema.sql:79 DEFERRED).
      cell: (p) => {
        if (deliveryError) return <span className="text-[12px] text-muted-foreground">—</span>;
        const actualSpend = deliverySummary?.[p.id]?.committedSpend;
        if (deliveryPending || actualSpend == null) {
          return <span className="text-[12px] text-muted-foreground">…</span>;
        }
        return <span className="text-muted-foreground">{formatCurrency(actualSpend, p.currency)}</span>;
      },
    },
    {
      key: 'progress',
      header: t('projects.columns.progress', 'Progress'),
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of false empty state.
        if (deliveryError) return <span className="text-[12px] text-muted-foreground">—</span>;
        if (deliveryPending) {
          return <span className="text-[12px] text-muted-foreground">…</span>;
        }
        const summary = deliverySummary?.[p.id];
        if (summary?.deliveryPct == null) {
          return (
            <span className="text-[12px] text-muted-foreground">
              {t('projects.noPhasesYet', 'No phases yet')}
            </span>
          );
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
      header: t('projects.columns.budgetUsed', 'Budget used'),
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of $0/$0.
        if (deliveryError) return <span className="text-[12px] text-muted-foreground">—</span>;
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
            {/* ⚑ Not extracted — embeds two values. This is the one that MOST wants a key
                (Indonesian will not keep "X of Y budget" word order), and it is exactly the
                DD-I18N-7 shape: format the money first, interpolate the finished strings. It
                stays English until `t()` interpolation is safe under the unit suite. */}
            <div className="text-[11px] text-muted-foreground">
              {`${formatCompactCurrency(summary.committedSpend, p.currency)} of ${formatCompactCurrency(summary.budget, p.currency)} budget`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'transition',
      header: t('projects.columns.action', 'Action'),
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
  const primaryAction = newProjectAction(
    canCreate,
    () => setCreateOpen(true),
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
        {createModal}
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
        {createModal}
      </ListPage>
    );
  }

  if (all.length === 0) {
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
                  onClick: () => setCreateOpen(true),
                }
              : undefined
          }
        />
        {createModal}
      </ListPage>
    );
  }

  // ── Phone-width (below md) mobile toolbar (FR-PRJUX-001) ────────────────
  // Keeps status, search, the selected view, and New project visible while grouping the
  // secondary filters and bulk actions behind named disclosures. Only rendered in the
  // loaded slate. The Table view option is NOT hidden here — DataTable already reflows
  // it into cards.
  const secondaryCount =
    (filterClient !== 'All' ? 1 : 0) + (filterPM !== 'All' ? 1 : 0);
  const selectedCustomer = customerFilterOptions.find((o) => o.value === filterClient);
  const selectedPm = pmFilterOptions.find((o) => o.value === filterPM);

  const moreActionsChildren = [
    <ExportButton
      key="export"
      rows={filtered}
      columns={columns}
      entity="Projects"
      label={t('projects.export', 'Export')}
      onExport={() => setMoreOpen(false)}
    />,
    // ImportButton is internally permission-gated (returns null for a non-create real
    // role). Opening its wizard must NOT close/unmount this More disclosure — the wizard
    // stays mounted for its own lifecycle (DD-BIMP-3) — so no close is wired here.
    <ImportButton
      key="import"
      entity="project"
      descriptor={importDescriptor}
      onImported={() => void refetch()}
      label={t('projects.import', 'Import')}
    />,
    <ImportButton
      key="importBudget"
      entity="budgetLine"
      label={t('projects.importBudgets', 'Import budgets')}
      descriptor={budgetImportDescriptor}
      onImported={() => void refetch()}
    />,
  ].filter((c): c is React.ReactElement => c !== null);

  const mobileToolbar = (
    <div data-testid="projects-mobile-toolbar" className="w-full min-w-0 space-y-2.5">
      {/* status — bounded horizontal scroller (must stay reachable at 390px) */}
      <div data-testid="status-filter-scroll" className="overflow-x-auto scroll-fade-x">
        <ViewToggle<StatusFilter>
          options={FILTERS.map((f) => ({ value: f, label: filterLabels[f] }))}
          value={filter}
          onChange={(v) => {
            setFilter(v);
            trackFilterApplied('status', FILTERS.length, 'projects');
          }}
          ariaLabel={t('projects.filters.ariaLabel', 'Status filter')}
        />
      </div>

      {/* search + selected view */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
          containerClassName="min-w-0 flex-1 basis-40"
        />
        {/* The 4-option view toggle can exceed a 360px row; keep it reachable within the
            toolbar without page bleed — it scrolls inside this bounded container. */}
        <div className="ml-auto min-w-0 max-w-full overflow-x-auto">
          <ViewToggle<'table' | 'cards' | 'calendar' | 'kanban'>
            options={[
              { value: 'table', label: t('projects.view.table', 'Table'), icon: 'table' },
              { value: 'cards', label: t('projects.view.cards', 'Cards'), icon: 'cards' },
              { value: 'calendar', label: t('projects.view.calendar', 'Calendar'), icon: 'cal' },
              { value: 'kanban', label: t('projects.view.board', 'Board'), icon: 'cols' },
            ]}
            value={view}
            onChange={setView}
            ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
          />
        </div>
      </div>

      {/* filters + more actions disclosures */}
      <div className="flex flex-wrap items-center gap-2">
        {!isEngineer && (
          <MobileToolbarDisclosure
            label={t('projects.mobile.filters', 'Filters')}
            count={secondaryCount}
            open={filtersOpen}
            closeOnSelectChange
            onOpenChange={(next) => {
              setFiltersOpen(next);
              if (next) setMoreOpen(false);
            }}
          >
            <div className="w-full min-w-0 space-y-3">
              <div className="w-full min-w-0 space-y-1">
                <SelectField
                  label={t('projects.filters.customerLabel', 'Filter by customer')}
                  value={filterClient}
                  onChange={(v) => {
                    setFilterClient(v);
                    trackFilterApplied('customer', customerFilterOptions.length, 'projects');
                  }}
                  options={customerFilterOptions}
                  fullWidth
                />
                {clientCompaniesResult.isPending && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('projects.mobile.loading', 'Loading options…')}
                  </p>
                )}
                {!clientCompaniesResult.isPending && clientCompaniesResult.isError && (
                  <div className="flex items-center gap-2">
                    <p role="alert" className="text-[12px] text-destructive">
                      {t('projects.mobile.error', "Couldn't load options")}
                    </p>
                    <button
                      type="button"
                      onClick={() => clientCompaniesResult.refetch?.()}
                      className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {t('projects.mobile.retry', 'Retry')}
                    </button>
                  </div>
                )}
                {!clientCompaniesResult.isPending && !clientCompaniesResult.isError &&
                  clientCompaniesResult.isSuccess && clientCompanies.length === 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('projects.mobile.noOptions', 'No options available')}
                    </p>
                  )}
              </div>

              <div className="w-full min-w-0 space-y-1">
                <SelectField
                  label={t('projects.filters.pmLabel', 'Filter by project manager')}
                  value={filterPM}
                  onChange={(v) => {
                    setFilterPM(v);
                    trackFilterApplied('project_manager', pmFilterOptions.length, 'projects');
                  }}
                  options={pmFilterOptions}
                  fullWidth
                />
                {projectManagersResult.isPending && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('projects.mobile.loading', 'Loading options…')}
                  </p>
                )}
                {!projectManagersResult.isPending && projectManagersResult.isError && (
                  <div className="flex items-center gap-2">
                    <p role="alert" className="text-[12px] text-destructive">
                      {t('projects.mobile.error', "Couldn't load options")}
                    </p>
                    <button
                      type="button"
                      onClick={() => projectManagersResult.refetch?.()}
                      className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {t('projects.mobile.retry', 'Retry')}
                    </button>
                  </div>
                )}
                {!projectManagersResult.isPending && !projectManagersResult.isError &&
                  projectManagersResult.isSuccess && projectManagers.length === 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('projects.mobile.noOptions', 'No options available')}
                    </p>
                  )}
              </div>
            </div>
          </MobileToolbarDisclosure>
        )}

        {moreActionsChildren.length > 0 && (
          <MobileToolbarDisclosure
            label={t('projects.mobile.more', 'More actions')}
            open={moreOpen}
            onOpenChange={(next) => {
              setMoreOpen(next);
              if (next) setFiltersOpen(false);
            }}
          >
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              {moreActionsChildren}
            </div>
          </MobileToolbarDisclosure>
        )}
      </div>

      {/* active secondary-filter chips + Clear all (AC-PRJUX-002) */}
      {hasNonDefaultFilter && (
        <div
          data-testid="active-filter-chips"
          aria-label={t('projects.mobile.activeCount', 'Active filters')}
          className="flex flex-wrap items-center gap-2"
        >
          {filterClient !== 'All' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium text-muted-foreground">
                {t('projects.mobile.customer', 'Customer')}: {selectedCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}
              </span>
              <button
                type="button"
                aria-label={`${t('projects.mobile.removeCustomer', 'Remove customer filter')}: ${selectedCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}`}
                className="grid size-[18px] place-items-center rounded-full hover:bg-accent"
                onClick={() => setFilterClient('All')}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          {filterPM !== 'All' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium text-muted-foreground">
                {t('projects.mobile.manager', 'Project manager')}: {selectedPm?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}
              </span>
              <button
                type="button"
                aria-label={`${t('projects.mobile.removeManager', 'Remove project manager filter')}: ${selectedPm?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}`}
                className="grid size-[18px] place-items-center rounded-full hover:bg-accent"
                onClick={() => setFilterPM('All')}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-[12.5px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            {t('projects.mobile.clearAll', 'Clear all')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <ListPage
      title={t('projects.title', 'Projects')}
      description={pageDescription}
      primaryAction={primaryAction}
      mobileToolbar={mobileToolbar}
      filters={
        /* AC-2: wrap in overflow-x-auto so the full filter strip (incl. "At risk") is
           reachable at 390px without clipping. scroll-fade-x adds the right-edge fade
           affordance (the project tab strip pattern). */
        <div data-testid="status-filter-scroll" className="overflow-x-auto scroll-fade-x">
          <ViewToggle<StatusFilter>
            options={FILTERS.map((f) => ({ value: f, label: filterLabels[f] }))}
            value={filter}
            onChange={(v) => {
              setFilter(v);
              trackFilterApplied('status', FILTERS.length, 'projects');
            }}
            ariaLabel={t('projects.filters.ariaLabel', 'Status filter')}
          />
        </div>
      }
      search={
        <SearchMini
          placeholder={t('projects.search.placeholder', 'Search projects…')}
          aria-label={t('projects.search.ariaLabel', 'Search projects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          searchSurface="projects-list"
          module="projects"
          resultCount={filtered.length}
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
              label={t('projects.filters.customerLabel', 'Filter by customer')}
              value={filterClient}
              onChange={(v) => {
                setFilterClient(v);
                trackFilterApplied('customer', customerFilterOptions.length, 'projects');
              }}
              options={customerFilterOptions}
              className="w-auto"
            />
            <SelectField
              hideLabel
              label={t('projects.filters.pmLabel', 'Filter by project manager')}
              value={filterPM}
              onChange={(v) => {
                setFilterPM(v);
                trackFilterApplied('project_manager', pmFilterOptions.length, 'projects');
              }}
              options={pmFilterOptions}
              className="w-auto"
            />
          </>
        ) : undefined
      }
      exportAction={
        <ExportButton rows={filtered} columns={columns} entity="Projects" label={t('projects.export', 'Export')} />
      }
      view={
        /* All four views remain reachable; DataTable reflows Table into cards below md. */
        <ViewToggle<'table' | 'cards' | 'calendar' | 'kanban'>
          options={[
            {
              value: 'table',
              label: t('projects.view.table', 'Table'),
              icon: 'table',
            },
            { value: 'cards', label: t('projects.view.cards', 'Cards'), icon: 'cards' },
            { value: 'calendar', label: t('projects.view.calendar', 'Calendar'), icon: 'cal' },
            { value: 'kanban', label: t('projects.view.board', 'Board'), icon: 'cols' },
          ]}
          value={view}
          onChange={setView}
          ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
        />
      }
      importAction={
        <>
          <ImportButton
            entity="project"
            descriptor={importDescriptor}
            onImported={() => void refetch()}
            label={t('projects.import', 'Import')}
          />
          <ImportButton
            entity="budgetLine"
            label={t('projects.importBudgets', 'Import budgets')}
            descriptor={budgetImportDescriptor}
            onImported={() => void refetch()}
          />
        </>
      }
    >
      {/* Body */}
      {view === 'kanban' ? (
        <ProjectKanbanBoard projects={filtered} onOpen={(p) => onOpen(p, 'card')} />
      ) : view === 'calendar' ? (
        <ProjectCalendarView
          projects={filtered}
          milestoneDates={milestoneDates}
          onOpenProject={(id) => {
            trackProjectDetailOpened('/projects/:projectId', 'card');
            navigate(`/projects/${id}`);
          }}
        />
      ) : view === 'table' ? (
        <DataTable<ProjectWithRefs>
          rows={filtered}
          columns={columns}
          rowKey={(p) => p.id}
          onActivate={onOpen}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={
            filter === 'at-risk'
              ? t('projects.empty.nothingAtRiskTitle', 'Nothing at risk')
              : filtersActive
                ? t('projects.empty.noMatchTitle', 'No projects match these filters')
                : t('projects.states.emptyTitle', 'No projects yet')
          }
          emptySub={
            filter === 'at-risk'
              ? t(
                  'projects.empty.nothingAtRiskSub',
                  'Every active project is under 90% budget — nothing needs attention right now.',
                )
              : filtersActive
                ? t('projects.empty.noMatchSub', 'Try a different status, customer, PM, or search term.')
                : t('projects.states.emptySub', 'Projects you create or win will appear here.')
          }
          emptyAction={
            filter === 'at-risk'
              ? undefined
              : filtersActive
                ? { label: t('projects.empty.clearFilters', 'Clear filters'), onClick: clearFilters }
                : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <ListState
          variant="empty"
          icon="folder"
          title={
            filter === 'at-risk'
              ? t('projects.empty.nothingAtRiskTitle', 'Nothing at risk')
              : filtersActive
                ? t('projects.empty.noMatchTitle', 'No projects match these filters')
                : t('projects.states.emptyTitle', 'No projects yet')
          }
          sub={
            filter === 'at-risk'
              ? t(
                  'projects.empty.nothingAtRiskSub',
                  'Every active project is under 90% budget — nothing needs attention right now.',
                )
              : filtersActive
                ? t('projects.empty.noMatchSub', 'Try a different status, customer, PM, or search term.')
                : t('projects.states.emptySub', 'Projects you create or win will appear here.')
          }
          action={
            filter === 'at-risk'
              ? undefined
              : filtersActive
                ? { label: t('projects.empty.clearFilters', 'Clear filters'), onClick: clearFilters }
                : undefined
          }
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
              onEdit={canEdit ? (proj) => setEditTarget(proj) : undefined}
            />
          ))}
        </div>
      )}
      {createModal}

      {/* Edit-header modal (Admin·Exec·PM) — opened from the row menu */}
      {editTarget && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            id: editTarget.id,
            name: editTarget.name,
            code: editTarget.code,
            client_id: editTarget.client_id,
            project_manager_id: editTarget.project_manager_id,
            clientName: editTarget.client?.name ?? null,
            pmName: editTarget.pm?.full_name ?? null,
            start_date: editTarget.start_date,
            end_date: editTarget.end_date,
          }}
          onClose={() => setEditTarget(null)}
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
      )}

      {/* Archive confirm (default tone) */}
      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        /* ⚑ The named branch stays a template literal — see the interpolation note above. */
        title={
          archiveTarget
            ? `Archive ${archiveTarget.name}?`
            : t('projects.confirm.archiveTitle', 'Archive project?')
        }
        description={t(
          'projects.confirm.archiveDescription',
          'It will be hidden from the default project list. Existing references stay intact. You can restore it later.',
        )}
        confirmLabel={t('projects.confirm.archiveConfirm', 'Archive project')}
        loading={archive?.isPending ?? false}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
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
