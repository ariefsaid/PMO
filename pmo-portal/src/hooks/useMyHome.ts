import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { myHomeRepository } from '@/src/lib/repositories/myHome';
import { attendanceRepository } from '@/src/lib/repositories/crews';
import { useAuth } from '@/src/auth/useAuth';

export const MY_HOME_KEY = 'my-home';

export function useMyHome() {
  const { currentUser } = useAuth();
  return useQuery({ queryKey: [MY_HOME_KEY, currentUser?.id], queryFn: () => myHomeRepository.get(), enabled: Boolean(currentUser?.id) });
}

/** Deliveries addressed to the person. The seam for the handover ticket: an empty list until it supplies a source. */
export function useMyDeliveries() {
  const { currentUser } = useAuth();
  return useQuery({ queryKey: ['my-deliveries', currentUser?.id], queryFn: () => myHomeRepository.deliveries(), enabled: Boolean(currentUser?.id) });
}

export function useMyTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'To Do' | 'In Progress' | 'Done' | 'Blocked' }) => myHomeRepository.setTaskStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MY_HOME_KEY] }),
  });
}

/** Clock in at a rostered work order through the EXISTING attendance path (source `phone_check_in`). #2705 adds the location test. */
export function useClockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workOrderId: string; date: string; workerId: string; hours: number }) =>
      attendanceRepository.record(v.workOrderId, v.date, 'phone_check_in', [{ worker_id: v.workerId, status: 'present', hours: v.hours }]),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['attendance-day'] }); },
  });
}

export function useSeatReport(enabled: boolean) {
  return useQuery({ queryKey: ['org-seat-report'], queryFn: () => myHomeRepository.seatReport(), enabled, retry: false });
}
