import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** #2682 — the billing plan's candidates. Key carries org_id; `projectId` null = every project the viewer can see. */
export function useBillingPlanCandidates(projectId: string | null, enabled = true) {
  return useOrgQuery(['billing-plan-candidates', projectId], () => repositories.billingStages.readPlanCandidates(projectId), { enabled });
}

/** Assessed but not yet client-accepted quantities, shown in a separate billing-plan group. */
export function useBillingUnacceptedProgress(projectId: string | null, enabled = true) {
  return useOrgQuery(['billing-unaccepted-progress', projectId], () => repositories.billingStages.readUnacceptedProgress(projectId), { enabled });
}

/** The plan's settings (target, currency, month overrides, reminder switch). #2675 reuses this hook for the reminder. */
export function useBillingPlanSettings(enabled = true) {
  return useOrgQuery(['billing-plan-settings'], () => repositories.billingStages.getPlanSettings(), { enabled });
}

export function useSaveBillingPlanSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { monthlyTarget: number | null; targetCurrency: string | null; reminderOn: boolean; afterDays?: number | null; month?: { month: string; target: number | null } }) => {
      await repositories.billingStages.savePlanSettings({ monthlyTarget: input.monthlyTarget, targetCurrency: input.targetCurrency, reminderOn: input.reminderOn });
      if (input.afterDays !== undefined) await repositories.billingStages.savePlanReminder({ reminderOn: input.reminderOn, afterDays: input.afterDays });
      if (input.month) await repositories.billingStages.saveMonthTarget(input.month.month, input.month.target);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing-plan-settings'] }),
  });
}

/** #2675: the done-not-claimed reminder switch and its day limit, saved on their own (#2746: the Billing extras module card shows them too; Finance keeps the plan modal). */
export function useSaveDoneNotClaimedReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { reminderOn: boolean; afterDays: number | null }) => repositories.billingStages.savePlanReminder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing-plan-settings'] }),
  });
}
