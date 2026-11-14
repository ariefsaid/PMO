import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMilestones } from '@/src/hooks/useMilestones';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { formatNumberWhole } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useBudgetVersions } from '@/src/hooks/useBudget';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useTasks } from '@/src/hooks/useTasks';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';
import { budgetLinesByCategory } from '@/src/lib/budget/budgetModel';
import { useProjectBudgetPositions } from '@/src/hooks/useProjectBudgetPositions';
import { projectBudgetUsedPercent } from '@/src/lib/projectFinances';

export interface CategoryPosition { category: string; budget: number; actual: number | null }

/**
 * Category positions remain category-scoped; project totals and risk come from S03's canonical position even when
 * one or more category allocations are unknown.
 */
export function useBudgetPosition(project: ProjectWithRefs, enabled = true, options?: { refetchOnMount?: boolean }) {
  const may = usePermission();
  const canSeeActual = enabled && may('view', 'salesInvoice');
  const versions = useBudgetVersions(enabled ? project.id : '');
  const finances = useProjectFinances(project.id, { enabled: enabled && canSeeActual });
  const budgetPositions = useProjectBudgetPositions(enabled && canSeeActual ? [project.id] : [], options);
  const budgetPosition = budgetPositions.data?.[project.id];
  const budgetPositionsPending = budgetPositions.isPending;
  const budgetPositionsError = budgetPositions.isError;
  const refetchBudgetPositions = budgetPositions.refetch;
  const financesPending = finances.isPending;
  const financesError = finances.isError;
  const refetchFinances = finances.refetch;
  const actuals = canSeeActual ? finances.data?.actuals : undefined;
  return useMemo(() => {
    const active = (versions.data ?? []).find((v) => v.status === 'Active');
    // #1459: the same category rollup the Budget tab totals, so the Overview and the tab cannot drift.
    const budgets = new Map(budgetLinesByCategory(active?.line_items ?? []).map(({ category, budget }) => [category, budget] as const));
    for (const category of actuals?.categories ?? []) {
      if (!budgets.has(category.category) && category.mapped && category.amount !== null && Number(category.amount) !== 0) {
        budgets.set(category.category, 0);
      }
    }
    // #2066: the finances read names the currency its figures are really in (the Odoo company's on that ledger).
    // `rows` compare a figure only in the project currency; `spendRows` carry it in its own currency for the Budget tab.
    const spendCurrency = actuals?.currency ?? null;
    const same = spendCurrency === project.currency;
    const spendRows = [...budgets.keys()].map((category) => {
      const a = actuals?.categories.find((c) => c.category === category);
      return { category, actual: a?.mapped && a.amount !== null ? Number(a.amount) : null };
    });
    const rows: CategoryPosition[] = [...budgets.entries()].map(([category, budget], i) => ({ category, budget, actual: same ? spendRows[i].actual : null }));
    const budget = budgetPosition?.activeBudgetAmount != null && budgetPosition.budgetCurrency === project.currency
      ? Number(budgetPosition.activeBudgetAmount)
      : rows.reduce((sum, row) => sum + row.budget, 0);
    const comparableBudget = budgetPosition?.activeBudgetAmount != null
      && budgetPosition.budgetCurrency === project.currency
      && budgetPosition.currency === project.currency;
    const spent = canSeeActual && budgetPosition?.spent != null && budgetPosition.currency === project.currency
      ? Number(budgetPosition.spent)
      : null;
    const overRows = rows.filter((r) => r.actual !== null && r.actual > r.budget)
      .sort((a, b) => (b.actual! - b.budget) - (a.actual! - a.budget));
    return {
      isPending: versions.isPending, isError: versions.isError, refetch: versions.refetch,
      actualsPending: canSeeActual && financesPending,
      actualsError: canSeeActual && financesError,
      budgetPositionPending: canSeeActual && budgetPositionsPending,
      budgetPositionError: canSeeActual && budgetPositionsError,
      refetchActuals: () => Promise.all([refetchFinances(), refetchBudgetPositions()]),
      hasBudget: Boolean(active), canSeeActual, rows, budget, spent,
      ledgerBasis: budgetPosition?.ledgerBasis ?? null,
      spendRows, spendCurrency,
      // Spending is read but in another currency than the project's: stated as such, never as "not linked" or compared.
      currencyDiffers: spendCurrency !== null && !same && spendRows.some((r) => r.actual !== null),
      budgetAvailable: budgetPosition?.activeBudgetAmount != null && budgetPosition.budgetCurrency === project.currency,
      budgetComparisonKnown: comparableBudget && spent !== null,
      projectOver: comparableBudget && spent !== null && spent > budget ? spent - budget : null,
      consumption: budgetPosition?.consumption ?? null,
      consumptionVariance: budgetPosition?.consumptionVariance ?? null,
      openCommitment: budgetPosition?.openCommitment ?? null,
      usedPercent: projectBudgetUsedPercent(budgetPosition, project.currency),
      atRisk: budgetPosition?.currency === project.currency
        && budgetPosition.budgetCurrency === project.currency
        && budgetPosition.atRisk === true,
      overRows,
      unknown: rows.filter((r) => r.actual === null).length,
    };
  }, [versions.data, versions.isPending, versions.isError, versions.refetch, actuals, financesPending, financesError, refetchFinances,
    budgetPosition, budgetPositionsPending, budgetPositionsError, refetchBudgetPositions, project.currency, canSeeActual]);
}

