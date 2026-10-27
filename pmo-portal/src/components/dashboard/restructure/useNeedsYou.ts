import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { awaitingApprovalKey, expenseClaimsAwaitingKey } from '@/src/hooks/approvalsQueryKeys';
import { usePMDashboardProjects } from '@/src/hooks/useDashboard';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { getExecutiveDashboard, getFinanceBudgetReview, getPMDashboardProjects } from '@/src/lib/db/dashboard';
import { listTimesheetsAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { isActualComplete } from '@/src/lib/projectFinances';
import { ON_HAND_STATUSES, INTERNAL_STATUSES } from '@/src/lib/db/projectTransitions';
import { entriesByProject } from '@/src/lib/timesheet-derive';
import { repositories } from '@/src/lib/repositories';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

export type NeedsTone = 'warn' | 'neutral' | 'lost';

export interface NeedsItem {
  id: string;
  count: number;
  label: string;
  amount?: ReactNode;
  href: string;
  tone: NeedsTone;
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export interface OverdueInvoiceNeeds {
  count: number;
  knownTotals: CurrencyTotal[];
  unknownBalances: number;
  oldestDays: number | null;
}

export interface SupplierInvoiceNeeds {
  count: number;
  knownTotals: CurrencyTotal[];
}

export interface NeedsYouFacts {
  approvals?: number;
  atRiskProjects?: number;
  procurementsAwaitingApproval?: number;
  overdueInvoices?: OverdueInvoiceNeeds;
  supplierInvoices?: SupplierInvoiceNeeds;
  readyToBill?: number;
  budgetsOver?: number;
  projectsOverBudget?: number;
  overdueProjectTasks?: number;
  timesheetsToApprove?: number;
  timesheetStatus?: string | null;
  engineerTasks?: number;
  returnedExpenses?: number;
}

type Translate = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

const counted = (t: Translate, key: string, singular: string, plural: string, count: number) =>
  t(key, count === 1 ? singular : plural, { count });

const amountsText = (totals: CurrencyTotal[], t: Translate): string | undefined => {
  if (totals.length === 0) return undefined;
  return totals.map(({ currency, amount }) => moneyFigure(amount, currency, t('needs.amountUnavailable', 'Amount unavailable'), { code: true }).value).join(' · ');
};

/** Pure role adapter for the shared needs list; every zero count is intentionally omitted. */
export function buildNeedsItems(role: Role | null, facts: NeedsYouFacts, t: Translate): NeedsItem[] {
  const items: NeedsItem[] = [];
  const add = (item: NeedsItem | null) => { if (item && item.count > 0) items.push(item); };
  const approvalItem = (count: number | undefined): NeedsItem | null => count === undefined ? null : ({
    id: 'approvals', count, href: '/approvals', tone: 'warn',
    label: counted(t, 'needs.approvals', '{{count}} approval waiting for you', '{{count}} approvals waiting for you', count),
  });

  if (role === 'Executive' || role === 'Admin') {
    add(approvalItem(facts.approvals));
    if (facts.atRiskProjects !== undefined) add({
      id: 'at-risk', count: facts.atRiskProjects,
      label: counted(t, 'needs.atRisk', '{{count}} project at risk', '{{count}} projects at risk', facts.atRiskProjects),
      href: '/projects?filter=at-risk', tone: 'warn',
    });
    if (facts.procurementsAwaitingApproval !== undefined) add({
      id: 'procurement-approvals', count: facts.procurementsAwaitingApproval,
      label: counted(t, 'needs.procurementApproval', '{{count}} procurement awaiting approval', '{{count}} procurements awaiting approval', facts.procurementsAwaitingApproval),
      href: '/procurement?status=Requested', tone: 'warn',
    });
  }

  if (role === 'Finance') {
    const overdue = facts.overdueInvoices;
    if (overdue) {
      const base = counted(t, 'needs.overdueInvoice', '{{count}} client invoice overdue', '{{count}} client invoices overdue', overdue.count);
      const unknown = overdue.unknownBalances > 0
        ? ` · ${t('needs.unknownBalanceDays', '{{count}} balance unknown; {{days}} days overdue', { count: overdue.unknownBalances, days: overdue.oldestDays ?? '—' })}`
        : '';
      add({ id: 'overdue-invoices', count: overdue.count, label: base + unknown, amount: amountsText(overdue.knownTotals, t), href: '/sales-invoices?overdue=true', tone: 'lost' });
    }
    if (facts.supplierInvoices) add({
      id: 'supplier-invoices', count: facts.supplierInvoices.count,
      label: counted(t, 'needs.supplierInvoice', '{{count}} supplier invoice to pay', '{{count}} supplier invoices to pay', facts.supplierInvoices.count),
      amount: amountsText(facts.supplierInvoices.knownTotals, t), href: '/procurement?status=Vendor+Invoiced', tone: 'warn',
    });
    if (facts.readyToBill !== undefined) add({
      id: 'ready-to-bill', count: facts.readyToBill,
      label: counted(t, 'needs.readyToBill', '{{count}} work order still to invoice', '{{count}} work orders still to invoice', facts.readyToBill),
      href: '/projects', tone: 'neutral',
    });
    if (facts.budgetsOver !== undefined) add({
      id: 'budgets-over', count: facts.budgetsOver,
      label: counted(t, 'needs.budgetsOver', '{{count}} budget running over', '{{count}} budgets running over', facts.budgetsOver),
      href: '/projects', tone: 'lost',
    });
    add(approvalItem(facts.approvals));
  }

  if (role === 'Project Manager') {
    add(approvalItem(facts.approvals));
    if (facts.projectsOverBudget !== undefined) add({
      id: 'projects-over-budget', count: facts.projectsOverBudget,
      label: counted(t, 'needs.pmOverBudget', '{{count}} project over 90% of budget', '{{count}} projects over 90% of budget', facts.projectsOverBudget),
      href: '/projects?filter=My+Projects', tone: 'warn',
    });
    if (facts.overdueProjectTasks !== undefined) add({
      id: 'overdue-project-tasks', count: facts.overdueProjectTasks,
      label: counted(t, 'needs.pmTasks', '{{count}} overdue task on your projects', '{{count}} overdue tasks on your projects', facts.overdueProjectTasks),
      href: '/projects?filter=My+Projects', tone: 'lost',
    });
    if (facts.timesheetsToApprove !== undefined) add({
      id: 'team-timesheets', count: facts.timesheetsToApprove,
      label: counted(t, 'needs.pmTimesheets', '{{count}} team timesheet to approve', '{{count}} team timesheets to approve', facts.timesheetsToApprove),
      href: '/approvals?scope=timesheets', tone: 'warn',
    });
  }

  if (role === 'Engineer') {
    if (facts.timesheetStatus === 'Draft') add({
      id: 'timesheet-not-submitted', count: 1,
      label: t('needs.engineerTimesheetMissing', "This week's timesheet is not submitted"), href: '/timesheets', tone: 'warn',
    });
    if (facts.timesheetStatus === 'Rejected') add({
      id: 'timesheet-returned', count: 1,
      label: t('needs.engineerTimesheetReturned', "This week's timesheet was returned"), href: '/timesheets', tone: 'lost',
    });
    if (facts.engineerTasks !== undefined) add({
      id: 'engineer-tasks', count: facts.engineerTasks,
      label: counted(t, 'needs.engineerTasks', '{{count}} task overdue or due this week', '{{count}} tasks overdue or due this week', facts.engineerTasks),
      href: '/my-tasks', tone: 'warn',
    });
    if (facts.returnedExpenses !== undefined) add({
      id: 'returned-expenses', count: facts.returnedExpenses,
      label: counted(t, 'needs.returnedExpense', '{{count}} expense claim returned', '{{count}} expense claims returned', facts.returnedExpenses),
      href: '/expenses', tone: 'lost',
    });
  }

  return items;
}

function currentWeekStart(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const local = new Date(year, month - 1, date);
  const weekday = local.getDay();
  local.setDate(local.getDate() - weekday + (weekday === 0 ? -6 : 1));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function activeTask(status: string): boolean {
  return !['Done', 'Complete', 'Completed', 'Cancelled'].includes(status);
}

export function selectOverdueInvoices(rows: SalesInvoiceRow[] | undefined, organizationToday: string | null): OverdueInvoiceNeeds | undefined {
  if (!rows || !organizationToday) return undefined;
  const overdue = rows.filter((invoice) => {
    if (invoice.status !== 'Submitted' && invoice.status !== 'Unpaid') return false;
    const dueDate = deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date);
    const age = overdueAgeDays(dueDate, organizationToday);
    return age !== null && age > 0;
  });
  const totals = new Map<string, number>();
  let unknownBalances = 0;
  let oldestDays: number | null = null;
  for (const invoice of overdue) {
    const dueDate = deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date);
    const age = overdueAgeDays(dueDate, organizationToday);
    if (age !== null) oldestDays = Math.max(oldestDays ?? 0, age);
    const amount = invoice.erp_outstanding_amount;
    if (amount === null || !Number.isFinite(amount)) unknownBalances += 1;
    else totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + amount);
  }
  return { count: overdue.length, knownTotals: [...totals].map(([currency, amount]) => ({ currency, amount })), unknownBalances, oldestDays };
}

