import ProjectClassificationFilters from '../components/ProjectClassificationFilters';
import { activeClassificationCount, CLASSIFICATION_FILTER_KEYS, classificationValueLabel, matchesProjectClassification, pickClassification } from '@/src/lib/projectClassification';
import type { ProjectClassificationFilters as ClassificationFilterValues } from '@/src/lib/projectClassification';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo, useState } from 'react';
import {
  SearchMini,
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
import { ExportButton, withCurrencyColumn } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { makeProjectImportDescriptor, makeBudgetImportDescriptor } from '@/src/lib/import';
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
import { useCompanies } from '@/src/hooks/useCompanies';
import { useAuth } from '@/src/auth/useAuth';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { readProjectView, writeProjectView } from '@/src/hooks/useProjectView';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import { currentMonthToken, parseListWorkingSet } from '@/src/lib/listWorkingSet';
import type { MonthCursor } from '@/src/lib/calendar/monthMatrix';
import type { ProjectView } from '@/src/hooks/useProjectView';
import { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import { useProjectsMoneyCollection } from '@/src/hooks/useProjectsMoneyCollection';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackProjectDetailOpened, trackFilterApplied } from '@/src/lib/analytics';
import { formatCurrency, formatDateOnly, formatInstantDate } from '@/src/lib/format';
import { deriveActualPosition, formatExactMoney, isActualComplete } from '@/src/lib/projectFinances';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { ProjectStatus as ProjectStatusEnum } from '../types';
import { pillVariantForProjectStatus } from '../components/projects';
import ProjectCard from '../components/ProjectCard';
import ProjectFormModal from '../components/ProjectFormModal';
import ProjectCalendarView from '../components/ProjectCalendarView';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { projectManagerLabel, UNASSIGNED_PROJECT_MANAGER } from '@/src/lib/projects/projectManagerLabel';
import { sortProjectRows } from '@/src/lib/projects/projectSorting';
import type { ProjectSort } from '@/src/lib/projects/projectSorting';
import { ProjectPageFrame } from '@/src/components/projects/ProjectPageFrame';
import { ProjectDataState } from '@/src/components/projects/ProjectDataState';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { Link } from 'react-router';

/**
 * The status-group SegFilter. Model B (ADR-0020): the pre-win "Leads" partition lives in the
 * Sales Pipeline now (listProjects is scoped to on-hand ∪ internal), so the Projects list has
 * no leads to filter — the "Leads" tab is removed. Surviving filters: All / My Projects /
 * Ongoing / Completed / at-risk (AC-IXD-DASH-W5-C2A: drill destination from dashboard KPIs).
 */
type StatusFilter = 'All' | 'My Projects' | 'Ongoing' | 'Completed' | 'at-risk';
const FILTERS: StatusFilter[] = ['All', 'My Projects', 'Ongoing', 'Completed', 'at-risk'];

const ONGOING = [ProjectStatusEnum.Ongoing, ProjectStatusEnum.WonPendingKoM, ProjectStatusEnum.OnHold] as string[];
const COMPLETED = [ProjectStatusEnum.CloseOut, ProjectStatusEnum.Loss] as string[];

const Projects: React.FC = () => {
  const { t } = useTranslation();
  const projectStatusLabel = useProjectStatusLabel();
  const { effectiveRole, realRole } = useEffectiveRole();
  const may = usePermission();
  const { toast } = useToast();
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
  // #758: the end-customer filter lists ALL the org's companies (not just Client-type), so it
  // uses the broad useCompanies() cache.
  const companiesResult = useCompanies();
  const projectManagersResult = useProjectManagers();
  // Stable array references so the option-list/import useMemos (which list them as deps)
  // don't recompute every render when a query is still resolving to `undefined`.
  const clientCompanies = useMemo(() => clientCompaniesResult.data ?? [], [clientCompaniesResult.data]);
  const allCompanies = useMemo(() => companiesResult.data ?? [], [companiesResult.data]);
  const projectManagers = useMemo(() => projectManagersResult.data ?? [], [projectManagersResult.data]);
  const { updateHeader, archive } = useProjectMutations();

  const canCreate = may('create', 'project');
  const canEdit = may('edit', 'project');
  const canArchive = may('archive', 'project');
  const canRowWrite = canEdit || canArchive;

  // list-working-set-return (#682): `filter`/`client`/`pm`/`q`/`view` are URL-owned. The URL is
  // authoritative for supported keys; the role default (Engineer keeps "My Projects") and the
  // persisted session view are the fallback, materialized once the role default is known
  // (`defaultsReady`). B-11 (AC-W2-IXD-009): Engineers default to "My Projects" — they are ICs
  // who want their own assigned work, not the full org project list; all other roles default to
  // "All". `effectiveRole` is used so an impersonated-as-Engineer session gets the scoped default.
  const roleDefault: StatusFilter = effectiveRole === 'Engineer' ? 'My Projects' : 'All';
  const { workingSet, setWorkingSet } = useListWorkingSet('projects', {
    sessionView: readProjectView(),
    projectsDefaultFilter: roleDefault,
    defaultsReady: effectiveRole != null,
  });
  // Search stays LOCAL text written to the URL after a pause (useUrlSearchInput's search
  // contract) — never bound straight to `workingSet.q`.
  const [search, setSearch] = useUrlSearchInput(workingSet.q, (q) =>
    setWorkingSet((ws) => ({ ...ws, q })),
  );
  const { openRecord } = useListReturn({ list: 'projects', contentReady: !isPending && !isError });

  const filter = workingSet.filter;
  const filterClient = workingSet.client;
  const filterEndCustomer = workingSet.endClient;
  const filterPM = workingSet.pm;
  const view = workingSet.view;
  const onViewChange = (v: ProjectView) => {
    writeProjectView(v);
    setWorkingSet((ws) => ({ ...ws, view: v }));
  };
  // #716: the calendar month is URL-owned (`month=YYYY-MM`, current month omitted), so a Back
  // return from a record lands on the month the user was reviewing.
  const calendarCursor = useMemo(() => {
    const [y, m] = (workingSet.month ?? currentMonthToken()).split('-').map(Number);
    return { year: y, month: m - 1 };
  }, [workingSet.month]);
  const onCalendarCursorChange = (next: MonthCursor) =>
    setWorkingSet((ws) => ({
      ...ws,
      month: `${next.year}-${String(next.month + 1).padStart(2, '0')}`,
    }));
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

  const all = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);

  // NFR-DEL-PERF-001: one batched call for all project delivery summaries (no per-row N+1).
  const { data: deliverySummary, isPending: deliveryPending, isError: deliveryError, refetch: refetchDelivery } = useProjectsDeliverySummary(all.map((p) => p.id));
  const { data: projectMoney, isPending: moneyPending, isError: moneyError, refetch: refetchMoney } = useProjectsMoneyCollection(all.map((p) => p.id));

  // Financial risk uses the canonical mapped Actual over an explicit Active budget.
  // Missing snapshots/budgets stay unknown and cannot become zero-based risk signals.
  const isAtRiskActual = React.useCallback(
    (p: ProjectWithRefs) => {
      const money = projectMoney?.[p.id];
      const actual = money?.actuals.total == null ? null : Number(money.actuals.total);
      const budget = money?.hasActiveBudget && money.activeBudgetAmount != null ? Number(money.activeBudgetAmount) : null;
      if (!money || actual == null || budget == null) return false;
      return isMoneyAtRisk({ status: p.status as string, budget,
        budgetCurrency: money.activeBudgetCurrency, projectCurrency: p.currency,
        spent: actual, actualCurrency: money.actuals.currency,
        actualComplete: isActualComplete({ basis: money.ledgerBasis ?? 'erp', readSucceeded: true, complete: money.actuals.complete,
          categories: money.actuals.categories, excludesRestrictedRows: money.actuals.excludesRestrictedRows }) });
    },
    [projectMoney],
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
          case 'at-risk':
            return true;
          default:
            return true;
        }
      })
      .filter((p) => matchesProjectClassification(p, workingSet))
      .filter((p) => filterClient === 'All' || p.client_id === filterClient)
      // #758: end-customer filter mirrors the client filter on the nullable end_client_id.
      .filter((p) => filterEndCustomer === 'All' || p.end_client_id === filterEndCustomer)
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
          (p.short_name ?? '').toLowerCase().includes(q) ||
          (p.pmo_project_number ?? '').toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q) ||
          (p.client?.name ?? '').toLowerCase().includes(q) ||
          (p.client?.short_name ?? '').toLowerCase().includes(q) ||
          (p.end_client?.name ?? '').toLowerCase().includes(q) ||
          (p.end_client?.short_name ?? '').toLowerCase().includes(q),
      );
    const riskRows = filter === 'at-risk' && !moneyError ? rows.filter(isAtRiskActual) : rows;
    return sortProjectRows(riskRows, workingSet.sort, isAtRiskActual);
  }, [all, workingSet, filter, filterClient, filterEndCustomer, filterPM, search, currentUser?.id, isEngineer, myProjectIds, isAtRiskActual, moneyError]);

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

  const sortLabels: Record<ProjectSort, string> = {
    attention: t('projects:sort.attention', 'Budget risk first, then expected end'),
    'expected-end': t('projects:sort.expectedEnd', 'Expected end (soonest first)'),
    name: t('projects:sort.name', 'Project name (A to Z)'),
  };

  // Filter-select option lists (the tokened SelectField consumes {value,label});
  // the leading "All …" sentinel value is the cleared state.
  const customerFilterOptions = useMemo(
    () => [
      { value: 'All', label: t('projects.filters.allCustomers', 'All customers') },
      ...clientCompanies.map((c) => ({ value: c.id, label: companyDisplayName(c) })),
    ],
    [clientCompanies, t],
  );
  // #758 / RF-012: options come from actual end-customer associations (any company type); preserve a URL-restored selection if its row is outside this result set.
  const endCustomerFilterOptions = useMemo(() => {
    const associated = new Map<string, NonNullable<ProjectWithRefs['end_client']>>();
    for (const project of all) {
      if (project.end_client_id && project.end_client) associated.set(project.end_client_id, project.end_client);
    }
    // Keep a URL-restored selection visible even if its project is not in this result set.
    if (filterEndCustomer !== 'All' && !associated.has(filterEndCustomer)) {
      const selected = allCompanies.find((company) => company.id === filterEndCustomer);
      if (selected) associated.set(selected.id, selected);
    }
    return [
      { value: 'All', label: t('projects.filters.allEndCustomers', 'All end customers') },
      ...[...associated].map(([id, company]) => ({ value: id, label: companyDisplayName(company) })),
    ];
  }, [all, allCompanies, filterEndCustomer, t]);
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

  const [classificationResetToken, setClassificationResetToken] = useState(0);
  const classificationCount = activeClassificationCount(workingSet);
  const classificationFilterProps = {
    rows: all,
    value: workingSet,
    resetToken: classificationResetToken,
    open: filtersOpen,
    onOpenChange: (next: boolean) => {
      setFiltersOpen(next);
      if (next) setMoreOpen(false);
    },
    onChange: (patch: ClassificationFilterValues) => setWorkingSet((ws) => ({ ...ws, ...patch })),
  };
  const filtersActive =
    classificationCount > 0 || filter !== roleDefault || filterClient !== 'All' || filterEndCustomer !== 'All' || filterPM !== 'All' || search.trim() !== '';
  // AC-PRJUX-002: Clear all returns the list to the role-default status (All for
  // PM/Admin, My Projects for Engineer), not a literal 'All', while clearing customer,
  // PM, and search — ONE working-set update plus the search reset (#683), so the URL and
  // controls move together and no second event drops the first call. Keeps the view.
  const clearFilters = () => {
    setSearch('');
    setClassificationResetToken((n) => n + 1);
    setWorkingSet((current) => ({
      ...parseListWorkingSet('projects', '', {
        projectsDefaultFilter: roleDefault,
        sessionView: readProjectView(),
      }),
      view: current.view,
      month: current.month,
      sort: current.sort,
    }));
  };

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

  // ONE table-level coverage note (AC-RD-TBL-PROJ-001): the count of ERP rows with an unmapped or
  // amount-less category, and the newest ERP update among the visible rows.
  const partialRows = filtered.filter((project) => {
    const money = projectMoney?.[project.id];
    const basis = money?.ledgerBasis ?? 'erp';
    return basis === 'erp' && Boolean(money && money.actuals.categories.some((category) => !category.mapped || category.amount == null));
  });
  const coverageAsOf = filtered.reduce<string | null>((latest, project) => {
    const asOf = projectMoney?.[project.id]?.ledgerBasis === 'erp' ? projectMoney?.[project.id]?.actuals.asOf ?? null : null;
    return asOf && (!latest || asOf > latest) ? asOf : latest;
  }, null);
  const coverageReason = partialRows.length === 0 ? undefined : coverageAsOf
    ? t('projects:coverage.partialUpdated', 'Actual is partial on {{partial}} of {{total}} projects. Updated {{date}}.', { partial: partialRows.length, total: filtered.length, date: formatInstantDate(coverageAsOf) })
    : t('projects:coverage.partial', 'Actual is partial on {{partial}} of {{total}} projects.', { partial: partialRows.length, total: filtered.length });
  const actualStateLabel = (money?: ProjectMoneyRead) => {
    if (moneyError || !money) return t('uxs02.unavailable', 'Unavailable');
    if (money.actuals.excludesRestrictedRows) return t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded');
    if ((money.ledgerBasis ?? 'erp') === 'erp' && money.actuals.categories.some((category) => !category.mapped || category.amount == null)) {
      return t('uxs02.incompleteCoverage', 'Incomplete source coverage');
    }
    return t('uxs02.unavailable', 'Unavailable');
  };
  const linkedDataState = (project: ProjectWithRefs, label: string, destination: 'overview' | 'budget' | 'delivery' = 'overview') => (
    <ProjectDataState
      label={label}
      to={`/projects/${project.id}/${destination === 'budget' ? 'budget' : 'overview'}`}
      actionLabel={destination === 'budget'
        ? t('projects:actions.reviewBudget', 'Review budget')
        : destination === 'delivery'
          ? t('projects:actions.reviewDelivery', 'Review delivery plan')
          : t('projects:actions.reviewFinances', 'Review project finances')}
      align="end"
    />
  );
  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: t('projects.columns.project', 'Project'),
      kind: 'primary',
      size: 320,
      minSize: 300,
      maxSize: 520,
      secondaryWrap: true,
      exportValue: (p) => p.name,
      primaryTitle: (p) => p.name,
      secondaryCell: (p) => {
        const references = [
          p.pmo_project_number && [t('projects.identifiers.pmo', 'PMO Project Number'), p.pmo_project_number],
          p.code && [t('projects.identifiers.client', 'Client Project Code'), p.code],
          p.customer_contract_ref && [t('uxs14.contractReference', 'Customer contract reference'), p.customer_contract_ref],
        ].filter((value): value is [string, string] => Boolean(value));
        return (
          <span data-testid="projects-identity-secondary" className="block min-w-0 space-y-1" onClick={(event) => event.stopPropagation()}>
            {p.client && <CompanyNameLink companyId={p.client_id} name={companyDisplayName(p.client)} className="touch-target block max-w-full break-words text-xs" />}
            {p.end_client && <span className="block break-words text-xs text-muted-foreground">{t('projects:endCustomer', 'End customer')}: {companyDisplayName(p.end_client)}</span>}
            {references.length > 0 && <span className="block min-w-0 space-y-0.5 text-xs text-muted-foreground">
              {references.map(([label, value]) => <span key={label} className="block min-w-0 break-words">{label}: <span className="break-all font-mono text-foreground">{value}</span></span>)}
            </span>}
          </span>
        );
      },
      cell: (p) => {
        const atRisk = isAtRiskActual(p);
        return (
          <div className="min-w-0">
              <div className="flex min-w-0 flex-col items-start gap-1">
                <button
                  type="button"
                  data-list-return-focus={`projects:${p.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(p);
                  }}
                  className="block w-full whitespace-normal break-words text-left font-semibold hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:line-clamp-2"
                  title={p.name}
                  aria-describedby={projectDisplayName(p) !== p.name ? `project-legal-${p.id}` : undefined}
                >
                  {projectDisplayName(p)}
                </button>
                {projectDisplayName(p) !== p.name && <span id={`project-legal-${p.id}`} className="sr-only">{p.name}</span>}
                {/* AC-IXD-DASH-W5-C2C N18/I3: text+dot pill (not color-only). */}
                {atRisk && (
                  <StatusPill variant="warn">{t('projects.atRiskPill', 'At risk')}</StatusPill>
                )}
              </div>
          </div>
        );
      },
    },
    {
      key: 'pm',
      header: t('projects.columns.pm', 'PM'),
      kind: 'meta',
      size: 176,
      minSize: 160,
      maxSize: 280,
      // FR-PRJUX-004/005: an assigned blank-name profile exports its readable fallback,
      // and is never exported as "unassigned".
      exportValue: (p) =>
        projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        }),
      cell: (p) => {
        const label = projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        });
        return <span className="block whitespace-normal break-words text-sm leading-snug text-foreground">{label}</span>;
      },
    },
    {
      key: 'status',
      // ⚑ The pill CONTENT (`p.status`) is a database enum, not a literal — localising workflow
      // status labels is its own decision (it needs one map every surface shares) and is not in
      // this pass. Only the column header moves.
      header: t('projects:columns.statusAndEnd', 'Status / expected end'),
      kind: 'status',
      size: 180,
      minSize: 176,
      maxSize: 260,
      exportValue: (p) => String(p.status),
      cell: (p) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <StatusPill variant={pillVariantForProjectStatus(p.status as string)}>{p.status}</StatusPill>
          <span className="text-[12px] text-muted-foreground">
            {p.end_date ? formatDateOnly(p.end_date) : t('projects:dates.noExpectedEnd', 'No expected end')}
          </span>
        </div>
      ),
    },
    {
      key: 'contract',
      header: t('projects.columns.contract', 'Contract'),
      kind: 'money',
      size: 160,
      minSize: 152,
      maxSize: 320,
      align: 'num',
      exportValue: (p) => p.contract_value,
      // FR-L10N-020: each row is one project, so the currency is that project's own (0187's
      // per-record column) — an org default would be wrong the moment two currencies coexist.
      // OD-TAX-1 §2: a contract figure carries its basis wherever it is rendered. A list is the
      // surface where two projects on OPPOSITE bases sit one row apart — a column of bare numbers
      // there reads as comparable when it is not.
      // Keep the visible basis concise; the record's full stored qualifier remains available to AT.
      cell: (p) => {
        const detailsId = `contract-tax-details-${p.id}`;
        return (
          <div className="flex min-w-0 flex-col items-end gap-0.5" aria-describedby={detailsId}>
            <span>{formatCurrency(p.contract_value, p.currency)}</span>
            <TaxBasisLabel
              treatment={p.tax_treatment}
              showDetails={false}
              className="block max-w-full whitespace-normal break-words leading-tight"
            />
            <span id={detailsId} className="sr-only">
              <TaxBasisLabel
                treatment={p.tax_treatment}
                taxRate={p.tax_rate}
                taxBaseNumerator={p.tax_base_numerator}
                taxBaseDenominator={p.tax_base_denominator}
                className="block max-w-full whitespace-normal break-words"
                testId={`contract-tax-label-${p.id}`}
              />
            </span>
          </div>
        );
      },
    },
    {
      key: 'actual',
      header: t('projects.columns.actual', 'Actual'),
      kind: 'money',
      size: 160,
      minSize: 152,
      maxSize: 320,
      align: 'num',
      colClassName: 'xl:pr-4',
      // RF-008 / S-02: canonical ERP-mapped Actual, never the legacy stored project.spent value.
      cell: (p) => {
        if (moneyPending) return <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>;
        const money = projectMoney?.[p.id];
        if (moneyError || !money) return linkedDataState(p, t('uxs02.unavailable', 'Unavailable'));
        const actualPosition = deriveActualPosition({
          ledgerBasis: money.ledgerBasis,
          committedSpend: money.ledgerBasis === 'pmo' && money.actuals.total != null ? Number(money.actuals.total) : undefined,
          commitmentPending: moneyPending,
          commitmentError: moneyError,
          projectCurrency: p.currency,
          actuals: {
            currency: money.actuals.currency,
            total: money.actuals.total,
            as_of: money.actuals.asOf,
            excludes_restricted_rows: money.actuals.excludesRestrictedRows,
            categories: money.actuals.categories,
          },
        });
        const actual = actualPosition.amount;
        if (actual == null) {
          // Unknown is never 0. Partial coverage is explained once, by the table note; only a row that
          // excludes restricted rows is marked on its own (its cause is not a coverage gap).
          return linkedDataState(p, actualStateLabel(money));
        }
        const formattedActual = formatExactMoney(actual, actualPosition.currency || p.currency, getNumberLocale());
        return formattedActual == null ? linkedDataState(p, t('uxs02.unavailable', 'Unavailable')) : <span className="text-muted-foreground">{formattedActual}</span>;
      },
    },
    {
      key: 'progress',
      header: t('projects:columns.delivery', 'Delivery'),
      kind: 'percent',
      size: 120,
      minSize: 96,
      maxSize: 160,
      colClassName: 'xl:pl-4',
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of false empty state.
        if (deliveryError) return linkedDataState(p, t('uxs02.unavailable', 'Unavailable'), 'delivery');
        if (deliveryPending) {
          return <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>;
        }
        const summary = deliverySummary?.[p.id];
        if (summary?.deliveryPct == null) {
          const noPhases = t('projects.noPhasesYet', 'No phases yet');
          return linkedDataState(p, noPhases, 'delivery');
        }
        const roundedDelivery = Math.round(summary.deliveryPct);
        return (
          <div className="flex flex-col gap-0.5">
            <ProgressBar value={roundedDelivery} showValue compact tone={roundedDelivery >= 100 ? 'success' : 'primary'} aria-label={t('projects.card.deliveryPercent', 'Delivery {{percent}}%', { percent: roundedDelivery })} />
          </div>
        );
      },
    },
    {
      key: 'budget-used',
      header: t('projects.columns.budgetUsed', 'Budget used'),
      kind: 'money',
      size: 160,
      minSize: 152,
      maxSize: 320,
      cell: (p) => {
        if (moneyPending) return <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>;
        const money = projectMoney?.[p.id];
        const actual = money?.actuals.total == null ? null : Number(money.actuals.total);
        const activeBudget = money?.hasActiveBudget && money.activeBudgetAmount != null ? Number(money.activeBudgetAmount) : null;
        if (moneyError || !money) return linkedDataState(p, t('uxs02.unavailable', 'Unavailable'));
        if (!money.hasActiveBudget) {
          return linkedDataState(p, t('uxs02.noActiveBudget', 'No active budget'), 'budget');
        }
        if (activeBudget == null) return linkedDataState(p, t('uxs02.unavailable', 'Unavailable'), 'budget');
        if (activeBudget === 0) {
          const reason = t('uxs02.zeroActiveBudget', '{{budget}} Active budget; usage unavailable', { budget: formatCurrency(activeBudget, money.activeBudgetCurrency ?? p.currency) });
          return linkedDataState(p, reason, 'budget');
        }
        if (actual == null) {
          return linkedDataState(p, actualStateLabel(money));
        }
        if (money.activeBudgetCurrency !== money.actuals.currency || money.actuals.currency !== p.currency) {
          return linkedDataState(p, t('uxs02.currencyMismatch', 'Budget currency differs from Actual'), 'budget');
        }
        const completeCoverage = isActualComplete({ basis: money.ledgerBasis ?? 'erp', readSucceeded: true, complete: money.actuals.complete,
          categories: money.actuals.categories, excludesRestrictedRows: money.actuals.excludesRestrictedRows });
        if (!completeCoverage) {
          const reason = money.actuals.excludesRestrictedRows ? t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded') : t('uxs02.incompleteCoverage', 'Incomplete source coverage');
          return linkedDataState(p, reason);
        }
        const percent = Math.round((actual / activeBudget) * 100);
        const atRisk = isAtRiskActual(p);
        return (
          <div title={t('uxs02.budgetSummary', '{{actual}} of {{budget}} Active budget', { actual: formatExactMoney(money.actuals.total, money.actuals.currency || p.currency, getNumberLocale()), budget: formatExactMoney(money.activeBudgetAmount, money.activeBudgetCurrency ?? p.currency, getNumberLocale()) })}>
            <ProgressBar value={percent} showValue compact tone={atRisk ? 'destructive' : percent >= 70 ? 'warning' : undefined} aria-label={t('uxs02.budgetUsed', '{{percent}}% of Active budget', { percent })} />
          </div>
        );
      },
    },
  ];
  const columnOrder = ['project', 'pm', 'status', 'progress', 'contract', 'actual', 'budget-used'];
  columns.sort((left, right) => columnOrder.indexOf(left.key) - columnOrder.indexOf(right.key));

  // AC-L10N-052: the download carries each row's own ISO code beside contract (export-only).
  const exportColumns = withCurrencyColumn(columns, 'contract', (r) => r.currency);

  const primaryAction = newProjectAction(canCreate, () => openRecord('/projects/new'), t('projects.actions.new', 'New project'));
  const filtersCount = (filter !== roleDefault ? 1 : 0) +
    (isEngineer ? 0 : Number(filterClient !== 'All') + Number(filterEndCustomer !== 'All') + Number(filterPM !== 'All')) +
    classificationCount;
  const optionRetry = (result: { isPending: boolean; isError: boolean; refetch?: () => unknown }) =>
    !result.isPending && result.isError ? (
      <button type="button" onClick={() => result.refetch?.()} className="touch-target text-[12px] font-semibold text-primary-text underline-offset-2 hover:underline">
        {t('projects:filters.retryOptions', 'Retry options')}
      </button>
    ) : null;
  const toolbar = (
    <>
      <SearchMini id="projects-search" placeholder={t('projects.search.placeholder', 'Search projects…')}
        aria-label={t('projects.search.ariaLabel', 'Search projects')} value={search}
        onChange={(event) => setSearch(event.target.value)} searchSurface="projects-list" module="projects"
        resultCount={filtered.length} className="h-full touch-target"
        containerClassName="h-11 min-w-0 w-full md:h-8 md:w-auto md:min-w-[220px] md:max-w-[360px] md:flex-1" />
      <div className="flex min-w-0 w-full flex-wrap items-end gap-2 md:w-auto">
        <div className="min-w-[144px] flex-1 md:flex-none">
          <SelectField label={t('projects:filters.scopeLabel', 'Scope')} value={filter}
            onChange={(value) => { setWorkingSet((ws) => ({ ...ws, filter: value as StatusFilter })); trackFilterApplied('status', FILTERS.length, 'projects'); }}
            options={FILTERS.map((value) => ({ value, label: filterLabels[value] }))} className="touch-target min-w-0" />
        </div>
        <ProjectClassificationFilters {...classificationFilterProps} hideAppliedSummary
          panel={(fields, disclosure) => (
            <MobileToolbarDisclosure label={t('uxs14.filters', 'Filters')} count={filtersCount}
              className="[&>button]:touch-target [&_button]:touch-target [&_input]:touch-target [&_select]:touch-target"
              open={disclosure.open} closeOnSelectChange
              onOpenChange={(next) => { disclosure.onOpenChange(next); if (next) setMoreOpen(false); }}>
              <div className="grid w-full min-w-0 gap-3">
                {!isEngineer && <>
                  <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <SelectField label={t('projects.filters.customerLabel', 'Filter by customer')} value={filterClient}
                      onChange={(value) => { setWorkingSet((ws) => ({ ...ws, client: value })); trackFilterApplied('customer', customerFilterOptions.length, 'projects'); }}
                      options={customerFilterOptions} fullWidth />
                    <div className="min-w-0">
                      <SelectField label={t('projects.filters.endCustomerLabel', 'Filter by end customer')} value={filterEndCustomer}
                        onChange={(value) => { setWorkingSet((ws) => ({ ...ws, endClient: value })); trackFilterApplied('end_customer', endCustomerFilterOptions.length, 'projects'); }}
                        options={endCustomerFilterOptions} fullWidth />
                      {optionRetry(companiesResult)}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <SelectField label={t('projects.filters.pmLabel', 'Filter by project manager')} value={filterPM}
                      onChange={(value) => { setWorkingSet((ws) => ({ ...ws, pm: value })); trackFilterApplied('project_manager', pmFilterOptions.length, 'projects'); }}
                      options={pmFilterOptions} fullWidth />
                    {optionRetry(projectManagersResult)}
                  </div>
                  {optionRetry(clientCompaniesResult)}
                </>}
                {fields}
              </div>
            </MobileToolbarDisclosure>
          )} />
      </div>
      <div className="min-w-[205px] flex-1 md:flex-none">
        <SelectField label={t('projects:sort.label', 'Sort projects')} value={workingSet.sort}
          onChange={(value) => setWorkingSet((ws) => ({ ...ws, sort: value as ProjectSort }))}
          options={(Object.keys(sortLabels) as ProjectSort[]).map((value) => ({ value, label: sortLabels[value] }))}
          className="touch-target min-w-0" />
      </div>
      <div data-testid="list-page-view" className="min-w-[138px] flex-1 md:flex-none">
        <SelectField label={t('projects:view.label', 'View')} value={view}
          onChange={(value) => onViewChange(value as ProjectView)}
          options={[
            { value: 'table', label: t('projects.view.table', 'Table') },
            { value: 'cards', label: t('projects.view.cards', 'Cards') },
            { value: 'kanban', label: t('projects.view.board', 'Board') },
            { value: 'calendar', label: t('projects.view.calendar', 'Calendar') },
          ]} className="touch-target min-w-0" />
      </div>
      <MobileToolbarDisclosure label={t('uxs14.moreActions', 'More actions')} open={moreOpen}
        className="[&>button]:touch-target [&_button]:touch-target [&_input]:touch-target [&_select]:touch-target"
        onOpenChange={(next) => { setMoreOpen(next); if (next) setFiltersOpen(false); }}>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <ExportButton rows={filtered} columns={exportColumns} entity="Projects" label={t('projects.export', 'Export')} onExport={() => setMoreOpen(false)} />
          <ImportButton entity="project" descriptor={importDescriptor} onImported={() => void refetch()} label={t('projects.import', 'Import')} />
          <ImportButton entity="budgetLine" label={t('projects.importBudgets', 'Import budgets')} descriptor={budgetImportDescriptor} onImported={() => void refetch()} />
        </div>
      </MobileToolbarDisclosure>
    </>
  );
  const activeChips: Array<{ label: string; remove: () => void }> = [];
  if (filter !== roleDefault) activeChips.push({ label: t('projects:filters.scopeChip', 'Scope: {{scope}}', { scope: filterLabels[filter] }), remove: () => setWorkingSet((ws) => ({ ...ws, filter: roleDefault })) });
  if (filterClient !== 'All') {
    const value = customerFilterOptions.find((option) => option.value === filterClient)?.label ?? t('projects:filters.unavailableSelection', 'Unavailable selection');
    activeChips.push({ label: t('projects:filters.customerChip', 'Customer: {{value}}', { value }), remove: () => setWorkingSet((ws) => ({ ...ws, client: 'All' })) });
  }
  if (filterEndCustomer !== 'All') {
    const value = endCustomerFilterOptions.find((option) => option.value === filterEndCustomer)?.label ?? t('projects:filters.unavailableSelection', 'Unavailable selection');
    activeChips.push({ label: t('projects:filters.endCustomerChip', 'End customer: {{value}}', { value }), remove: () => setWorkingSet((ws) => ({ ...ws, endClient: 'All' })) });
  }
  if (filterPM !== 'All') {
    const value = pmFilterOptions.find((option) => option.value === filterPM)?.label ?? t('projects:filters.unavailableSelection', 'Unavailable selection');
    activeChips.push({ label: t('projects:filters.managerChip', 'Project manager: {{value}}', { value }), remove: () => setWorkingSet((ws) => ({ ...ws, pm: 'All' })) });
  }
  const classificationLabels: Record<(typeof CLASSIFICATION_FILTER_KEYS)[number], string> = {
    serviceLine: t('projectClassification.serviceLine', 'Service line'), sector: t('projectClassification.sector', 'Sector'),
    location: t('projectClassification.location', 'Location'), awardType: t('projectClassification.awardType', 'Award type'),
    biddingEntity: t('projectClassification.biddingEntity', 'Bidding entity'),
  };
  for (const key of CLASSIFICATION_FILTER_KEYS) {
    const value = workingSet[key];
    if (value) activeChips.push({ label: classificationLabels[key] + ': ' + classificationValueLabel(t, value), remove: () => setWorkingSet((ws) => ({ ...ws, [key]: undefined })) });
  }
  if (search.trim()) activeChips.push({ label: t('projects:filters.searchChip', 'Search: {{value}}', { value: search.trim() }), remove: () => setSearch('') });
  const activeFilterSummary = filtersActive ? (
    <div data-testid="active-filter-summary" aria-label={t('projects:filters.active', 'Applied filters')} className="flex min-w-0 flex-wrap items-center gap-2">
      {activeChips.map((chip) => <button key={chip.label} type="button"
        className="touch-target inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-1 pl-2.5 pr-1.5 text-left text-[12px] text-muted-foreground hover:text-foreground"
        aria-label={t('projects:filters.removeFilter', 'Remove filter: {{filter}}', { filter: chip.label })} onClick={chip.remove}>
        <span className="min-w-0 break-words">{chip.label}</span><Icon name="x" className="size-3 shrink-0" />
      </button>)}
      <Button variant="ghost" size="sm" className="touch-target text-primary-text" onClick={clearFilters}>{t('projects.empty.clearFilters', 'Clear filters')}</Button>
    </div>
  ) : null;
  const dataIssues = [
    coverageReason,
    deliveryError ? t('projects:data.deliveryUnavailable', 'Delivery progress is unavailable.') : null,
    moneyError ? t('projects:data.moneyUnavailable', 'Actual and Active budget are unavailable.') : null,
  ].filter((issue): issue is string => Boolean(issue));
  const abnormalNote = dataIssues.length > 0 ? (
    <aside role="status" data-testid="projects-data-note" className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
      <div className="min-w-0 space-y-0.5"><p className="font-semibold text-foreground">{t('projects:data.noteTitle', 'Some project data needs attention')}</p>{dataIssues.map((issue) => <p key={issue}>{issue}</p>)}</div>
      <div className="flex flex-wrap gap-2">
        {deliveryError && <Button variant="ghost" size="sm" className="touch-target" onClick={() => void refetchDelivery()}>{t('projects:data.retryDelivery', 'Retry delivery')}</Button>}
        {moneyError && <Button variant="ghost" size="sm" className="touch-target" onClick={() => void refetchMoney()}>{t('projects:data.retryMoney', 'Retry financial data')}</Button>}
      </div>
    </aside>
  ) : null;
  const loadingContent = view === 'table' ? (
    <DataTable<ProjectWithRefs> rows={[]} columns={columns} rowKey={(project) => project.id} tableId="projects-list"
      rowMenu={canRowWrite ? rowMenu : undefined} state="loading" />
  ) : <div data-testid="projects-loading" className="min-w-0 rounded-lg border border-border bg-card p-3"><ListState variant="loading" rows={view === 'cards' ? 3 : 5} /></div>;

  let content: React.ReactNode;
  if (isPending) content = loadingContent;
  else if (isError || !data) content = (
    <ListState variant="error" title={t('projects.states.errorTitle', "Couldn't load projects")}
      sub={t('projects.states.errorSub', 'Something went wrong fetching your projects.')} onRetry={() => refetch()} />
  );
  else if (all.length === 0) content = (
    <ListState variant="empty" icon="folder" title={t('projects.states.emptyTitle', 'No projects yet')}
      sub={t('projects.states.emptySub', 'Projects you create or win will appear here.')} stateId="projects-empty"
      role={realRole ?? undefined} module="projects" />
  );
  else if (filter === 'at-risk' && moneyPending) content = loadingContent;
  else if (filtered.length === 0) content = (
    <ListState variant="empty" icon="folder"
      title={filter === 'at-risk' ? t('projects.empty.nothingAtRiskTitle', 'No confirmed budget-risk signals') : t('projects.empty.noMatchTitle', 'No projects match this scope')}
      sub={filter === 'at-risk' ? t('projects.empty.nothingAtRiskSub', 'Unassessed budget data is not assurance.') : t('projects.empty.noMatchSub', 'Adjust the scope or filters to see more projects.')} />
  );
  else if (view === 'kanban') content = <ProjectKanbanBoard projects={filtered} onOpen={(project) => onOpen(project, 'card')} />;
  else if (view === 'calendar') content = (
    <ProjectCalendarView projects={filtered} milestoneDates={milestoneDates} cursor={calendarCursor} onCursorChange={onCalendarCursorChange}
      onOpenProject={(id) => { trackProjectDetailOpened('/projects/:projectId', 'card'); openRecord('/projects/' + id); }} />
  );
  else if (view === 'table') content = (
    <DataTable<ProjectWithRefs> rows={filtered} columns={columns} rowKey={(project) => project.id}
      tableId="projects-list" onActivate={onOpen} rowMenu={canRowWrite ? rowMenu : undefined} />
  );
  else content = (
    <div className="grid min-w-0 grid-cols-1 gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))]">
      {filtered.map((project) => <ProjectCard key={project.id} project={project} onOpen={(row) => onOpen(row, 'card')}
        deliverySummary={deliverySummary?.[project.id]} deliveryPending={deliveryPending} deliveryError={deliveryError}
        projectMoney={projectMoney?.[project.id]} projectMoneyPending={moneyPending} projectMoneyError={moneyError}
        onEdit={canEdit ? (row) => setEditTarget(row) : undefined} />)}
    </div>
  );

  const scopeLine = <>
    <span>{t('projects:scope.onHandInternal', 'On-hand + internal')}</span><span aria-hidden>·</span>
    <span>{filterLabels[filter]}</span><span aria-hidden>·</span>
    <span>{isPending ? t('projects:scope.loading', 'Loading projects') : t('projects:scope.resultCount', '{{count}} projects', { count: filtered.length })}</span>
    <span aria-hidden>·</span>
    <Link to="/sales" className="touch-target rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('projects:scope.pipeline', 'Pipeline')}</Link>
  </>;

  return (
    <ProjectPageFrame title={t('projects.title', 'Projects')} scope={scopeLine} toolbar={toolbar} primaryAction={primaryAction}>
      {activeFilterSummary}
      {abnormalNote}
      {content}
      {/* Edit-header modal (Admin·Exec·PM) — opened from the row menu */}
      {editTarget && (
        <ProjectFormModal
          mode="editHeader"
          initial={{
            ...pickClassification(editTarget),
            id: editTarget.id,
            name: editTarget.name,
            short_name: editTarget.short_name,
            code: editTarget.code,
            client_id: editTarget.client_id,
            project_manager_id: editTarget.project_manager_id,
            clientName: editTarget.client ? companyDisplayName(editTarget.client) : null,
            end_client_id: editTarget.end_client_id,
            endClientName: editTarget.end_client ? companyDisplayName(editTarget.end_client) : null,
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
    </ProjectPageFrame>
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
    <Button variant="primary" className="touch-target h-11 md:h-8" onClick={onNew}>
      <Icon name="plus" />
      {label}
    </Button>
  ) : undefined;

export default Projects;
