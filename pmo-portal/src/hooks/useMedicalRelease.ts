import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { medicalReleaseRepository } from '@/src/lib/repositories/medicalRelease';
import { useOptionalOrgId } from '@/src/hooks/useOrgId';

/** Medical releases over the repository seam (ADR-0017). Keys carry org_id. The holds read sits on shared roster chrome, so
 *  outside a query provider or a session it is simply off: no throw, no request (as the leave reads). */
const ROOTS = ['medical-releases', 'medical-release-holds'] as const;
const IDLE_CLIENT = new QueryClient();
function useReleaseQuery<T>(key: QueryKey, fn: () => Promise<T>, enabled: boolean) {
  const qc = useContext(QueryClientContext);
  return useQuery({ queryKey: key, queryFn: fn, enabled: enabled && Boolean(qc) }, qc ?? IDLE_CLIENT);
}

export function useMedicalReleases() {
  const orgId = useOptionalOrgId();
  return useReleaseQuery(['medical-releases', orgId], () => medicalReleaseRepository.visible(), Boolean(orgId));
}

export function useCanEnterRelease(): boolean {
  const orgId = useOptionalOrgId();
  return useReleaseQuery(['medical-release-can-enter', orgId], () => medicalReleaseRepository.canEnter(), Boolean(orgId)).data === true;
}

export function useReleasePeople(enabled: boolean) {
  const orgId = useOptionalOrgId();
  return useReleaseQuery(['medical-release-people', orgId], () => medicalReleaseRepository.people(), Boolean(orgId) && enabled);
}

/** Who is held from rostering on a date, by person id. Empty while nobody has an open release. */
export function useReleaseHolds(date: string | null) {
  const orgId = useOptionalOrgId();
  return useReleaseQuery(['medical-release-holds', orgId, date], () => medicalReleaseRepository.holds(date as string), Boolean(orgId && date));
}

export function useMedicalReleaseMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all(ROOTS.map((r) => qc.invalidateQueries({ queryKey: [r] })));
  return {
    create: useMutation({
      mutationFn: (v: { personId: string; date: string; note: string | null }) => medicalReleaseRepository.create(v.personId, v.date, v.note),
      onSuccess: refresh,
    }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'Approved' | 'Deferred'; note: string | null }) => medicalReleaseRepository.decide(v.id, v.decision, v.note),
      onSuccess: refresh,
    }),
  };
}