export function selectSupplierInvoices(rows: ProcurementWithRefs[] | undefined): SupplierInvoiceNeeds | undefined {
  if (!rows) return undefined;
  const invoiced = rows.filter((row) => row.status === 'Vendor Invoiced');
  const totals = new Map<string, number>();
  for (const row of invoiced) {
    if (Number.isFinite(row.total_value)) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.total_value);
  }
  return { count: invoiced.length, knownTotals: [...totals].map(([currency, amount]) => ({ currency, amount })) };
}

const isCompanyRole = (role: Role | null): boolean => role === 'Executive' || role === 'Admin' || role === 'Finance';

export interface NeedsYouResult {
  items: NeedsItem[];
  /** Role queues reused by layout C to place each exception beside its owning area. */
  areaItems: NeedsItem[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  /** Data reused by the role-specific project and time sections. */
  pmProjects: ReturnType<typeof usePMDashboardProjects>['data'];
  pmProjectsPending: boolean;
  pmProjectsError: boolean;
  pmProjectsRefetch: () => void;
  pmOverdueTasksByProject: Record<string, number>;
  engineerTimesheet: ReturnType<typeof useTimesheets>['data'] extends Array<infer T> | undefined ? T | null : null;
  engineerTimesheets: ReturnType<typeof useTimesheets>['data'];
  engineerTimesheetsPending: boolean;
  engineerTimesheetsError: boolean;
  engineerTimesheetsRefetch: () => void;
}

export function useNeedsYou(role: Role | null): NeedsYouResult {
  const { t } = useTranslation('dashboard');
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const companyRole = isCompanyRole(role);
  const approvalRole = can('transition', 'approval', { realRole });
  const procurementApprovalRole = can('transition', 'procurement', { realRole });
  const needsProcurements = procurementApprovalRole && role !== 'Engineer';
  const organizationDay = useFxOrgDay(true);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: getExecutiveDashboard,
    enabled: Boolean(orgId && companyRole),
  });
  const salesInvoiceQuery = useQuery({
    queryKey: ['salesInvoices', orgId, 'all'],
    queryFn: () => repositories.revenue.listInvoices(),
    enabled: Boolean(orgId && companyRole),
  });
  const procurementsQuery = useProcurements({ enabled: Boolean(orgId && (companyRole || role === 'Project Manager')) });
  const workOrdersQuery = useUnbilledWorkOrders(Boolean(orgId && companyRole));
  const budgetReviewQuery = useQuery({
    queryKey: ['finance-budget-review', orgId],
    queryFn: getFinanceBudgetReview,
    enabled: Boolean(orgId && role === 'Finance'),
  });
  const pmProjectsQuery = useQuery({
    queryKey: ['pm-dashboard-projects', orgId, userId],
    queryFn: getPMDashboardProjects,
    enabled: Boolean(orgId && userId && role === 'Project Manager'),
  });
  const projectTasks = useQueries({
    queries: (pmProjectsQuery.data ?? []).map((project) => ({
      queryKey: ['tasks', orgId, project.id],
      queryFn: () => repositories.task.list(project.id),
      enabled: Boolean(orgId && role === 'Project Manager'),
    })),
  });
  const timesheetsQuery = useTimesheets();
  const myTasksQuery = useMyTasks();
  const expenseClaimsQuery = useQuery({
    queryKey: ['expense-claims', orgId, { status: 'Rejected' }],
    queryFn: () => repositories.expenseClaim.list({ status: 'Rejected' }),
    enabled: Boolean(orgId && userId && role === 'Engineer'),
  });
  const timesheetsAwaitingQuery = useQuery({
    queryKey: awaitingApprovalKey(orgId, userId, realRole),
    queryFn: () => listTimesheetsAwaitingApproval(userId!, realRole!),
    enabled: Boolean(orgId && userId && approvalRole),
  });
  const expenseApprovalsQuery = useQuery({
    queryKey: expenseClaimsAwaitingKey(orgId),
    queryFn: async () => {
      const { rows } = await repositories.expenseClaim.list({ status: 'Submitted' });
      const routes = await repositories.expenseClaim.routes(rows.map((row) => row.id)).catch(() => []);
      const byId = new Map(routes.map((route) => [route.claimId, route]));
      return rows.map((claim) => ({ claim, route: byId.get(claim.id) ?? null }));
    },
    enabled: Boolean(orgId && procurementApprovalRole),
  });
  const invoiceApprovals = useInvoicesAwaitingViewer();

  const procApprovals = useMemo(
    () => pendingProcurementApprovals(procurementsQuery.data, userId, realRole === 'Admin'),
    [procurementsQuery.data, realRole, userId],
  );
  const expenseApprovals = useMemo(
    () => claimsAwaitingViewer(expenseApprovalsQuery.data ?? [], userId, realRole),
    [expenseApprovalsQuery.data, realRole, userId],
  );
  const approvalSourcesPending =
    (needsProcurements && procurementsQuery.isPending) ||
    (procurementApprovalRole && expenseApprovalsQuery.isPending) ||
    (approvalRole && timesheetsAwaitingQuery.isPending) ||
    (invoiceApprovals.isPending && (role === 'Admin' || role === 'Finance'));
  const approvalSourcesError =
    (needsProcurements && procurementsQuery.isError) ||
    (procurementApprovalRole && expenseApprovalsQuery.isError) ||
    (approvalRole && timesheetsAwaitingQuery.isError) ||
    (invoiceApprovals.isError && (role === 'Admin' || role === 'Finance'));
  const approvalsCount = approvalSourcesPending || approvalSourcesError ? undefined :
    (procurementApprovalRole ? procApprovals.length + expenseApprovals.length : 0) +
    (approvalRole ? timesheetsAwaitingQuery.data?.length ?? 0 : 0) +
    ((role === 'Admin' || role === 'Finance') ? invoiceApprovals.rows.length : 0);
  const approvalsWithoutTimesheets = approvalSourcesPending || approvalSourcesError ? undefined :
    (procurementApprovalRole ? procApprovals.length + expenseApprovals.length : 0) +
    ((role === 'Admin' || role === 'Finance') ? invoiceApprovals.rows.length : 0);

  const invoiceNeeds = useMemo(
    () => selectOverdueInvoices(salesInvoiceQuery.data, organizationDay.day),
    [organizationDay.day, salesInvoiceQuery.data],
  );
  const supplierNeeds = useMemo(() => selectSupplierInvoices(procurementsQuery.data), [procurementsQuery.data]);

  const pmDeliveryProjects = useMemo(() => (pmProjectsQuery.data ?? []).filter((project) =>
    ON_HAND_STATUSES.includes(project.status) || INTERNAL_STATUSES.includes(project.status as never),
  ), [pmProjectsQuery.data]);
  const pmAtRiskCount = useMemo(() => pmDeliveryProjects.filter((project) => isMoneyAtRisk({
    status: project.status, budget: project.budget, budgetCurrency: project.budget_currency ?? project.currency,
    projectCurrency: project.currency, spent: project.spent, actualCurrency: project.actual_currency ?? project.currency,
    actualComplete: isActualComplete({ basis: 'erp', readSucceeded: project.spent !== null, complete: project.actual_complete,
      coverageCount: project.actual_coverage_count, coverageTotal: project.actual_coverage_total }),
  })).length, [pmDeliveryProjects]);
  const pmOverdueTaskCount = useMemo(() => projectTasks.flatMap((query) => query.data ?? []).filter((task) =>
    activeTask(task.status) && task.end_date !== null && organizationDay.day !== null && task.end_date < organizationDay.day,
  ).length, [organizationDay.day, projectTasks]);

  const currentWeek = organizationDay.day ? currentWeekStart(organizationDay.day) : null;
  const currentTimesheet = (timesheetsQuery.data ?? []).find((sheet) => sheet.week_start_date === currentWeek) ?? null;
  const weekEnd = currentWeek ? (() => {
    const date = new Date(`${currentWeek}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  })() : null;
  const engineerTasksCount = useMemo(() => (myTasksQuery.data ?? []).filter((task) =>
    activeTask(task.status) && task.end_date !== null && weekEnd !== null && task.end_date <= weekEnd,
  ).length, [myTasksQuery.data, weekEnd]);
  const currentReturnedExpenses = useMemo(() => (expenseClaimsQuery.data?.rows ?? []).filter((row) =>
    row.claimant_id === userId && row.status === 'Rejected',
  ), [expenseClaimsQuery.data?.rows, userId]);
  const facts: NeedsYouFacts = {
    approvals: role === 'Project Manager' ? approvalsWithoutTimesheets : approvalsCount,
    atRiskProjects: companyRole ? dashboardQuery.data?.projects_at_risk : undefined,
    procurementsAwaitingApproval: procurementApprovalRole ? procApprovals.length : undefined,
    overdueInvoices: companyRole ? invoiceNeeds : undefined,
    supplierInvoices: companyRole ? supplierNeeds : undefined,
    readyToBill: role === 'Finance' ? workOrdersQuery.data && workOrdersQuery.data.totals.reduce((sum, row) => sum + row.count, 0) + workOrdersQuery.data.incompleteCount : undefined,
    budgetsOver: role === 'Finance' ? budgetReviewQuery.data?.filter((row) => row.variance !== null && row.variance > 0).length : undefined,
    projectsOverBudget: role === 'Project Manager' && pmProjectsQuery.data ? pmAtRiskCount : undefined,
    overdueProjectTasks: role === 'Project Manager' && !projectTasks.some((query) => query.isPending || query.isError) ? pmOverdueTaskCount : undefined,
    timesheetsToApprove: role === 'Project Manager' && !timesheetsAwaitingQuery.isPending && !timesheetsAwaitingQuery.isError ? timesheetsAwaitingQuery.data?.length ?? 0 : undefined,
    timesheetStatus: currentTimesheet?.status ?? (currentWeek && !timesheetsQuery.isPending && !timesheetsQuery.isError ? 'Draft' : null),
    engineerTasks: role === 'Engineer' && !myTasksQuery.isPending && !myTasksQuery.isError && currentWeek ? engineerTasksCount : undefined,
    returnedExpenses: role === 'Engineer' && !expenseClaimsQuery.isPending && !expenseClaimsQuery.isError ? currentReturnedExpenses.length : undefined,
  };

  const needsPending = companyRole
    ? dashboardQuery.isPending || salesInvoiceQuery.isPending || (procurementApprovalRole && procurementsQuery.isPending) || workOrdersQuery.isPending || organizationDay.isPending || (role === 'Finance' && budgetReviewQuery.isPending) || approvalSourcesPending || (role === 'Finance' && !invoiceNeeds && !salesInvoiceQuery.isError && !organizationDay.isError)
    : role === 'Project Manager'
      ? pmProjectsQuery.isPending || projectTasks.some((query) => query.isPending) || organizationDay.isPending || approvalSourcesPending
      : role === 'Engineer'
        ? timesheetsQuery.isPending || myTasksQuery.isPending || expenseClaimsQuery.isPending || organizationDay.isPending
        : false;
  const needsError = companyRole
    ? dashboardQuery.isError || salesInvoiceQuery.isError || (procurementApprovalRole && procurementsQuery.isError) || workOrdersQuery.isError || organizationDay.isError || (role === 'Finance' && budgetReviewQuery.isError) || approvalSourcesError
    : role === 'Project Manager'
      ? pmProjectsQuery.isError || projectTasks.some((query) => query.isError) || organizationDay.isError || approvalSourcesError
      : role === 'Engineer'
        ? timesheetsQuery.isError || myTasksQuery.isError || expenseClaimsQuery.isError || organizationDay.isError
        : false;
  const pmSourcesPending = pmProjectsQuery.isPending || projectTasks.some((query) => query.isPending);
  const pmSourcesError = pmProjectsQuery.isError || projectTasks.some((query) => query.isError);
  const engineerSourcesPending = timesheetsQuery.isPending;
  const engineerSourcesError = timesheetsQuery.isError;
  const translate = (key: string, fallback: string, options?: Record<string, unknown>) => t(key, { defaultValue: fallback, ...(options ?? {}) });
  const items = buildNeedsItems(role, facts, translate);
  const companyAreaItems = companyRole
    ? [...buildNeedsItems('Executive', facts, translate), ...buildNeedsItems('Finance', facts, translate)]
      .filter((item) => ['at-risk', 'procurement-approvals', 'overdue-invoices', 'supplier-invoices', 'budgets-over'].includes(item.id))
    : [];
  const areaItems = [...items, ...companyAreaItems.filter((item) => !items.some((existing) => existing.id === item.id))];
  const pmOverdueTasksByProject = Object.fromEntries((pmProjectsQuery.data ?? []).map((project, index) => [
    project.id,
    (projectTasks[index]?.data ?? []).filter((task) => activeTask(task.status) && task.end_date !== null && organizationDay.day !== null && task.end_date < organizationDay.day).length,
  ]));
  const refetch = () => {
    void dashboardQuery.refetch();
    void salesInvoiceQuery.refetch();
    void procurementsQuery.refetch();
    void workOrdersQuery.refetch();
    void budgetReviewQuery.refetch();
    void pmProjectsQuery.refetch();
    void Promise.all(projectTasks.map((query) => query.refetch()));
    void timesheetsQuery.refetch();
    void myTasksQuery.refetch();
    void expenseClaimsQuery.refetch();
    void timesheetsAwaitingQuery.refetch();
    void expenseApprovalsQuery.refetch();
    void invoiceApprovals.refetch();
    organizationDay.retry();
  };

  return {
    items,
    areaItems,
    isPending: needsPending,
    isError: needsError,
    refetch,
    pmProjects: pmProjectsQuery.data,
    pmProjectsPending: pmProjectsQuery.isPending,
    pmProjectsError: pmProjectsQuery.isError,
    pmProjectsRefetch: () => { void pmProjectsQuery.refetch(); },
    pmOverdueTasksByProject,
    engineerTimesheet: currentTimesheet,
    engineerTimesheets: timesheetsQuery.data,
    engineerTimesheetsPending: engineerSourcesPending,
    engineerTimesheetsError: engineerSourcesError,
    engineerTimesheetsRefetch: () => { void timesheetsQuery.refetch(); },
  };
}