/** Overdue customer invoices: count, oldest age, and the unpaid balance only when every balance is known. */
export function useOverdueReceivables(project: ProjectWithRefs, enabled = true) {
  const may = usePermission();
  const canSeeInvoices = enabled && may('view', 'salesInvoice');
  const invoices = useSalesInvoices(project.id, { enabled: canSeeInvoices });
  const orgTodayQuery = useFxOrgDay(canSeeInvoices);
  const orgToday = orgTodayQuery.day;
  const isPending = canSeeInvoices && (invoices.isPending || orgTodayQuery.isPending);
  const isError = canSeeInvoices && (invoices.isError || orgTodayQuery.isError);
  const data = useMemo(() => {
    if (!canSeeInvoices || isPending || isError) return null;
    // #1457: the one shared overdue rule decides and supplies each age.
    const overdue = (invoices.data ?? [])
      .map((inv) => ({ inv, age: clientInvoiceOverdueDays(inv, orgToday) }))
      .filter((x): x is { inv: typeof x.inv; age: number } => x.age !== null);
    if (!overdue.length) return null;
    const balanceKnown = overdue.every((x) => x.inv.erp_outstanding_amount !== null);
    return {
      count: overdue.length,
      oldest: Math.max(...overdue.map((x) => x.age)),
      balance: balanceKnown ? overdue.reduce((sum, x) => sum + Number(x.inv.erp_outstanding_amount ?? 0), 0) : null,
      // The org-wide invoice list already filters by project + overdue (oldest first): the chase surface.
      to: `/finance/receivables?project=${project.id}&overdue=true`,
    };
  }, [canSeeInvoices, isPending, isError, invoices.data, orgToday, project.id]);
  const refetch = () => Promise.all([
    ...(canSeeInvoices && invoices.isError ? [invoices.refetch()] : []),
    ...(canSeeInvoices && orgTodayQuery.isError ? [orgTodayQuery.retry()] : []),
  ]);
  return { data, isPending, isError, refetch };
}

export interface AttentionItem {
  key: string;
  tone: 'danger' | 'warn';
  /** What is wrong, in a few words — carries the status word (late, overdue, over). */
  what: string;
  /** How big — only when the block below doesn't already show it (no figure twice). */
  size?: string;
  /** Calculation and source for any status/count/amount shown in the row. */
  explanation?: string;
  /** The verb that fixes it. */
  action: string;
  to: string;
}

const lateDays = (target: string, today: string) => Math.max(1, Math.floor((Date.parse(today) - Date.parse(target)) / 86_400_000));

/**
 * Exceptions that need a person, from signals the page already shows. Not used for `delivery`
 * (engineer): their overdue count heads My open tasks instead.
 */
