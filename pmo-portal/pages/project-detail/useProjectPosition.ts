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
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';

export interface CategoryPosition { category: string; budget: number; actual: number | null }

/**
 * Budget vs actual per Active-budget category, shared by the cost block and "Needs attention" so the
 * two can never disagree. `spent`/`over` are project-level only when every category is known.
 */
export function useBudgetPosition(project: ProjectWithRefs) {
  const may = usePermission();
  const canSeeActual = may('view', 'salesInvoice');
  const versions = useBudgetVersions(project.id);
  const finances = useProjectFinances(project.id, { enabled: canSeeActual });
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
      hasBudget: Boolean(active), canSeeActual, rows, budget, spent,
      projectOver: spent !== null && spent > budget ? spent - budget : null,
      overRows,
      unknown: rows.filter((r) => r.actual === null).length,
    };
  }, [versions.data, versions.isPending, versions.isError, versions.refetch, actuals, project.currency, canSeeActual]);
}

/** Overdue customer invoices: count, oldest age, and the unpaid balance only when every balance is known. */
export function useOverdueReceivables(project: ProjectWithRefs) {
  const may = usePermission();
  const enabled = may('view', 'salesInvoice');
  const invoices = useSalesInvoices(project.id, { enabled });
  const { day: orgToday } = useFxOrgDay(enabled);
  return useMemo(() => {
    if (!enabled) return null;
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
  }, [enabled, invoices.data, orgToday, project.id]);
}

export interface AttentionItem {
  key: string;
  tone: 'danger' | 'warn';
  /** What is wrong, in a few words — carries the status word (late, overdue, over). */
  what: string;
  /** How big — only when the block below doesn't already show it (no figure twice). */
  size?: string;
  /** The verb that fixes it. */
  action: string;
  to: string;
}

const attnToday = () => new Date().toISOString().slice(0, 10);

/**
 * Exceptions that need a person, from signals the page already shows. Not used for `delivery`
 * (engineer): their overdue count heads My open tasks instead.
 */
export function useProjectAttention(project: ProjectWithRefs, lens: 'money' | 'pm' | 'delivery'): { items: AttentionItem[]; isPending: boolean } {
  const { t } = useTranslation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const base = `/projects/${project.id}`;
  const milestones = useMilestones(project.id);
  const budget = useBudgetPosition(project);
  const receivables = useOverdueReceivables(project);
  const canApprove = lens !== 'delivery' && may('transition', 'procurement');
  const procurements = useProjectProcurements(canApprove ? project.id : null);

  const items = useMemo(() => {
    const out: AttentionItem[] = [];
    if (lens !== 'delivery' && budget.overRows.length) {
      const worst = budget.overRows[0];
      out.push({ key: 'budget', tone: 'danger', to: `${base}/budget`,
        what: budget.projectOver !== null
          ? t('projectDetail.attention.projectOver', 'Project over budget')
          : t('projectDetail.attention.categoryOver', '{{category}} over budget', { category: budgetCategoryLabel(worst.category, t) }),
        // The amount is the cost block's headline; here only where it comes from.
        size: budget.projectOver !== null ? t('projectDetail.attention.mostly', 'mostly {{category}}', { category: budgetCategoryLabel(worst.category, t) }) : undefined,
        action: t('projectDetail.attention.budgetAction', 'Review budget') });
    }
    if (receivables && lens !== 'delivery') {
      out.push({ key: 'ar', tone: 'danger', to: receivables.to,
        what: receivables.count === 1 ? t('projectDetail.attention.arWhatOne', 'Customer invoice overdue') : t('projectDetail.attention.arWhatMany', '{{count}} customer invoices overdue', { count: receivables.count }),
        // Only a known balance is a figure; an unsynced balance shows age only, never the invoice total.
        size: receivables.balance !== null
          ? t('projectDetail.attention.arSize', '{{amount}} {{currency}} unpaid · {{days}} days', { amount: formatNumberWhole(receivables.balance), currency: project.currency, days: receivables.oldest })
          : t('projectDetail.attention.arSizeNoBalance', '{{days}} days past due', { days: receivables.oldest }),
        action: receivables.count === 1 ? t('projectDetail.attention.arActionOne', 'See invoice') : t('projectDetail.attention.arActionMany', 'See invoices') });
    }
    if (lens !== 'delivery') {
      const late = (milestones.data ?? []).filter((m) => m.target_date && m.target_date < attnToday() && m.effective_pct < 100 && (m.effective_pct > 0 || m.task_count > 0));
      if (late.length) {
        const worst = late.reduce((w, m) => (m.target_date! < w.target_date! ? m : w));
        out.push({ key: 'phases', tone: 'warn', to: `${base}/tasks`,
          what: late.length === 1
            ? t('projectDetail.attention.phaseWhat', '{{name}} is late', { name: worst.name })
            : t('projectDetail.attention.phasesWhat', '{{count}} phases late', { count: late.length }),
          action: t('projectDetail.attention.phaseAction', 'See tasks') });
      }
    }
    if (canApprove) {
      const waiting = pendingProcurementApprovals(procurements.data, currentUser?.id, realRole === 'Admin');
      if (waiting.length) {
        out.push({ key: 'approve', tone: 'warn', to: `${base}/procurement`,
          what: waiting.length === 1
            ? t('projectDetail.attention.approveOne', 'Purchase request waiting for you')
            : t('projectDetail.attention.approveMany', '{{count}} purchase requests waiting for you', { count: waiting.length }),
          action: t('projectDetail.attention.approveAction', 'Review') });
      }
    }
    return out.sort((x, y) => (x.tone === y.tone ? 0 : x.tone === 'danger' ? -1 : 1));
  }, [lens, budget.overRows, budget.projectOver, receivables, milestones.data, procurements.data, canApprove, currentUser?.id, realRole, base, project.currency, t]);

  return { items, isPending: milestones.isPending || budget.isPending };
}

