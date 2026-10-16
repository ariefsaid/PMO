import ProjectClassificationFilters from '../components/ProjectClassificationFilters';
import { activeClassificationCount, matchesProjectClassification, pickClassification } from '@/src/lib/projectClassification';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
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
import { formatCurrency, formatCompactCurrency, formatInstantDate } from '@/src/lib/format';
import { deriveActualPosition, formatExactMoney, isActualComplete } from '@/src/lib/projectFinances';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { ProjectStatus as ProjectStatusEnum } from '../types';
import { pillVariantForProjectStatus, projectIconColor } from '../components/projects';
import ProjectCard from '../components/ProjectCard';
import ProjectFormModal from '../components/ProjectFormModal';
import ProjectCalendarView from '../components/ProjectCalendarView';
import ProjectKanbanBoard from '../components/ProjectKanbanBoard';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { projectManagerLabel, UNASSIGNED_PROJECT_MANAGER } from '@/src/lib/projects/projectManagerLabel';

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
  const { create, updateHeader, archive } = useProjectMutations();

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
  const [classificationOpen, setClassificationOpen] = useState(false);
  const [optionalColumnsVisible, setOptionalColumnsVisible] = useState(false);
  // null = closed; true = the create-deal modal is open.
  const [createOpen, setCreateOpen] = useState(false);
  // null = closed; { project } = edit modal open.
  const [editTarget, setEditTarget] = useState<ProjectWithRefs | null>(null);
  // null = closed; project = archive confirm open.
  const [archiveTarget, setArchiveTarget] = useState<ProjectWithRefs | null>(null);

  const all = useMemo<ProjectWithRefs[]>(() => data ?? [], [data]);

  // NFR-DEL-PERF-001: one batched call for all project delivery summaries (no per-row N+1).
  const { data: deliverySummary, isPending: deliveryPending, isError: deliveryError } = useProjectsDeliverySummary(all.map((p) => p.id));
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
            return isAtRiskActual(p);
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
          (p.pmo_project_number ?? '').toLowerCase().includes(q) ||
          (p.code ?? '').toLowerCase().includes(q) ||
          (p.client?.name ?? '').toLowerCase().includes(q) ||
          (p.client?.short_name ?? '').toLowerCase().includes(q) ||
          (p.end_client?.name ?? '').toLowerCase().includes(q) ||
          (p.end_client?.short_name ?? '').toLowerCase().includes(q),
      );
    // AC-IXD-DASH-W5-C2C N18: within the result, sort at-risk rows to the top.
    // Stable: JS sort is stable, so non-at-risk rows keep their original relative order.
    // Applied to all views so the ordering is consistent regardless of the active segment.
    return rows.sort((a, b) => (isAtRiskActual(a) ? 0 : 1) - (isAtRiskActual(b) ? 0 : 1));
  }, [all, workingSet, filter, filterClient, filterEndCustomer, filterPM, search, currentUser?.id, isEngineer, myProjectIds, isAtRiskActual]);

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

  const classificationCount = activeClassificationCount(workingSet);
  const classificationFilters = (
    <ProjectClassificationFilters rows={all} value={workingSet} closeOnMobileSelect
      onChange={(patch) => setWorkingSet((ws) => ({ ...ws, ...patch }))}
      open={classificationOpen} onOpenChange={(next) => {
        setClassificationOpen(next);
        if (next) { setFiltersOpen(false); setMoreOpen(false); }
      }} />
  );
  const filtersActive =
    classificationCount > 0 || filter !== 'All' || filterClient !== 'All' || filterEndCustomer !== 'All' || filterPM !== 'All' || search.trim() !== '';
  const hasNonDefaultFilter =
    classificationCount > 0 || filter !== roleDefault || filterClient !== 'All' || filterEndCustomer !== 'All' || filterPM !== 'All' || search.trim() !== '';

  // AC-PRJUX-002: Clear all returns the list to the role-default status (All for
  // PM/Admin, My Projects for Engineer), not a literal 'All', while clearing customer,
  // PM, and search — ONE working-set update plus the search reset (#683), so the URL and
  // controls move together and no second event drops the first call. Keeps the view.
  const clearFilters = () => {
    setSearch('');
    setWorkingSet(() =>
      parseListWorkingSet('projects', '', {
        projectsDefaultFilter: roleDefault,
        sessionView: readProjectView(),
      }),
    );
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

  // The create-deal modal — rendered in every page state (the gated CTA in Header
  // can open it from loading/error/empty/success alike). Hidden when createOpen is false.
  const createModal = createOpen ? (
    <ProjectFormModal
      onClose={() => setCreateOpen(false)}
      onSubmit={async (input) => {
        const row = await create.mutateAsync(input);
        toast(t('projects.toast.created', 'Project created'), row.erpSetup === 'pending' ? t('projectDetail.erpLink.createdPending', '{{name}} saved. ERP linking needs attention; retry from the project page.', { name: input.name }) : input.name, row.erpSetup === 'pending' ? 'warning' : 'success');
        setCreateOpen(false);
        // Opens the new record with this list as its return context (#688 AC-RAM-006, #682).
        openRecord(`/projects/${row.id}`);
      }}
      onError={(err) => {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
      }}
    />
  ) : null;

  const hasEndCustomerData = filtered.some((project) => Boolean(project.end_client));
  const hasDeliveryData = deliveryPending || deliveryError || filtered.some((project) => deliverySummary?.[project.id]?.deliveryPct != null);
  const hasBudgetData = moneyPending || moneyError || filtered.some((project) => projectMoney?.[project.id]?.hasActiveBudget);
  const hiddenOptionalColumnCount = Number(!hasEndCustomerData) + Number(!hasDeliveryData) + Number(!hasBudgetData);
  const columns: Column<ProjectWithRefs>[] = [
    {
      key: 'project',
      header: t('projects.columns.project', 'Project'),
      colClassName: 'min-[1280px]:w-[244px] min-[1280px]:max-w-[244px]',
      exportValue: (p) => p.name,
      cell: (p) => {
        const atRisk = isAtRiskActual(p);
        return (
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
              style={{ background: projectIconColor() }}
            >
              {(p.name.trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className="min-w-0 md:w-[190px] md:min-w-[190px]">
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
                >
                  {p.name}
                </button>
                {/* AC-IXD-DASH-W5-C2C N18/I3: text+dot pill (not color-only). */}
                {atRisk && (
                  <StatusPill variant="warn">{t('projects.atRiskPill', 'At risk')}</StatusPill>
                )}
              </div>
              {/* #838: value first — the label is screen-reader-only so it can't eat the width. */}
              <div className="flex min-w-0 font-mono text-[11px] text-muted-foreground">
                <span className="sr-only">{t('projects.identifiers.pmo', 'PMO Project Number')}: </span>
                <span className="break-words md:truncate" title={p.pmo_project_number}>{p.pmo_project_number}</span>
              </div>
              {(p.code || p.customer_contract_ref) && (
                <details className="mt-0.5" onClick={(event) => event.stopPropagation()}>
                  <summary aria-label={t('uxs14.projectReferencesFor', 'More project references for {{name}}', { name: p.name })} className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    {t('uxs14.projectReferences', 'More project references')}
                  </summary>
                  <div className="space-y-0.5 pt-1 font-mono text-[11px] text-muted-foreground">
                    {p.code && <div>{t('projects.identifiers.client', 'Client Project Code')}: <span className="break-words md:truncate" title={p.code}>{p.code}</span></div>}
                    {p.customer_contract_ref && <div>{t('uxs14.contractReference', 'Customer contract reference')}: <span className="break-words md:truncate" title={p.customer_contract_ref}>{p.customer_contract_ref}</span></div>}
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'customer',
      header: t('projects.columns.customer', 'Customer'),
      colClassName: 'min-[1280px]:w-[132px] min-[1280px]:max-w-[132px]',
      exportValue: (p) => p.client ? companyDisplayName(p.client) : '',
      // PL-1 (AC-JR-W3B-E1): customer name is now a CompanyNameLink so execs/PMs
      // can navigate directly to the client record. stopPropagation prevents the
      // row's own click handler (which opens the project detail) from firing when
      // the user clicks the company link.
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()} title={p.client ? companyDisplayName(p.client) : undefined}>
          <CompanyNameLink
            companyId={p.client_id}
            name={p.client ? companyDisplayName(p.client) : null}
            className="block max-w-[132px] overflow-visible text-clip whitespace-normal break-words text-[13px]"
          />
        </div>
      ),
      // The DataTable's bounded scroll keeps ancillary fields reachable on laptops.
    },
    {
      // #758: the end customer (the company the work is ultimately for) — optional, rendered as
      // a company link like Client when set, else the em-dash fallback (never "Not set" noise).
      key: 'end-customer',
      header: t('projects.columns.endCustomer', 'End customer'),
      colClassName: 'min-[1280px]:w-[112px] min-[1280px]:max-w-[112px] min-[1280px]:px-2',
      exportValue: (p) => p.end_client ? companyDisplayName(p.end_client) : '',
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()} title={p.end_client ? companyDisplayName(p.end_client) : undefined}>
          <CompanyNameLink
            companyId={p.end_client_id}
            name={p.end_client ? companyDisplayName(p.end_client) : null}
            className="block max-w-[96px] text-[13px]"
          />
        </div>
      ),
    },
    {
      key: 'pm',
      header: t('projects.columns.pm', 'PM'),
      colClassName: 'min-[1280px]:w-[44px] min-[1280px]:max-w-[44px]',
      // FR-PRJUX-004/005: an assigned blank-name profile exports its readable fallback,
      // and is never exported as "unassigned".
      exportValue: (p) =>
        projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        }),
      // The compact initials avatar preserves the full PM name for assistive technology and hover.
      cell: (p) => {
        if (p.project_manager_id == null) {
          return <span className="text-[12px] text-muted-foreground">{t('projects.unassigned', 'Unassigned')}</span>;
        }
        const label = projectManagerLabel({
          managerId: p.project_manager_id,
          fullName: p.pm?.full_name,
          unassignedLabel: t('projects.unassigned', 'Unassigned'),
          unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
        });
        const initials = label.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
        return (
          <span className="flex items-center justify-center">
            <span
              role="img"
              aria-label={label}
              title={label}
              className="grid size-[18px] shrink-0 place-items-center rounded-full text-[8px] font-bold text-white"
              style={{ background: 'hsl(var(--avatar-2))' }}
            >
              {initials}
            </span>
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
      colClassName: 'min-[1280px]:w-[76px] min-[1280px]:max-w-[76px]',
      exportValue: (p) => String(p.status),
      cell: (p) => (
        <StatusPill
          variant={pillVariantForProjectStatus(p.status as string)}
          // The label wraps beside its dot: `!` overrides the pill's own whitespace-nowrap (cn does
          // not merge conflicting utilities), so a long status never forces the column wider.
          className="max-w-[68px] px-1.5 py-0.5 text-[10px] leading-tight whitespace-normal!"
        >
          {p.status}
        </StatusPill>
      ),
    },
    {
      key: 'contract',
      header: t('projects.columns.contract', 'Contract'),
      colClassName: 'min-[1280px]:w-[98px] min-[1280px]:max-w-[98px]',
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
      colClassName: 'min-[1280px]:w-[94px] min-[1280px]:max-w-[94px]',
      align: 'num',
      // RF-008 / S-02: canonical ERP-mapped Actual, never the legacy stored project.spent value.
      cell: (p) => {
        if (moneyPending) return <span className="text-[12px] text-muted-foreground">…</span>;
        const money = projectMoney?.[p.id];
        if (moneyError || !money) {
          return <span className="text-[12px] text-muted-foreground" title={t('uxs02.unavailable', 'Unavailable')}>{t('uxs02.unavailable', 'Unavailable')}</span>;
        }
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
        const incomplete = money.ledgerBasis === 'erp' && money.actuals.categories.some((category) => !category.mapped || category.amount == null);
        if (actual == null) {
          return (
            <div className="flex flex-col gap-0.5 text-right">
              <span className="text-muted-foreground">{t('uxs02.unavailable', 'Unavailable')}</span>
              {incomplete && <span className="text-[10px] text-warning">{t('uxs02.incompleteCoverage', 'Incomplete source coverage')}</span>}
              {money.actuals.excludesRestrictedRows && <span className="text-[10px] text-muted-foreground">{t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded')}</span>}
            </div>
          );
        }
        return (
          <div className="flex flex-col gap-0.5 text-right">
            <span className="text-muted-foreground">{formatExactMoney(actual, actualPosition.currency || p.currency, getNumberLocale()) ?? t('uxs02.unavailable', 'Unavailable')}</span>
            <span className="text-[10px] text-muted-foreground">{money.ledgerBasis === 'erp' ? t('uxs02.erpActual', 'ERP actual') : t('uxs02.pmoActual', 'Committed POs')}</span>
            {money.ledgerBasis === 'erp' && <span className="text-[10px] text-muted-foreground">{money.actuals.asOf
              ? t('uxs02.updated', 'Updated {{date}}', { date: formatInstantDate(money.actuals.asOf) })
              : t('uxs02.freshnessUnavailable', 'Update time unavailable')}</span>}
            {incomplete && <span className="text-[10px] text-warning">{t('uxs02.incompleteCoverage', 'Incomplete source coverage')}</span>}
            {money.actuals.excludesRestrictedRows && <span className="text-[10px] text-muted-foreground">{t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded')}</span>}
          </div>
        );
      },
    },
    {
      key: 'progress',
      header: t('projects.columns.progress', 'Progress'),
      colClassName: 'min-[1280px]:w-[108px] min-[1280px]:max-w-[108px]',
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
            <ProgressBar value={roundedDelivery} showValue compact tone={roundedDelivery >= 100 ? 'success' : 'primary'} aria-label={t('projects.card.deliveryPercent', 'Delivery {{percent}}%', { percent: roundedDelivery })} />
          </div>
        );
      },
    },
    {
      key: 'budget-used',
      header: t('projects.columns.budgetUsed', 'Budget used'),
      colClassName: 'min-[1280px]:w-[116px] min-[1280px]:max-w-[116px]',
      cell: (p) => {
        if (moneyPending) return <span className="text-[12px] text-muted-foreground">…</span>;
        const money = projectMoney?.[p.id];
        const actual = money?.actuals.total == null ? null : Number(money.actuals.total);
        const activeBudget = money?.hasActiveBudget && money.activeBudgetAmount != null ? Number(money.activeBudgetAmount) : null;
        if (moneyError || !money) {
          return <span className="text-[11px] text-muted-foreground">{t('uxs02.unavailable', 'Unavailable')}</span>;
        }
        if (!money.hasActiveBudget || activeBudget == null) {
          return <span className="text-[11px] text-muted-foreground">{t('uxs02.noActiveBudget', 'No active budget')}</span>;
        }
        if (activeBudget === 0) {
          return <span className="text-[11px] text-muted-foreground">{t('uxs02.zeroActiveBudget', '{{budget}} Active budget; usage unavailable', { budget: formatCurrency(activeBudget, money.activeBudgetCurrency ?? p.currency) })}</span>;
        }
        if (actual == null) {
          return <span className="text-[11px] text-muted-foreground">{t('uxs02.unavailable', 'Unavailable')}</span>;
        }
        if (money.activeBudgetCurrency !== money.actuals.currency || money.actuals.currency !== p.currency) {
          return <span className="text-[11px] text-muted-foreground">{t('uxs02.currencyMismatch', 'Budget currency differs from Actual')}</span>;
        }
        const completeCoverage = isActualComplete({ basis: money.ledgerBasis ?? 'erp', readSucceeded: true, complete: money.actuals.complete,
          categories: money.actuals.categories, excludesRestrictedRows: money.actuals.excludesRestrictedRows });
        if (!completeCoverage) {
          return <span className="text-[11px] text-muted-foreground">{money.actuals.excludesRestrictedRows
            ? t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded')
            : t('uxs02.incompleteCoverage', 'Incomplete source coverage')}</span>;
        }
        const percent = Math.round((actual / activeBudget) * 100);
        const atRisk = isAtRiskActual(p);
        return (
          <div className="flex flex-col gap-0.5">
            <ProgressBar value={percent} showValue compact tone={atRisk ? 'destructive' : percent >= 70 ? 'warning' : undefined} aria-label={t('uxs02.budgetUsed', '{{percent}}% of Active budget', { percent })} />
            <div className="max-w-[120px] whitespace-normal text-[10px] text-muted-foreground">
              {t('uxs02.budgetSummary', '{{actual}} of {{budget}} Active budget', { actual: formatCompactCurrency(actual, money.actuals.currency || p.currency), budget: formatCompactCurrency(activeBudget, money.activeBudgetCurrency ?? p.currency) })}
            </div>
            {atRisk && <span className="text-[10px] font-semibold text-warning">{t('uxs02.atRisk', 'At risk')}</span>}
          </div>
        );
      },
    },
  ];
  const visibleColumns = columns.filter((column) => {
    if (optionalColumnsVisible) return true;
    if (column.key === 'end-customer') return hasEndCustomerData;
    if (column.key === 'progress') return hasDeliveryData;
    if (column.key === 'budget-used') return hasBudgetData;
    return true;
  });

  // AC-L10N-052: the download carries each row's own ISO code beside contract (export-only).
  const exportColumns = withCurrencyColumn(columns, 'contract', (r) => r.currency);

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
    (filterClient !== 'All' ? 1 : 0) + (filterEndCustomer !== 'All' ? 1 : 0) + (filterPM !== 'All' ? 1 : 0);
  const selectedCustomer = customerFilterOptions.find((o) => o.value === filterClient);
  const selectedEndCustomer = endCustomerFilterOptions.find((o) => o.value === filterEndCustomer);
  const selectedPm = pmFilterOptions.find((o) => o.value === filterPM);

  const moreActionsChildren = [
    <ExportButton
      key="export"
      rows={filtered}
      columns={exportColumns}
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
            setWorkingSet((ws) => ({ ...ws, filter: v }));
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
            onChange={onViewChange}
            ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
          />
        </div>
      </div>

      {/* filters + more actions disclosures */}
      <div className="flex flex-wrap items-center gap-2">
        {!isEngineer && (
          <MobileToolbarDisclosure
            label={t('uxs14.filters', 'Filters')}
            count={secondaryCount}
            open={filtersOpen}
            closeOnSelectChange
            onOpenChange={(next) => {
              setFiltersOpen(next);
              if (next) { setMoreOpen(false); setClassificationOpen(false); }
            }}
          >
            <div className="w-full min-w-0 space-y-3">
              <div className="w-full min-w-0 space-y-1">
                <SelectField
                  label={t('projects.filters.customerLabel', 'Filter by customer')}
                  value={filterClient}
                  onChange={(v) => {
                    setWorkingSet((ws) => ({ ...ws, client: v }));
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
                  label={t('projects.filters.endCustomerLabel', 'Filter by end customer')}
                  value={filterEndCustomer}
                  onChange={(v) => {
                    setWorkingSet((ws) => ({ ...ws, endClient: v }));
                    trackFilterApplied('end_customer', endCustomerFilterOptions.length, 'projects');
                  }}
                  options={endCustomerFilterOptions}
                  fullWidth
                />
                {companiesResult.isPending && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('projects.mobile.loading', 'Loading options…')}
                  </p>
                )}
                {!companiesResult.isPending && companiesResult.isError && (
                  <div className="flex items-center gap-2">
                    <p role="alert" className="text-[12px] text-destructive">
                      {t('projects.mobile.error', "Couldn't load options")}
                    </p>
                    <button
                      type="button"
                      onClick={() => companiesResult.refetch?.()}
                      className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {t('projects.mobile.retry', 'Retry')}
                    </button>
                  </div>
                )}
                {!companiesResult.isPending && !companiesResult.isError &&
                  companiesResult.isSuccess && allCompanies.length === 0 && (
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
                    setWorkingSet((ws) => ({ ...ws, pm: v }));
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
            label={t('uxs14.moreActions', 'More actions')}
            open={moreOpen}
            onOpenChange={(next) => {
              setMoreOpen(next);
              if (next) { setFiltersOpen(false); setClassificationOpen(false); }
            }}
          >
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              {moreActionsChildren}
            </div>
          </MobileToolbarDisclosure>
        )}
      </div>

      {classificationFilters}

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
                onClick={() => setWorkingSet((ws) => ({ ...ws, client: 'All' }))}
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
                onClick={() => setWorkingSet((ws) => ({ ...ws, pm: 'All' }))}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          {filterEndCustomer !== 'All' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              <span className="font-medium text-muted-foreground">
                {t('projects.mobile.endCustomer', 'End customer')}: {selectedEndCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}
              </span>
              <button
                type="button"
                aria-label={`${t('projects.mobile.removeEndCustomer', 'Remove end customer filter')}: ${selectedEndCustomer?.label ?? t('projects.mobile.unavailable', 'Unavailable selection')}`}
                className="grid size-[18px] place-items-center rounded-full hover:bg-accent"
                onClick={() => setWorkingSet((ws) => ({ ...ws, endClient: 'All' }))}
              >
                <Icon name="x" className="size-3" />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-[12.5px] font-semibold text-primary-text underline-offset-2 hover:underline"
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
              setWorkingSet((ws) => ({ ...ws, filter: v }));
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
            <MobileToolbarDisclosure
              label={t('uxs14.filters', 'Filters')}
              count={secondaryCount}
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
            >
            <div className="flex min-w-0 flex-wrap gap-2">
            <SelectField
              hideLabel
              label={t('projects.filters.customerLabel', 'Filter by customer')}
              value={filterClient}
              onChange={(v) => {
                setWorkingSet((ws) => ({ ...ws, client: v }));
                trackFilterApplied('customer', customerFilterOptions.length, 'projects');
              }}
              options={customerFilterOptions}
              className="w-auto"
            />
            <SelectField
              hideLabel
              label={t('projects.filters.endCustomerLabel', 'Filter by end customer')}
              value={filterEndCustomer}
              onChange={(v) => {
                setWorkingSet((ws) => ({ ...ws, endClient: v }));
                trackFilterApplied('end_customer', endCustomerFilterOptions.length, 'projects');
              }}
              options={endCustomerFilterOptions}
              className="w-auto"
            />
            <SelectField
              hideLabel
              label={t('projects.filters.pmLabel', 'Filter by project manager')}
              value={filterPM}
              onChange={(v) => {
                setWorkingSet((ws) => ({ ...ws, pm: v }));
                trackFilterApplied('project_manager', pmFilterOptions.length, 'projects');
              }}
              options={pmFilterOptions}
              className="w-auto"
            />
            </div>
            </MobileToolbarDisclosure>
            {classificationFilters}
          </>
        ) : classificationFilters
      }
      exportAction={
        <MobileToolbarDisclosure label={t('uxs14.moreActions', 'More actions')} open={moreOpen} onOpenChange={setMoreOpen}>
          <div className="flex flex-wrap gap-2">
            <ExportButton rows={filtered} columns={exportColumns} entity="Projects" label={t('projects.export', 'Export')} />
            <ImportButton entity="project" descriptor={importDescriptor} onImported={() => void refetch()} label={t('projects.import', 'Import')} />
            <ImportButton entity="budgetLine" label={t('projects.importBudgets', 'Import budgets')} descriptor={budgetImportDescriptor} onImported={() => void refetch()} />
          </div>
        </MobileToolbarDisclosure>
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
          onChange={onViewChange}
          ariaLabel={t('projects.view.ariaLabel', 'Projects view')}
        />
      }
    >
      {/* Body */}
      {filter === 'at-risk' && all.length > 0 && moneyPending ? (
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
          cursor={calendarCursor}
          onCursorChange={onCalendarCursorChange}
          onOpenProject={(id) => {
            trackProjectDetailOpened('/projects/:projectId', 'card');
            openRecord(`/projects/${id}`);
          }}
        />
      ) : view === 'table' ? (
        <>
          {filtered.length > 0 && hiddenOptionalColumnCount > 0 && !optionalColumnsVisible && (
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOptionalColumnsVisible(true)}>
                {t('uxs14.showOptionalColumns', 'Show optional columns')}
              </Button>
            </div>
          )}
          {filtered.length > 0 && optionalColumnsVisible && hiddenOptionalColumnCount > 0 && (
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOptionalColumnsVisible(false)}>
                {t('uxs14.hideEmptyColumns', 'Hide empty columns')}
              </Button>
            </div>
          )}
          <div className="[&_th]:px-1.5 [&_td]:px-1.5">
          <DataTable<ProjectWithRefs>
            rows={filtered}
            columns={visibleColumns}
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
                    "No confirmed budget-risk signal is showing. Missing spending or Active budget data can't be assessed.",
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
          </div>
        </>
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
                  "No confirmed budget-risk signal is showing. Missing spending or Active budget data can't be assessed.",
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
              projectMoney={projectMoney?.[p.id]}
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
            ...pickClassification(editTarget),
            id: editTarget.id,
            name: editTarget.name,
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
