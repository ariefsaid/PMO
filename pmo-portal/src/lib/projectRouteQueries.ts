import type { QueryClient } from '@tanstack/react-query';
import type { projectOverviewFlags } from '@/src/auth/projectOverviewAccess';
import { repositories } from './repositories';
import { externalDomainOwnershipKey } from '@/src/hooks/approvalsQueryKeys';

export function projectOverviewQuery(qc: QueryClient, orgId: string | undefined, projectId: string, flags: ReturnType<typeof projectOverviewFlags>) {
  return {
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
    enabled: Boolean(orgId && projectId),
    retry: false,
  };
}

export const projectBudgetPositionsQuery = (orgId: string | undefined, ids: string[]) => {
  const stableIds = [...new Set(ids)].sort();
  return {
    queryKey: ['project-budget-positions', orgId, stableIds.join(',')],
    queryFn: () => repositories.projectMoney.budgetPositions(stableIds),
    staleTime: 15_000,
  };
};

export const projectTasksQuery = (orgId: string | undefined, projectId: string) => ({
  queryKey: ['tasks', orgId, projectId],
  queryFn: () => repositories.task.list(projectId),
});
