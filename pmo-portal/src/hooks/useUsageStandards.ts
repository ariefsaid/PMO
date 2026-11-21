import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usageStandardRepository as repo } from '@/src/lib/repositories/usageStandards';
import type { UsageStandardFilter, UsageStandardInput } from '@/src/lib/repositories/usageStandards';
import { useAuth } from '@/src/auth/useAuth';
import { MATERIAL_REQUEST_QUERY_ROOT } from '@/src/hooks/useMaterialRequests';

/** Usage standards and the consumable plan (#2577) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const USAGE_STANDARD_QUERY_ROOT = 'usage-standards';
const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

export function useUsageStandards(filter: UsageStandardFilter) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [USAGE_STANDARD_QUERY_ROOT, orgId, 'list', filter], queryFn: () => repo.list(filter), enabled: Boolean(orgId), placeholderData: (prev) => prev });
}
export function useStandardMatchCounts() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [USAGE_STANDARD_QUERY_ROOT, orgId, 'match-counts'], queryFn: () => repo.matchCounts(), enabled: Boolean(orgId) });
}

export function useUsageStandardMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const opts = { onSuccess: () => qc.invalidateQueries({ queryKey: [USAGE_STANDARD_QUERY_ROOT, orgId] }) };
  return {
    create: useMutation({ mutationFn: (i: UsageStandardInput) => repo.create(i), ...opts }),
    update: useMutation({ mutationFn: (a: { id: string; input: UsageStandardInput }) => repo.update(a.id, a.input), ...opts }),
    archive: useMutation({ mutationFn: (a: { id: string; archived: boolean }) => repo.setArchived(a.id, a.archived), ...opts }),
  };
}

export function useConsumablePlan(workOrderId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [USAGE_STANDARD_QUERY_ROOT, orgId, 'plan', workOrderId], queryFn: () => repo.plan(workOrderId as string), enabled: Boolean(orgId) && Boolean(workOrderId) });
}
/** The inputs a regeneration would use, for the preview diff (FR-CUS-007). Fetched only when the user asks to regenerate. */
export function usePlanInputs(workOrderId: string | undefined, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [USAGE_STANDARD_QUERY_ROOT, orgId, 'inputs', workOrderId], queryFn: () => repo.planInputs(workOrderId as string), enabled: enabled && Boolean(orgId) && Boolean(workOrderId), gcTime: 0 });
}

export function useConsumablePlanMutations(workOrderId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  // A plan change moves the figure a request form shows, so the request plan reads are refreshed too (never the snapshots).
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: [USAGE_STANDARD_QUERY_ROOT, orgId] });
    await qc.invalidateQueries({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'plans'] });
  };
  const opts = { onSuccess: refresh };
  return {
    generate: useMutation({ mutationFn: () => repo.generate(workOrderId), ...opts }),
    adjust: useMutation({ mutationFn: (a: { itemId: string; adjustedQty: string | null; reason: string | null }) => repo.adjust({ workOrderId, ...a }), ...opts }),
  };
}
