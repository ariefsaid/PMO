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
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';

export interface CategoryPosition { category: string; budget: number; actual: number | null }

/**
 * Budget vs actual per Active-budget category, shared by the cost block and "Needs attention" so the
 * two can never disagree. `spent`/`over` are project-level only when every category is known.
 */
export function useBudgetPosition(project: ProjectWithRefs, enabled = true) {
  const may = usePermission();
  const canSeeActual = enabled && may('view', 'salesInvoice');
  const versions = useBudgetVersions(enabled ? project.id : '');
  const finances = useProjectFinances(project.id, { enabled: enabled && canSeeActual });
  const actuals = canSeeActual ? finances.data?.actuals : undefined;
  return useMemo(() => {
    const active = (versions.data ?? []).find((v) => v.status === 'Active');
    const budgets = new Map<string, number>();
    for (const li of active?.line_items ?? []) {
      const cat = li.category ?? 'Other';
      budgets.set(cat, (budgets.get(cat) ?? 0) + (Number(li.budgeted_amount) || 0));
    }
    const same = actuals?.currency === project.currency;
    const rows: CategoryPosition[] = [...budgets.entries()].map(([category, budget]) => {
      const a = actuals?.categories.find((c) => c.category === category);
      return { category, budget, actual: same && a?.mapped && a.amount !== null ? Number(a.amount) : null };
    });
    const budget = rows.reduce((s, r) => s + r.budget, 0);
    const allKnown = canSeeActual && rows.length > 0 && rows.every((r) => r.actual !== null);
    const spent = allKnown ? rows.reduce((s, r) => s + (r.actual ?? 0), 0) : null;
    const overRows = rows.filter((r) => r.actual !== null && r.actual > r.budget)
      .sort((a, b) => (b.actual! - b.budget) - (a.actual! - a.budget));
    return {
      isPending: versions.isPending, isError: versions.isError, refetch: versions.refetch,
      actualsPending: canSeeActual && finances.isPending,
      actualsError: canSeeActual && finances.isError,
      refetchActuals: finances.refetch,
      hasBudget: Boolean(active), canSeeActual, rows, budget, spent,
      projectOver: spent !== null && spent > budget ? spent - budget : null,
      overRows,
      unknown: rows.filter((r) => r.actual === null).length,
    };
  }, [versions.data, versions.isPending, versions.isError, versions.refetch, actuals, finances.isPending, finances.isError, finances.refetch, project.currency, canSeeActual]);
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
    const overdue = (invoices.data ?? []).filter((inv) => inv.status === 'Submitted' || inv.status === 'Unpaid')
      .map((inv) => ({ inv, age: overdueAgeDays(deriveArDueDate(inv.invoice_date, inv.erp_payment_terms_days, inv.erp_due_date, inv.received_date), orgToday) }))
      .filter((x): x is { inv: typeof x.inv; age: number } => x.age !== null && x.age > 0);
    if (!overdue.length) return null;
    const balanceKnown = overdue.every((x) => x.inv.erp_outstanding_amount !== null);
    return {
      count: overdue.length,
      oldest: Math.max(...overdue.map((x) => x.age)),
      balance: balanceKnown ? overdue.reduce((sum, x) => sum + Number(x.inv.erp_outstanding_amount ?? 0), 0) : null,
      // The org-wide invoice list already filters by project + overdue (oldest first): the chase surface.
      to: `/sales-invoices?project=${project.id}&overdue=true`,
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

const attnToday = () => new Date().toISOString().slice(0, 10);
const lateDays = (target: string) => Math.max(1, Math.floor((Date.parse(attnToday()) - Date.parse(target)) / 86_400_000));

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
  const budget = useBudgetPosition(project, lens !== 'delivery');
  const receivables = useOverdueReceivables(project, lens !== 'delivery');
  const canApprove = lens !== 'delivery' && may('transition', 'procurement');
  const procurements = useProjectProcurements(canApprove ? project.id : null);
  const isPending = milestones.isPending || (lens === 'delivery' && tasks.isPending) || (lens !== 'delivery' && (
    budget.isPending || budget.actualsPending || receivables.isPending || (canApprove && procurements.isPending)
  ));
  const failedRead = milestones.isError ? 'phases'
    : lens === 'delivery' && tasks.isError ? 'tasks'
    : lens !== 'delivery' && budget.isError ? 'budget'
      : lens !== 'delivery' && budget.actualsError ? 'spending'
        : lens !== 'delivery' && receivables.isError ? 'receivables'
          : canApprove && procurements.isError ? 'procurements'
            : null;
  const error = failedRead ? {
    what: failedRead === 'phases' ? t('projectDetail.attention.check.phases', 'phases')
      : failedRead === 'tasks' ? t('projectDetail.attention.check.tasks', 'tasks')
      : failedRead === 'budget' ? t('projectDetail.attention.check.budget', 'budget')
        : failedRead === 'spending' ? t('projectDetail.attention.check.spending', 'spending')
          : failedRead === 'receivables' ? t('projectDetail.attention.check.receivables', 'receivables')
            : t('projectDetail.attention.check.procurements', 'procurements'),
    retry: () => Promise.all([
      ...(milestones.isError ? [milestones.refetch()] : []),
      ...(lens === 'delivery' && tasks.isError ? [tasks.refetch()] : []),
      ...(budget.isError ? [budget.refetch()] : []),
      ...(budget.actualsError ? [budget.refetchActuals()] : []),
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
    if (lens === 'delivery') {
      const today = attnToday();
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
          ? t('projectDetail.attention.projectOver', 'Project over budget')
          : t('projectDetail.attention.categoryOver', '{{category}} over budget', { category: budgetCategoryLabel(worst.category, t) }),
        // The amount is the cost block's headline; here only where it comes from.
        size: budget.projectOver !== null
          ? t('projectDetail.attention.projectOverSize', '{{amount}} {{currency}} over', { amount: formatNumberWhole(budget.projectOver), currency: project.currency })
          : t('projectDetail.attention.categoryOverSize', '{{amount}} {{currency}} over', { amount: formatNumberWhole(worst.actual! - worst.budget), currency: project.currency }),
        explanation: t('projectDetail.attention.budgetTooltip', 'Compared mapped actual spending with the active budget; see Budget for category detail.'),
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
    const late = (milestones.data ?? []).filter((m) => m.target_date && m.target_date < attnToday() && m.effective_pct < 100 && (m.effective_pct > 0 || m.task_count > 0));
    if (late.length) {
      const worst = late.reduce((w, m) => (m.target_date! < w.target_date! ? m : w));
      out.push({ key: 'phases', tone: 'warn', to: `${base}/tasks`,
        what: late.length === 1
          ? t('projectDetail.attention.phaseWhat', '{{name}} is late', { name: worst.name })
          : t('projectDetail.attention.phasesWhat', '{{count}} phases late', { count: late.length }),
        size: t('projectDetail.attention.phaseSize', '{{days}} days late', { days: lateDays(worst.target_date!) }),
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
          size: t('projectDetail.attention.approveSize', '{{count}} requests', { count: waiting.length }),
          action: t('projectDetail.attention.approveAction', 'Review'),
          explanation: t('projectDetail.attention.approveTooltip', 'Counts project procurements that are waiting for your approval.') });
      }
    }
    return out.sort((x, y) => (x.tone === y.tone ? 0 : x.tone === 'danger' ? -1 : 1));
  }, [lens, tasks.data, budget.overRows, budget.projectOver, receivables.data, milestones.data, procurements.data, canApprove, currentUser?.id, realRole, base, project.currency, t]);

  return { items, myVisibleTaskKeys, isPending, error };
}

