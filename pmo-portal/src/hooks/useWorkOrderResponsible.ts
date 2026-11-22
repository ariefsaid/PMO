import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import * as dal from '@/src/lib/db/workOrderResponsible';

/** A screen rendered without a query client (a bare unit test of an older screen) reads nothing and shows no new control. */
const IDLE = new QueryClient();
const useClient = () => useContext(QueryClientContext) ?? IDLE;
const useOrg = () => useContext(AuthContext)?.currentUser?.org_id;
const key = (orgId: string | undefined, ...rest: unknown[]) => ['wo-responsible', orgId, ...rest] as const;

export function useWorkOrderResponsiblePerson(workOrderId: string) {
  const orgId = useOrg();
  return useQuery({ queryKey: key(orgId, workOrderId), queryFn: () => dal.getWorkOrderResponsiblePerson(workOrderId), enabled: Boolean(orgId), retry: false }, useClient());
}
export function useResponsibleCandidates(enabled: boolean) {
  const orgId = useOrg();
  return useQuery({ queryKey: key(orgId, 'candidates'), queryFn: dal.listResponsibleCandidates, enabled: Boolean(orgId) && enabled, staleTime: 60_000 }, useClient());
}
export function useSetResponsiblePerson(workOrderId: string) {
  const orgId = useOrg();
  const qc = useClient();
  return useMutation({
    mutationFn: (personId: string | null) => dal.setWorkOrderResponsiblePerson(workOrderId, personId),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId, workOrderId) }),
  }, qc);
}
