import React, { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import type { Role } from '@/src/auth/AuthContext';
import { useProjects, useClientCompanies, useProjectManagers, useProjectsMilestoneDates } from '@/src/hooks/useProjects';
import { useCompanies } from '@/src/hooks/useCompanies';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useProjectsDeliverySummary } from '@/src/hooks/useProjectsDelivery';
import { useProjectsMoneyCollection } from '@/src/hooks/useProjectsMoneyCollection';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { readProjectView, writeProjectView, type ProjectView } from '@/src/hooks/useProjectView';
import { currentMonthToken, parseListWorkingSet } from '@/src/lib/listWorkingSet';
import type { MonthCursor } from '@/src/lib/calendar/monthMatrix';
import { activeClassificationCount, matchesProjectClassification } from '@/src/lib/projectClassification';
import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { makeProjectImportDescriptor, makeBudgetImportDescriptor } from '@/src/lib/import';
import { isActualComplete } from '@/src/lib/projectFinances';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { projectManagerLabel, UNASSIGNED_PROJECT_MANAGER } from '@/src/lib/projects/projectManagerLabel';
import { ProjectStatus as ProjectStatusEnum } from '../../types';

export type StatusFilter = 'All' | 'My Projects' | 'Ongoing' | 'Completed' | 'at-risk';
const ONGOING = [ProjectStatusEnum.Ongoing, ProjectStatusEnum.WonPendingKoM, ProjectStatusEnum.OnHold] as string[];
const COMPLETED = [ProjectStatusEnum.CloseOut, ProjectStatusEnum.Loss] as string[];

export function useProjectListModel(effectiveRole: Role | null, currentUser: { id: string } | null, t: TFunction) {
  const isEngineer = effectiveRole === 'Engineer';
  // B-11 fix: an IC's "My Projects" means projects they are ASSIGNED to (have a task on),
  // NOT projects they manage (an Engineer manages none → the old PM-scoped filter was always
  // empty, so the Engineer default landed on a blank list). Derive the assigned-project set
  // from the Engineer's own tasks (the same cross-project, RLS-org-scoped read My Tasks uses;
  // cached under the shared 'my-tasks' key). Only consumed for the Engineer branch.
  const { data: myTasks, isPending: tasksPending, isError: tasksError, refetch: refetchTasks } = useMyTasks();
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
          (p.short_name ?? '').toLowerCase().includes(q) ||
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
  const { data: milestoneDates, isPending: datesPending, isError: datesError, refetch: refetchDates } = useProjectsMilestoneDates(
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
    setClassificationResetToken((n) => n + 1);
    setWorkingSet(() =>
      parseListWorkingSet('projects', '', {
        projectsDefaultFilter: roleDefault,
        sessionView: readProjectView(),
      }),
    );
  };

  return { isEngineer, tasksPending, tasksError, refetchTasks, data, isPending, isError, refetch,
    clientCompaniesResult, companiesResult, projectManagersResult, workingSet, setWorkingSet, search, setSearch,
    filter, filterClient, filterEndCustomer, filterPM, view, onViewChange, calendarCursor, onCalendarCursorChange,
    all, filtered, deliverySummary, deliveryPending, deliveryError, projectMoney, moneyPending, moneyError, refetchMoney,
    isAtRiskActual, milestoneDates, datesPending, datesError, refetchDates, filterLabels, customerFilterOptions,
    endCustomerFilterOptions, pmFilterOptions, importDescriptor, budgetImportDescriptor, classificationResetToken,
    classificationCount, filtersActive, hasNonDefaultFilter, clearFilters };
}
