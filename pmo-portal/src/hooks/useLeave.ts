import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { leaveRepository, type LeaveRequestInput, type LeaveSettings } from '@/src/lib/repositories/leave';

/** Leave requests (#2708) over the repository seam (ADR-0017). Keys carry org_id. Off means off: every read below the
 *  settings read waits for `enabled`, so an organisation that never switched it on makes no leave call but one. */
const ROOTS = ['leave-requests', 'leave-on-date'] as const;
const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

export function useLeaveSettings() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['leave-settings', orgId], queryFn: () => leaveRepository.settings(), enabled: Boolean(orgId) });
}

/** True only when the organisation switched leave requests on. Unknown (loading, failed) is false. */
export function useLeaveEnabled(): boolean {
  return useLeaveSettings().data?.enabled === true;
}

export function useLeaveTypes() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['leave-types', orgId], queryFn: () => leaveRepository.types(), enabled: Boolean(orgId) });
}

export function useLeaveRequests() {
  const orgId = useOrgId();
  const enabled = useLeaveEnabled();
  return useQuery({ queryKey: ['leave-requests', orgId], queryFn: () => leaveRepository.visible(), enabled: Boolean(orgId) && enabled });
}

export function useLeaveOnDate(date: string | null) {
  const orgId = useOrgId();
  const enabled = useLeaveEnabled();
  return useQuery({
    queryKey: ['leave-on-date', orgId, date], queryFn: () => leaveRepository.onDate(date as string),
    enabled: Boolean(orgId && date) && enabled,
  });
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
