import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { externalDomainOwnershipKey } from './approvalsQueryKeys';

/**
 * One read for the Overview's above-the-fold summaries (AC-PERF-007/008). On success it seeds the cache keys the
 * leaf hooks already use, so they find fresh data and issue no request; on failure the leaf hooks read for
 * themselves, exactly as before. The leaf hooks are untouched.
 *
 * The flags mirror what the page already asks for: money = may view invoices, commitments = may view procurement,
 * budget = not the delivery lens. The server re-checks every gate under the caller's real role.
 */
export function useProjectOverviewRead(projectId: string, enabled: boolean) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const flags = {
    money: may('view', 'salesInvoice'),
    commitments: may('view', 'procurement'),
    budget: realRole === 'Admin' || realRole === 'Executive' || realRole === 'Finance' || realRole === 'Project Manager',
  };
  return useQuery({
    queryKey: ['project-overview-read', orgId, projectId, flags],
    queryFn: async () => {
      const read = await repositories.projectOverview.read(projectId, flags);
      const seed = (key: readonly unknown[], value: unknown) => {
        if (value !== undefined) qc.setQueryData(key, value);
      };
      seed(['project-finances', orgId, projectId], read.finances);
      seed(['project-billing', orgId, projectId], read.billing);
      seed(['boq-items', orgId, projectId], read.boqItems);
      seed(['budget-versions', orgId, projectId], read.budgetVersions ?? undefined);
      seed(['project-committed-spend', orgId, projectId], read.committedSpend);
      seed(externalDomainOwnershipKey(orgId), read.externalDomainOwnership);
      seed(['org-reads-erp-ledger', orgId], read.readsErpLedger);
      seed(['milestones', orgId, projectId], read.milestones);
      seed(['project-comment-count', orgId, projectId], read.commentCount);
      seed(['fx-context', orgId ?? ''], read.fxContext ?? undefined);
      return read;
    },
    enabled: enabled && Boolean(orgId && projectId),
    retry: false,
  });
}
