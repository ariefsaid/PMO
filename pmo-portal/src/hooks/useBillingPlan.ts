import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** #2682 — the billing plan's candidates. Key carries org_id; `projectId` null = every project the viewer can see. */
export function useBillingPlanCandidates(projectId: string | null, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['billing-plan-candidates', orgId, projectId],
    queryFn: () => repositories.billingStages.readPlanCandidates(projectId),
    enabled: enabled && Boolean(orgId),
  });
}

/** The plan's settings (target, currency, month overrides, reminder switch). #2675 reuses this hook for the reminder. */
export function useBillingPlanSettings(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['billing-plan-settings', orgId],
    queryFn: () => repositories.billingStages.getPlanSettings(),
    enabled: enabled && Boolean(orgId),
  });
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
