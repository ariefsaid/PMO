import { useInfiniteQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { HistoryCursor, HistoryPage } from '@/src/lib/repositories/recordHistory';
import { useAuth } from '@/src/auth/useAuth';

export interface UseRecordHistoryArgs {
  entityType: string;
  entityId: string;
  includeChildren?: boolean;
  entityTypes?: string[] | null;
  /** Lazy sections (company / contact) only fetch once opened. */
  enabled?: boolean;
}

/**
 * A record's change history over the repository seam (ADR-0017), 50 events per page, newest first,
 * "Load older" by `seq` cursor. Org-scoped key (tenant scope, defence in depth — RLS is the authority).
 */
export function useRecordHistory({
  entityType, entityId, includeChildren = false, entityTypes = null, enabled = true,
}: UseRecordHistoryArgs) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useInfiniteQuery<HistoryPage, Error, { pages: HistoryPage[] }, unknown[], HistoryCursor | null>({
    queryKey: ['record-history', orgId, entityType, entityId, includeChildren, entityTypes],
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      repositories.recordHistory.list({
        entityType, entityId, includeChildren, entityTypes, cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(orgId && entityId) && enabled,
  });
}
