import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { phoneCheckInRepository, type CheckInArgs, type WorkOrderArea } from '@/src/lib/repositories/phoneCheckIn';
import { useAuth } from '@/src/auth/useAuth';

export const CHECK_IN_REQUESTS_KEY = 'phone-check-in-requests';

/** The tap: one RPC call; the database decides. Refreshes attendance and the decision list. */
export function usePhoneCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: CheckInArgs) => phoneCheckInRepository.checkIn(a),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance-day'] });
      void qc.invalidateQueries({ queryKey: [CHECK_IN_REQUESTS_KEY] });
    },
  });
}

/** Pending requests the caller may decide. A light account or a non-decider gets an error or an empty list: the list renders nothing. */
export function useCheckInRequests() {
  const { currentUser } = useAuth();
  return useQuery({
    queryKey: [CHECK_IN_REQUESTS_KEY, currentUser?.id], queryFn: () => phoneCheckInRepository.requests(),
    enabled: Boolean(currentUser?.id), retry: false,
  });
}

export function useDecideCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; approve: boolean; reason: string | null }) => phoneCheckInRepository.decide(v.id, v.approve, v.reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CHECK_IN_REQUESTS_KEY] });
      void qc.invalidateQueries({ queryKey: ['attendance-day'] });
    },
  });
}

export function useWorkOrderArea(workOrderId: string | null) {
  return useQuery({ queryKey: ['work-order-area', workOrderId], queryFn: () => phoneCheckInRepository.area(workOrderId as string), enabled: Boolean(workOrderId) });
}

export function useSetWorkOrderArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workOrderId: string; area: WorkOrderArea | null }) => phoneCheckInRepository.setArea(v.workOrderId, v.area),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['work-order-area', v.workOrderId] }); void qc.invalidateQueries({ queryKey: ['my-home'] }); },
  });
}

export function useSupervisorRole(enabled: boolean) {
  return useQuery({ queryKey: ['phone-check-in-supervisor-role'], queryFn: () => phoneCheckInRepository.supervisorRole(), enabled });
}

export function useSetSupervisorRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: string | null) => phoneCheckInRepository.setSupervisorRole(role),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['phone-check-in-supervisor-role'] }); },
  });
}