export function useProjectAttention(project: ProjectWithRefs, lens: 'money' | 'pm' | 'delivery'): {
  items: AttentionItem[];
  myVisibleTaskKeys: ReadonlySet<string>;
  isPending: boolean;
  error?: { what: string; retry: () => unknown };
} {
  const { t } = useTranslation('project');
  const may = usePermission();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const base = `/projects/${project.id}`;
  const milestones = useMilestones(project.id);
  const tasks = useTasks(project.id);
  const organizationDay = useFxOrgDay(true);
  const budget = useBudgetPosition(project, lens !== 'delivery');
  const receivables = useOverdueReceivables(project, lens !== 'delivery');
  const canApprove = lens !== 'delivery' && may('transition', 'procurement');
  const procurements = useProjectProcurements(canApprove ? project.id : null);
  const isPending = organizationDay.isPending || milestones.isPending || (lens === 'delivery' && tasks.isPending) || (lens !== 'delivery' && (
    budget.isPending || budget.actualsPending || budget.budgetPositionPending || receivables.isPending || (canApprove && procurements.isPending)
  ));
  const failedRead = organizationDay.isError ? 'today'
    : milestones.isError ? 'phases'
    : lens === 'delivery' && tasks.isError ? 'tasks'
    : lens !== 'delivery' && budget.isError ? 'budget'
      : lens !== 'delivery' && (budget.actualsError || budget.budgetPositionError) ? 'spending'
        : lens !== 'delivery' && receivables.isError ? 'receivables'
          : canApprove && procurements.isError ? 'procurements'
            : null;
  const error = failedRead ? {
    what: failedRead === 'today' ? t('projectDetail.attention.check.today', 'organization day')
      : failedRead === 'phases' ? t('projectDetail.attention.check.phases', 'phases')
      : failedRead === 'tasks' ? t('projectDetail.attention.check.tasks', 'tasks')
      : failedRead === 'budget' ? t('projectDetail.attention.check.budget', 'budget')
        : failedRead === 'spending' ? t('projectDetail.attention.check.spending', 'spending')
          : failedRead === 'receivables' ? t('projectDetail.attention.check.receivables', 'receivables')
            : t('projectDetail.attention.check.procurements', 'procurements'),
    retry: () => Promise.all([
      ...(organizationDay.isError ? [organizationDay.retry()] : []),
      ...(milestones.isError ? [milestones.refetch()] : []),
      ...(lens === 'delivery' && tasks.isError ? [tasks.refetch()] : []),
      ...(budget.isError ? [budget.refetch()] : []),
      ...(budget.actualsError || budget.budgetPositionError ? [budget.refetchActuals()] : []),
      ...(receivables.isError ? [receivables.refetch()] : []),
      ...(canApprove && procurements.isError ? [procurements.refetch()] : []),
    ]),
  } : undefined;

  const myVisibleTaskKeys = useMemo(() => new Set((tasks.data ?? [])
    .filter((task) => task.assignee_id === currentUser?.id && task.status !== 'Done')
    .sort((a, b) => (a.end_date ?? '9999').localeCompare(b.end_date ?? '9999'))
    .slice(0, 6)
    .map((task) => `task-${task.id}`)), [tasks.data, currentUser?.id]);
  const items = useMemo(() => {
    const out: AttentionItem[] = [];
    const today = organizationDay.day ?? '';
    if (lens === 'delivery') {
      const mine = (tasks.data ?? []).filter((task) => task.assignee_id === currentUser?.id && task.status !== 'Done');
      for (const task of mine) {
        const blocked = task.status === 'Blocked';
        const overdue = Boolean(task.end_date && task.end_date < today);
        if (!blocked && !overdue) continue;
        const days = task.end_date && overdue
          ? Math.max(1, Math.floor((Date.parse(today) - Date.parse(task.end_date)) / 86_400_000))
          : null;
        out.push({
          key: `task-${task.id}`,
          tone: blocked ? 'danger' : 'warn',
          to: `${base}/tasks?open=${encodeURIComponent(task.id)}`,
          what: blocked
            ? t('projectDetail.attention.taskBlocked', '{{name}} is blocked', { name: task.name })
            : t('projectDetail.attention.taskOverdue', '{{name}} is overdue', { name: task.name }),
          size: blocked && overdue
            ? t('projectDetail.attention.taskBlockedOverdue', 'Blocked · {{days}} days overdue', { days })
            : blocked
              ? t('projectDetail.attention.taskBlockedSize', 'Blocked')
              : t('projectDetail.attention.taskOverdueSize', '{{days}} days overdue', { days }),
          explanation: t('projectDetail.attention.taskTooltip', 'Status and due date come from this task record.'),
          action: t('projectDetail.attention.taskAction', 'Open task'),
        });
      }
      return out.sort((left, right) => (left.tone === right.tone ? 0 : left.tone === 'danger' ? -1 : 1));
    }
    if (budget.overRows.length) {
      const worst = budget.overRows[0];
      out.push({ key: 'budget', tone: 'danger', to: `${base}/budget`,
        what: budget.projectOver !== null
          ? t('projectDetail.attention.projectOver', 'Project over on spending')
          : t('projectDetail.attention.categoryOver', '{{category}} over on spending', { category: budgetCategoryLabel(worst.category, t) }),
        // The amount is the cost block's headline; here only where it comes from.
        size: budget.projectOver !== null
          ? t('projectDetail.attention.projectOverSize', '{{amount}} {{currency}} over', { amount: formatNumberWhole(budget.projectOver), currency: project.currency })
          : t('projectDetail.attention.categoryOverSize', '{{amount}} {{currency}} over', { amount: formatNumberWhole(worst.actual! - worst.budget), currency: project.currency }),
        explanation: t('projectDetail.attention.budgetTooltip', 'Compared mapped spending with the active budget before tax; see Budget for category detail.'),
        action: t('projectDetail.attention.budgetAction', 'Review budget') });
    }
    if (receivables.data) {
      out.push({ key: 'ar', tone: 'danger', to: receivables.data.to,
        what: receivables.data.count === 1 ? t('projectDetail.attention.arWhatOne', 'Customer invoice overdue') : t('projectDetail.attention.arWhatMany', '{{count}} customer invoices overdue', { count: receivables.data.count }),
        // Only a known balance is a figure; an unsynced balance shows age only, never the invoice total.
        size: receivables.data.balance !== null
          ? t('projectDetail.attention.arSize', '{{amount}} {{currency}} unpaid · {{days}} days', { amount: formatNumberWhole(receivables.data.balance), currency: project.currency, days: receivables.data.oldest })
          : t('projectDetail.attention.arSizeNoBalance', '{{days}} days past due', { days: receivables.data.oldest }),
        explanation: t('projectDetail.attention.arTooltip', 'Invoice status, due date, and any known unpaid balance come from project invoices and accounting sync.'),
        action: receivables.data.count === 1 ? t('projectDetail.attention.arActionOne', 'See invoice') : t('projectDetail.attention.arActionMany', 'See invoices') });
    }
    const late = (milestones.data ?? []).filter((m) => m.target_date && m.target_date < today && m.effective_pct < 100 && (m.effective_pct > 0 || m.task_count > 0));
    if (late.length) {
      const worst = late.reduce((w, m) => (m.target_date! < w.target_date! ? m : w));
      // N16: late reads red here as it does on the phase rows and Tasks — one lateness colour.
      out.push({ key: 'phases', tone: 'danger', to: `${base}/tasks`,
        what: late.length === 1
          ? t('projectDetail.attention.phaseWhat', '{{name}} is late', { name: worst.name })
          : t('projectDetail.attention.phasesWhat', '{{count}} phases late', { count: late.length }),
        size: t('projectDetail.attention.phaseSize', '{{days}} days late', { days: lateDays(worst.target_date!, today) }),
        action: t('projectDetail.attention.phaseAction', 'See tasks'),
        explanation: t('projectDetail.attention.phaseTooltip', 'Phase target dates and completion come from the project phase plan.') });
    }
    if (canApprove) {
      const waiting = pendingProcurementApprovals(procurements.data, currentUser?.id, realRole === 'Admin');
      if (waiting.length) {
        out.push({ key: 'approve', tone: 'warn', to: `${base}/procurement`,
          what: waiting.length === 1
            ? t('projectDetail.attention.approveOne', 'Procurement waiting for your approval')
            : t('projectDetail.attention.approveMany', '{{count}} procurements waiting for your approval', { count: waiting.length }),
          size: t('projectDetail.attention.approveSize', '{{count}} procurements', { count: waiting.length }),
          action: t('projectDetail.attention.approveAction', 'Review'),
          explanation: t('projectDetail.attention.approveTooltip', 'Counts project procurements that are waiting for your approval.') });
      }
    }
    return out.sort((x, y) => (x.tone === y.tone ? 0 : x.tone === 'danger' ? -1 : 1));
  }, [lens, organizationDay.day, tasks.data, budget.overRows, budget.projectOver, receivables.data, milestones.data, procurements.data, canApprove, currentUser?.id, realRole, base, project.currency, t]);

  return { items, myVisibleTaskKeys, isPending, error };
}

