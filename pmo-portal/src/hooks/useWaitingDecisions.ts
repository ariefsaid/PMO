import { useContext } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useOrgId } from '@/src/hooks/useOrgId';
import { hasDecisionStanding, listWaitingDecisions, type WaitingDecisionRow } from '@/src/lib/db/waitingDecisions';

export const waitingDecisionsKey = (orgId: string | undefined, userId: string | undefined) => ['waiting-decisions', orgId, userId] as const;
export const decisionStandingKey = (orgId: string | undefined, userId: string | undefined) => ['decision-standing', orgId, userId] as const;

/** The two database reads behind the shared waiting list (1560). Kept apart so a test of one screen can hold them idle in one place. */
/** Without a query client (a bare render) the database-listed kinds are inert and request nothing; the client never changes within a mount. */
const INERT = { data: undefined as WaitingDecisionRow[] | undefined, isPending: false, isError: false, refetch: () => undefined as unknown };
function useLiveDatabaseWaiting(orgId: string | undefined, userId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: waitingDecisionsKey(orgId, userId), queryFn: listWaitingDecisions, enabled });
}
export function useDatabaseWaiting(orgId: string | undefined, userId: string | undefined, enabled: boolean) {
  const client = useContext(QueryClientContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the client is fixed for the life of the tree
  return client ? useLiveDatabaseWaiting(orgId, userId, enabled) : INERT;
}

const INERT_STANDING = { data: undefined as boolean | undefined, isPending: false, isError: false };
function useLiveStanding() {
  const { currentUser } = useAuth();
  const orgId = useOrgId();
  const userId = currentUser?.id;
  return useQuery({ queryKey: decisionStandingKey(orgId, userId), queryFn: hasDecisionStanding, enabled: Boolean(orgId && userId), staleTime: 5 * 60_000 });
}

/** True when this login can decide anything at all (the Approvals entry is offered even with nothing waiting). `my_decision_standing()` decides. */
export function useDecisionStanding() {
  const client = useContext(QueryClientContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks -- the client is fixed for the life of the tree
  return client ? useLiveStanding() : INERT_STANDING;
}

