import ProjectClassificationFilters from '../components/ProjectClassificationFilters';
import { activeClassificationCount, CLASSIFICATION_FILTER_KEYS, classificationValueLabel, matchesProjectClassification, pickClassification } from '@/src/lib/projectClassification';
import type { ProjectClassificationFilters as ClassificationFilterValues } from '@/src/lib/projectClassification';
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
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { currentMonthToken, parseListWorkingSet } from '@/src/lib/listWorkingSet';
import type { MonthCursor } from '@/src/lib/calendar/monthMatrix';
import type { ProjectView } from '@/src/hooks/useProjectView';
import { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import { useProjectsMoneyCollection } from '@/src/hooks/useProjectsMoneyCollection';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackProjectDetailOpened, trackFilterApplied } from '@/src/lib/analytics';
import { formatDateOnly, formatInstantDate } from '@/src/lib/format';
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
import { ProjectCollectionLoading } from '@/src/components/projects/ProjectCollectionLoading';
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
  const statusLabel = useProjectStatusLabel();
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
  const sortControlLabels: Record<ProjectSort, string> = {
    attention: t('projects:sort.attentionShort', 'Risk → end date'),
    'expected-end': t('projects:sort.expectedEndShort', 'Soonest end'),
    name: t('projects:sort.nameShort', 'Name A–Z'),
  };

  // Filter-select option lists (the tokened SelectField consumes {value,label});
  // the leading "All …" sentinel value is the cleared state.
  const customerFilterOptions = useMemo(
    () => [
      { value: 'All', label: t('projects.filters.allCustomers', 'All customers') },
      ...clientCompanies.map((c) => ({ value: c.id, label: c.name })),
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
      ...[...associated].map(([id, company]) => ({ value: id, label: company.name })),
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
  // amount-less category, and the newest ERP update among the visible rows. Restricted rows keep
  // their own distinct explanation instead of being folded into this shared condition.
  const partialRows = filtered.filter((project) => {
    const money = projectMoney?.[project.id];
    const basis = money?.ledgerBasis ?? 'erp';
    return basis === 'erp' && Boolean(money && !money.actuals.excludesRestrictedRows
      && !isActualComplete({ basis, readSucceeded: !moneyError, complete: money.actuals.complete, categories: money.actuals.categories }));
  });
  const partialProjectIds = new Set(partialRows.map((project) => project.id));
  const partialCoverageNoteId = 'projects-data-note';
  const partialUnavailable = (
    <span aria-describedby={partialCoverageNoteId}>{t('uxs02.unavailable', 'Unavailable')}</span>
  );
  const coverageAsOf = partialRows.reduce<string | null>((latest, project) => {
    const asOf = projectMoney?.[project.id]?.ledgerBasis === 'erp' ? projectMoney?.[project.id]?.actuals.asOf ?? null : null;
    return asOf && (!latest || asOf > latest) ? asOf : latest;
  }, null);
  const coverageReason = partialRows.length === 0 ? undefined : coverageAsOf
    ? t('projects:coverage.partialUpdated', 'Actual is partial on {{partial}} of {{total}} projects. Updated {{date}}.', { partial: partialRows.length, total: filtered.length, date: formatInstantDate(coverageAsOf) })
    : t('projects:coverage.partial', 'Actual is partial on {{partial}} of {{total}} projects.', { partial: partialRows.length, total: filtered.length });
  const actualStateLabel = (money?: ProjectMoneyRead) => {
    if (moneyError || !money) return t('uxs02.unavailable', 'Unavailable');
    if (money.actuals.excludesRestrictedRows) return t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded');
    if ((money.ledgerBasis ?? 'erp') === 'erp' && !isActualComplete({ basis: money.ledgerBasis ?? 'erp', readSucceeded: !moneyError, complete: money.actuals.complete, categories: money.actuals.categories })) {
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
  const projectReferences = (project: ProjectWithRefs): Array<[string, string]> => [
    project.pmo_project_number && [t('projects.identifiers.pmo', 'PMO Project Number'), project.pmo_project_number],
    project.code && [t('projects.identifiers.client', 'Client Project Code'), project.code],
    project.customer_contract_ref && [t('uxs14.contractReference', 'Customer contract reference'), project.customer_contract_ref],
  ].filter((value): value is [string, string] => Boolean(value));
  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: t('projects.columns.project', 'Project'),
      kind: 'primary',
      size: 248,
      minSize: 240,
      maxSize: 520,
      primaryClamp: false,
      secondaryWrap: true,
      exportValue: (p) => p.name,
      primaryTitle: (p) => p.name,
      secondaryCell: (p) => {
        const references = projectReferences(p);
        return (
          <span data-testid="projects-identity-secondary" className="block min-w-0 space-y-1" onClick={(event) => event.stopPropagation()}>
            {p.client && <CompanyNameLink companyId={p.client_id} name={p.client.name} className="touch-target block max-w-full break-words text-sm" />}
            {p.end_client && <span className="block break-words text-sm text-muted-foreground">{t('projects:endCustomer', 'End customer')}: {p.end_client.name}</span>}
            {references.length > 0 && <details className="min-w-0" aria-label={t('projects:mobile.detailsFor', 'Details for {{name}}', { name: p.name })}>
              <summary aria-label={`${p.name}: ${t('projects:identifiers.summary', 'Project IDs ({{count}})', { count: references.length })}`} className="touch-target min-h-11 cursor-pointer break-words text-xs font-semibold underline-offset-2 hover:underline">
                {t('projects:identifiers.summary', 'Project IDs ({{count}})', { count: references.length })}
              </summary>
              <span className="block min-w-0 space-y-0.5 pt-1 text-xs text-muted-foreground">
                {references.map(([label, value]) => <span key={label} className="block min-w-0 break-words">{label}: <span className="break-all font-mono text-foreground">{value}</span></span>)}
              </span>
            </details>}
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
                  className="touch-target block min-h-11 w-full whitespace-normal break-words text-left text-xl font-bold underline underline-offset-2 hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  title={p.name}
                >
                  {p.name}
                </button>
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
      header: t('projects:columns.pmTable', 'Project manager'),
      kind: 'meta',
      colClassName: 'whitespace-normal break-words leading-tight',
      size: 124,
      minSize: 112,
      maxSize: 220,
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
      header: t('projects:columns.statusAndEndTable', 'Status / end date'),
      kind: 'status',
      size: 144,
      minSize: 128,
      maxSize: 196,
      colClassName: 'whitespace-normal break-words leading-tight',
      exportValue: (p) => String(p.status),
      cell: (p) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <StatusPill variant={pillVariantForProjectStatus(p.status as string)}>{statusLabel(p.status as string)}</StatusPill>
          <span className="text-xs text-muted-foreground">
            {p.end_date ? formatDateOnly(p.end_date) : t('projects:dates.noExpectedEnd', 'No expected end')}
          </span>
        </div>
      ),
    },
    {
      key: 'contract',
      header: t('projects.columns.contract', 'Contract'),
      kind: 'money',
      size: 152,
      minSize: 144,
      maxSize: 260,
      align: 'num',
      colClassName: 'whitespace-normal',
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
            <span>{p.currency} {formatExactMoney(String(p.contract_value), p.currency, getNumberLocale(), { trimZeroFraction: true, includeCurrency: false })}</span>
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
      size: 152,
      minSize: 144,
      maxSize: 260,
      align: 'num',
      colClassName: 'xl:pr-4 whitespace-normal',
      // RF-008 / S-02: canonical ERP-mapped Actual, never the legacy stored project.spent value.
      cell: (p) => {
        if (moneyPending) return <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>;
        const money = projectMoney?.[p.id];
        if (moneyError || !money) return <span>{t('uxs02.unavailable', 'Unavailable')}</span>;
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
        if (partialProjectIds.has(p.id)) return partialUnavailable;
        if (actual == null) {
          // Unknown is never 0. The common partial-source condition is named once above the table;
          // the row value points to that note instead of repeating its explanation and action.
          if (partialProjectIds.has(p.id)) return partialUnavailable;
          return linkedDataState(p, actualStateLabel(money));
        }
        const actualCurrency = actualPosition.currency || p.currency;
        const formattedActual = formatExactMoney(actual, actualCurrency, getNumberLocale(), { trimZeroFraction: true, includeCurrency: false });
        return formattedActual == null ? linkedDataState(p, t('uxs02.unavailable', 'Unavailable')) : <span className="text-muted-foreground">{actualCurrency} {formattedActual}</span>;
      },
    },
    {
      key: 'progress',
      header: t('projects:columns.delivery', 'Delivery'),
      kind: 'percent',
      size: 96,
      minSize: 88,
      maxSize: 140,
      colClassName: 'xl:pl-4',
      cell: (p) => {
        // I7: defer while delivery summary is loading to prevent flash of false empty state.
        if (deliveryError) return <span>{t('uxs02.unavailable', 'Unavailable')}</span>;
        if (deliveryPending) {
          return <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>;
        }
        const summary = deliverySummary?.[p.id];
        if (summary?.deliveryPct == null) {
          return <span>{t('projects.noPhasesYet', 'No phases yet')}</span>;
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
      size: 132,
      minSize: 120,
      maxSize: 220,
      colClassName: 'whitespace-normal break-words leading-tight',
      cell: (p) => {
        if (moneyPending) return <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>;
        const money = projectMoney?.[p.id];
        const actual = money?.actuals.total == null ? null : Number(money.actuals.total);
        const activeBudget = money?.hasActiveBudget && money.activeBudgetAmount != null ? Number(money.activeBudgetAmount) : null;
        if (moneyError || !money) return <span>{t('uxs02.unavailable', 'Unavailable')}</span>;
        if (!money.hasActiveBudget) {
          return linkedDataState(p, t('uxs02.noActiveBudget', 'No active budget'), 'budget');
        }
        if (activeBudget == null) return linkedDataState(p, t('uxs02.unavailable', 'Unavailable'), 'budget');
        if (activeBudget === 0) {
          const budgetCurrency = money.activeBudgetCurrency ?? p.currency;
          const amount = formatExactMoney(money.activeBudgetAmount, budgetCurrency, getNumberLocale(), { trimZeroFraction: true, includeCurrency: false });
          const reason = t('uxs02.zeroActiveBudget', '{{budget}} Active budget; usage unavailable', { budget: amount == null ? t('uxs02.unavailable', 'Unavailable') : `${budgetCurrency} ${amount}` });
          return linkedDataState(p, reason, 'budget');
        }
        if (actual == null) {
          if (partialProjectIds.has(p.id)) return partialUnavailable;
          return linkedDataState(p, actualStateLabel(money));
        }
        if (money.activeBudgetCurrency !== money.actuals.currency || money.actuals.currency !== p.currency) {
          return linkedDataState(p, t('uxs02.currencyMismatch', 'Budget currency differs from Actual'), 'budget');
        }
        const completeCoverage = isActualComplete({ basis: money.ledgerBasis ?? 'erp', readSucceeded: true, complete: money.actuals.complete,
          categories: money.actuals.categories, excludesRestrictedRows: money.actuals.excludesRestrictedRows });
        if (!completeCoverage) {
          if (partialProjectIds.has(p.id)) return partialUnavailable;
          const reason = money.actuals.excludesRestrictedRows ? t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded') : t('uxs02.incompleteCoverage', 'Incomplete source coverage');
          return linkedDataState(p, reason);
        }
        const percent = Math.round((actual / activeBudget) * 100);
        const atRisk = isAtRiskActual(p);
        return (
          <div title={t('uxs02.budgetSummary', '{{actual}} of {{budget}} Active budget', { actual: `${money.actuals.currency || p.currency} ${formatExactMoney(money.actuals.total, money.actuals.currency || p.currency, getNumberLocale(), { trimZeroFraction: true, includeCurrency: false })}`, budget: `${money.activeBudgetCurrency ?? p.currency} ${formatExactMoney(money.activeBudgetAmount, money.activeBudgetCurrency ?? p.currency, getNumberLocale(), { trimZeroFraction: true, includeCurrency: false })}` })}>
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
      <button type="button" onClick={() => result.refetch?.()} className="touch-target text-xs font-semibold text-primary-text underline-offset-2 hover:underline">
        {t('projects:filters.retryOptions', 'Retry options')}
      </button>
    ) : null;
  const toolbar = (
    <div className="grid w-full min-w-0 grid-cols-2 items-end gap-x-2 gap-y-2 md:contents">
      <SearchMini id="projects-search" placeholder={t('projects.search.placeholder', 'Search projects…')}
        aria-label={t('projects.search.ariaLabel', 'Search projects')} value={search}
        onChange={(event) => setSearch(event.target.value)} searchSurface="projects-list" module="projects"
        resultCount={filtered.length} className="h-full touch-target"
        containerClassName="col-span-2 h-11 min-w-0 w-full md:col-auto md:h-8 md:w-auto md:min-w-[220px] md:max-w-[360px] md:flex-1" />
      <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 md:col-auto md:flex md:w-auto">
        <div className="min-w-0 md:min-w-[144px] md:flex-1 md:flex-none">
        <SelectField label={t('projects:filters.scopeLabel', 'Scope')} hideLabel value={filter}
            onChange={(value) => { setWorkingSet((ws) => ({ ...ws, filter: value as StatusFilter })); trackFilterApplied('status', FILTERS.length, 'projects'); }}
            options={FILTERS.map((value) => ({ value, label: filterLabels[value] }))} className="touch-target min-w-0" />
        </div>
        <ProjectClassificationFilters {...classificationFilterProps} hideAppliedSummary
          panel={(fields, disclosure) => (
            <MobileToolbarDisclosure label={t('uxs14.filters', 'Filters')} count={filtersCount}
              className="min-w-0 [&>button]:touch-target [&_button]:touch-target [&_input]:touch-target [&_select]:touch-target"
              open={disclosure.open} closeOnSelectChange mobileOverlay mobileOverlayAlign="start"
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
      <div className="min-w-0 w-full md:min-w-[184px] md:w-auto md:flex-none">
        <SelectField id="projects-sort-select" label={t('projects:sort.label', 'Sort projects')} hideLabel value={workingSet.sort}
          onChange={(value) => setWorkingSet((ws) => ({ ...ws, sort: value as ProjectSort }))}
          aria-describedby="projects-sort-description"
          title={sortLabels[workingSet.sort]}
          options={(Object.keys(sortControlLabels) as ProjectSort[]).map((value) => ({ value, label: sortControlLabels[value] }))}
          className="touch-target min-w-0" />
        <span id="projects-sort-description" className="sr-only">{sortLabels[workingSet.sort]}</span>
      </div>
      <div data-testid="list-page-view" className="min-w-0 w-full self-start md:min-w-[138px] md:w-auto md:flex-none md:self-auto">
        <SelectField label={t('projects:view.label', 'View')} hideLabel value={view}
          onChange={(value) => onViewChange(value as ProjectView)}
          options={[
            { value: 'table', label: t('projects.view.table', 'Table') },
            { value: 'cards', label: t('projects.view.cards', 'Cards') },
            { value: 'kanban', label: t('projects.view.board', 'Board') },
            { value: 'calendar', label: t('projects.view.calendar', 'Calendar') },
          ]} className="touch-target min-w-0" />
      </div>
      <MobileToolbarDisclosure label={t('uxs14.moreActions', 'More actions')} open={moreOpen}
        className="min-w-0 [&>button]:touch-target [&_button]:touch-target [&_input]:touch-target [&_select]:touch-target"
        mobileOverlay mobileOverlayAlign="end"
        onOpenChange={(next) => { setMoreOpen(next); if (next) setFiltersOpen(false); }}>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <ExportButton rows={filtered} columns={exportColumns} entity="Projects" label={t('projects.export', 'Export')} onExport={() => setMoreOpen(false)} />
          <ImportButton entity="project" descriptor={importDescriptor} onImported={() => void refetch()} label={t('projects.import', 'Import')} />
          <ImportButton entity="budgetLine" label={t('projects.importBudgets', 'Import budgets')} descriptor={budgetImportDescriptor} onImported={() => void refetch()} />
        </div>
      </MobileToolbarDisclosure>
      <div className="flex min-w-0 justify-end md:contents">{primaryAction}</div>
    </div>
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
  const activeFilterSummary = filtersActive ? (
    <div data-testid="active-filter-summary" aria-label={t('projects:filters.active', 'Applied filters')} className="flex min-w-0 flex-wrap items-center gap-2">
      {activeChips.map((chip) => <button key={chip.label} type="button"
        className="touch-target inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-1 pl-2.5 pr-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
        aria-label={t('projects:filters.removeFilter', 'Remove filter: {{filter}}', { filter: chip.label })} onClick={chip.remove}>
        <span className="min-w-0 break-words">{chip.label}</span><Icon name="x" className="size-3 shrink-0" />
      </button>)}
      <Button variant="ghost" size="sm" className="touch-target text-primary-text" onClick={clearFilters}>{t('projects.empty.clearFilters', 'Clear filters')}</Button>
    </div>
  ) : null;
  const collectionShowsMoney = view === 'table' || view === 'cards';
  const dataIssues = collectionShowsMoney ? [
    coverageReason,
    deliveryError ? t('projects:data.deliveryUnavailable', 'Delivery progress is unavailable.') : null,
    moneyError ? t('projects:data.moneyUnavailable', 'Actual and Active budget are unavailable.') : null,
  ].filter((issue): issue is string => Boolean(issue)) : [];
  const abnormalNote = dataIssues.length > 0 ? (
    <div role="status" id={partialCoverageNoteId} data-testid="projects-data-note" className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-y border-border py-2 text-sm text-muted-foreground">
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs font-semibold leading-4 text-foreground">{t('projects:data.noteTitle', 'Some project data needs attention')}</p>
        <p className="break-words">{dataIssues.join(' · ')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {partialRows[0] && <Link to={`/projects/${partialRows[0].id}/overview`} className="touch-target inline-flex min-h-11 max-w-full items-center break-words rounded-sm text-left text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('projects:actions.reviewFinances', 'Review project finances')}</Link>}
      {collectionShowsMoney && deliveryError && <Button variant="ghost" size="sm" className="touch-target" onClick={() => void refetchDelivery()}>{t('projects:data.retryDelivery', 'Retry delivery')}</Button>}
        {collectionShowsMoney && moneyError && <Button variant="ghost" size="sm" className="touch-target" onClick={() => void refetchMoney()}>{t('projects:data.retryMoney', 'Retry financial data')}</Button>}
      </div>
    </div>
  ) : null;
  const columnCell = (key: string, project: ProjectWithRefs) => columns.find((column) => column.key === key)?.cell(project);
  const mobileProjectRow = (project: ProjectWithRefs) => {
    const money = projectMoney?.[project.id];
    const displayName = project.name;
    const activeBudgetSummary = moneyError || !money
      ? t('uxs02.unavailable', 'Unavailable')
      : !money.hasActiveBudget
        ? t('uxs02.noActiveBudget', 'No active budget')
        : money.activeBudgetAmount == null
          ? t('uxs02.unavailable', 'Unavailable')
          : `${money.activeBudgetCurrency ?? project.currency} ${formatExactMoney(money.activeBudgetAmount, money.activeBudgetCurrency ?? project.currency, getNumberLocale(), { trimZeroFraction: true, includeCurrency: false })}`;
    const detailFacts: Array<[string, React.ReactNode]> = [
      ...projectReferences(project).map(([label, value]) => [label, <span className="break-all font-mono">{value}</span>] as [string, React.ReactNode]),
      [t('projects:columns.pm', 'PM'), columnCell('pm', project)],
      [t('projects:columns.delivery', 'Delivery'), columnCell('progress', project)],
      [t('projects:columns.actual', 'Actual'), columnCell('actual', project)],
      [t('uxs02.activeBudget', 'Active budget'), activeBudgetSummary],
      [t('projects:columns.budgetUsed', 'Budget used'), columnCell('budget-used', project)],
    ];
    return (
    <div className="min-w-0 space-y-2">
      <button type="button" onClick={() => onOpen(project)}
        className="touch-target block min-h-11 w-full break-words text-left text-xl font-bold underline underline-offset-2 hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={t('projects:kanban.openProject', 'Open project {{name}}', { name: displayName })}
        title={project.name}>
        {displayName}
      </button>
      <div className="min-w-0 space-y-0.5 text-sm text-muted-foreground">
        <p className="break-words">{project.client?.name ?? t('projects:customerUnavailable', 'Customer unavailable')}</p>
        {project.end_client && <p className="break-words">{t('projects:endCustomer', 'End customer')}: {project.end_client.name}</p>}
      </div>
      <div className="min-w-0 text-sm">{columnCell('status', project)}</div>
      <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-2">
        <dt className="text-xs font-semibold text-muted-foreground">{t('projects:columns.contract', 'Contract')}</dt>
        <dd className="min-w-0 break-words text-sm font-normal tabular">{columnCell('contract', project)}</dd>
      </dl>
      <details className="min-w-0" aria-label={t('projects:mobile.detailsFor', 'Details for {{name}}', { name: project.name })}>
        <summary className="touch-target min-h-11 cursor-pointer break-words text-xs font-semibold text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('projects:mobile.moreDetailsSummary', 'More project details · {{count}}', { count: detailFacts.length })}
        </summary>
        <table className="mt-2 w-full table-fixed border-t border-border text-sm">
          <caption className="sr-only">{t('projects:mobile.detailsFor', 'Details for {{name}}', { name: project.name })}</caption>
          <tbody>{detailFacts.map(([label, value]) => <tr key={label} className="border-b border-border/70 last:border-b-0">
            <th scope="row" className="w-1/3 py-2 pr-3 text-left align-top text-xs font-semibold text-muted-foreground">{label}</th>
            <td className="min-w-0 break-words py-2 align-top text-sm font-normal tabular">{value}</td>
          </tr>)}</tbody>
        </table>
      </details>
    </div>
    );
  };
  const tableLoadingLayout = {
    announcement: t('projects:scope.loading', 'Loading projects'),
    cell: () => <span className="block h-3 w-3/4 animate-pulse rounded bg-muted" />,
    mobileRow: <div className="min-w-0 space-y-3"><span className="block h-4 w-2/3 animate-pulse rounded bg-muted" /><span className="block h-3 w-1/2 animate-pulse rounded bg-muted" /><div className="flex justify-between border-t border-border pt-2"><span className="h-3 w-1/4 animate-pulse rounded bg-muted" /><span className="h-3 w-1/3 animate-pulse rounded bg-muted" /></div></div>,
    rows: 3,
  };
  const loadingContent = view === 'table' ? (
    <DataTable<ProjectWithRefs> rows={[]} columns={columns} rowKey={(project) => project.id} tableId="projects-list-loading"
      rowMenu={canRowWrite ? rowMenu : undefined} state="loading" loadingLayout={tableLoadingLayout} mobileRow={mobileProjectRow} />
  ) : <ProjectCollectionLoading view={view} label={t('projects:scope.loading', 'Loading projects')} />;

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
  else if (view === 'kanban') content = <ProjectKanbanBoard projects={filtered} onOpen={(project) => onOpen(project, 'card')}
    atRiskProjectIds={new Set(!moneyPending && !moneyError ? filtered.filter(isAtRiskActual).map((project) => project.id) : [])} />;
  else if (view === 'calendar') content = (
    <ProjectCalendarView projects={filtered} milestoneDates={milestoneDates} cursor={calendarCursor} onCursorChange={onCalendarCursorChange}
      onOpenProject={(id) => { trackProjectDetailOpened('/projects/:projectId', 'card'); openRecord('/projects/' + id); }} />
  );
  else if (view === 'table') content = (
    <DataTable<ProjectWithRefs> rows={filtered} columns={columns} rowKey={(project) => project.id}
      tableId="projects-list-v2" onActivate={onOpen} rowMenu={canRowWrite ? rowMenu : undefined} mobileRow={mobileProjectRow} />
  );
  else content = (
    <div className="grid min-w-0 grid-cols-1 gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))]">
      {filtered.map((project) => <ProjectCard key={project.id} project={project} onOpen={(row) => onOpen(row, 'card')}
        partialCoverageNoteId={partialProjectIds.has(project.id) ? partialCoverageNoteId : undefined}
        deliverySummary={deliverySummary?.[project.id]} deliveryPending={deliveryPending} deliveryError={deliveryError}
        projectMoney={projectMoney?.[project.id]} projectMoneyPending={moneyPending} projectMoneyError={moneyError}
        onEdit={canEdit ? (row) => setEditTarget(row) : undefined} />)}
    </div>
  );

  const scopeCount = isPending
    ? t('projects:scope.loading', 'Loading projects')
    : filter === 'at-risk' && moneyPending
      ? t('projects:scope.riskLoading', 'Checking budget risk')
      : filter === 'at-risk' && moneyError
        ? t('projects:scope.riskUnavailable', 'Risk count unavailable')
        : isError || !data
          ? t('projects:scope.unavailable', 'Count unavailable')
          : t('projects:scope.resultCount', '{{count}} projects', { count: filtered.length });
  const scopeLine = (
    <div className="flex min-w-0 w-full flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 break-words">{t('projects:scope.onHandInternal', 'On-hand + internal')}</span>
      <span className="inline-flex max-w-full items-start gap-1 whitespace-nowrap"><span aria-hidden>·</span><span>{filterLabels[filter]}</span></span>
      <span className="inline-flex max-w-full items-start gap-1 whitespace-nowrap"><span aria-hidden>·</span><span className="font-semibold text-foreground">{scopeCount}</span></span>
      <span className="inline-flex max-w-full items-start gap-1 whitespace-nowrap"><span aria-hidden>·</span><Link to="/sales" className="touch-target rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('projects:scope.pipeline', 'Pipeline')}</Link></span>
    </div>
  );

  return (
    <ProjectPageFrame
      breadcrumb={(
        <nav aria-label={t('projects:breadcrumb', 'Breadcrumb')} className="mb-2 text-sm text-muted-foreground">
          <ol className="flex min-w-0 flex-wrap items-center gap-2">
            <li>{t('projects:area.delivery', 'Delivery')}</li>
            <li aria-hidden="true">›</li>
            <li aria-current="page">{t('projects.title', 'Projects')}</li>
          </ol>
        </nav>
      )}
      title={t('projects.title', 'Projects')}
      scope={scopeLine}
      toolbar={toolbar}
    >
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
            clientName: editTarget.client?.name ?? null,
            end_client_id: editTarget.end_client_id,
            endClientName: editTarget.end_client?.name ?? null,
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
