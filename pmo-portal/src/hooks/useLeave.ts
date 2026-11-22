import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { leaveRepository, type LeaveRequestInput, type LeaveSettings } from '@/src/lib/repositories/leave';
import { useModuleOn } from '@/src/hooks/useOrgSwitch';

/** Leave requests (#2708) over the repository seam (ADR-0017). Keys carry org_id. Off means off: every read below the
 *  settings read waits for `enabled`, so an organisation that never switched it on makes no leave call but one. */
const ROOTS = ['leave-requests', 'leave-on-date'] as const;
// The leave reads sit on shared chrome (rail, approvals, roster). Outside a query provider or a session they are simply
// off: no throw, no request, so the shell never depends on this feature being mounted.
const IDLE_CLIENT = new QueryClient();
const useOrgId = (): string | undefined => useContext(AuthContext)?.currentUser?.org_id;
function useLeaveQuery<T>(key: QueryKey, fn: () => Promise<T>, enabled: boolean) {
  const qc = useContext(QueryClientContext);
  return useQuery({ queryKey: key, queryFn: fn, enabled: enabled && Boolean(qc) }, qc ?? IDLE_CLIENT);
}

export function useLeaveSettings() {
  const orgId = useOrgId();
  return useLeaveQuery(['leave-settings', orgId], () => leaveRepository.settings(), Boolean(orgId));
}

/** True only when the organisation switched leave requests on. Unknown (loading, failed) is false. */
export function useLeaveEnabled(): boolean {
  const moduleOn = useModuleOn('modulePeopleCrews');
  return useLeaveSettings().data?.enabled === true && moduleOn;
}

export function useLeaveTypes() {
  const orgId = useOrgId();
  return useLeaveQuery(['leave-types', orgId], () => leaveRepository.types(), Boolean(orgId));
}

export function useLeaveRequests() {
  const orgId = useOrgId();
  const enabled = useLeaveEnabled();
  return useLeaveQuery(['leave-requests', orgId], () => leaveRepository.visible(), Boolean(orgId) && enabled);
}

export function useLeaveOnDate(date: string | null) {
  const orgId = useOrgId();
  const enabled = useLeaveEnabled();
  return useLeaveQuery(['leave-on-date', orgId, date], () => leaveRepository.onDate(date as string), Boolean(orgId && date) && enabled);
}

export function useLeaveMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([...ROOTS.map((r) => qc.invalidateQueries({ queryKey: [r] }))]);
  return {
    submit: useMutation({ mutationFn: (i: LeaveRequestInput) => leaveRepository.submit(i), onSuccess: refresh }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'Approved' | 'Rejected'; note: string | null }) => leaveRepository.decide(v.id, v.decision, v.note),
      onSuccess: refresh,
    }),
    cancel: useMutation({ mutationFn: (id: string) => leaveRepository.cancel(id), onSuccess: refresh }),
  };
}

export function useLeaveSettingsMutations() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (s: LeaveSettings) => leaveRepository.setSettings(s),
      onSuccess: () => Promise.all(['leave-settings', ...ROOTS].map((r) => qc.invalidateQueries({ queryKey: [r] }))),
    }),
    createType: useMutation({ mutationFn: (n: string) => leaveRepository.createType(n), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-types'] }) }),
    archiveType: useMutation({ mutationFn: (id: string) => leaveRepository.archiveType(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-types'] }) }),
  };
}
