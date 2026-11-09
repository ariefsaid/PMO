import { useCallback, useMemo } from 'react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useMilestones } from '@/src/hooks/useMilestones';
import { useTasks } from '@/src/hooks/useTasks';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useBudgetPosition } from '@/src/hooks/useProjectPosition';
import { useProjectCommittedSpend, useProjectProcurements } from '@/src/hooks/useProcurements';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { buildBudgetSummaryRows, committedTotal } from '@/src/lib/budget/budgetModel';
import { buildSCurve } from '@/src/lib/delivery/sCurve';
import { completionPct } from '@/src/lib/format';
import { summarizeInvoiceSettlement } from './ContractCascade';

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Weighted delivery progress, the phase-by-phase schedule position and the plan-to-date, from the phases and tasks the page already reads. */
export function useScheduleSummary(project: ProjectWithRefs) {
  const today = useOrgToday();
  const phases = useMilestones(project.id);
  const tasks = useTasks(project.id);
  const { refetch: refetchPhases } = phases;
  const { refetch: refetchTasks } = tasks;
  const retry = useCallback(() => { void refetchPhases(); void refetchTasks(); }, [refetchPhases, refetchTasks]);
  const summary = useMemo(() => {
    const milestones = phases.data ?? [];
    const totalWeight = milestones.reduce((sum, phase) => sum + phase.weight, 0);
    const progress = totalWeight > 0
      ? completionPct(milestones.reduce((sum, phase) => sum + phase.weight * phase.effective_pct, 0) / totalWeight)
      : null;
    const late = milestones.filter((phase) => phase.target_date && phase.target_date < today && phase.effective_pct < 100
      && (phase.effective_pct > 0 || phase.task_count > 0));
    const worst = late.reduce<{ name: string; days: number } | null>((acc, phase) => {
      const days = daysBetween(phase.target_date as string, today);
      return !acc || days > acc.days ? { name: phase.name, days } : acc;
    }, null);
    const endLate = project.end_date && project.end_date < today && progress !== null && progress < 100
      ? daysBetween(project.end_date, today) : null;
    const planned = tasks.data && milestones.length > 0 ? buildSCurve(milestones, today, tasks.data).plannedToDate : null;
    return {
      today, milestones, progress, endLate, lateCount: late.length, worst,
      planned: planned === null ? null : Math.round(planned),
      isPending: phases.isPending,
      isError: phases.isError || tasks.isError,
    };
  }, [phases.data, phases.isPending, phases.isError, tasks.isError, tasks.data, today, project.end_date]);
  return { ...summary, retry };
}

/** Spent + committed against the active budget: the same totals the Budget tab shows. */
export function useBudgetUsage(project: ProjectWithRefs) {
  const may = usePermission();
  const pos = useBudgetPosition(project);
  const canReadProcurements = may('view', 'procurement');
  const committed = useProjectCommittedSpend(canReadProcurements ? project.id : null, canReadProcurements);
  const procurements = useProjectProcurements(canReadProcurements ? project.id : null);
  return useMemo(() => {
    const summary = committed.commitmentSource === 'pmo' && !procurements.isPending && !procurements.isError
      ? buildBudgetSummaryRows({
        lines: pos.rows.map((row) => ({ category: row.category, description: null, budgeted_amount: row.budget })),
        actuals: pos.rows,
        procurements: procurements.data,
        canReadProcurements,
        currency: project.currency,
      })
      : null;
    const committedByCategory = new Map((summary ?? []).map((row) => [row.category, row.committed ?? 0] as const));
    const committedAll = summary ? committedTotal(summary) : null;
    const unavailable = canReadProcurements && committed.commitmentSource !== 'not-tracked' && committedAll === null;
    const spentAndCommitted = pos.spent === null || unavailable ? null : pos.spent + (committedAll ?? 0);
    return {
      pos, summaryRows: summary, committedByCategory, committed: committedAll, spentAndCommitted,
      usedPercent: pos.budget > 0 && spentAndCommitted !== null ? Math.round((spentAndCommitted / pos.budget) * 100) : null,
      remaining: spentAndCommitted === null ? null : pos.budget - spentAndCommitted,
    };
  }, [pos, committed.commitmentSource, procurements.data, procurements.isPending, procurements.isError, canReadProcurements, project.currency]);
}

/** Invoiced and paid in the project currency; null until every amount is known (same rule as the Money block). */
export function useInvoicedPaid(project: ProjectWithRefs) {
  const may = usePermission();
  const canViewMoney = may('view', 'salesInvoice');
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });
  return useMemo(() => {
    if (!canViewMoney || invoices.isPending || invoices.isError) return { invoiced: null, paid: null, count: 0, pending: canViewMoney && invoices.isPending };
    const rows = (invoices.data ?? []).filter((invoice) => invoice.currency === project.currency);
    const settlement = summarizeInvoiceSettlement(rows.map((invoice) => ({
      status: invoice.status, amount: invoice.amount, erp_outstanding_amount: invoice.erp_outstanding_amount,
    })));
    return { invoiced: settlement.invoiced, paid: settlement.balancesKnown ? settlement.paid : null, count: rows.length, pending: false };
  }, [canViewMoney, invoices.data, invoices.isPending, invoices.isError, project.currency]);
}
