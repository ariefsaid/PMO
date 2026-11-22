import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { myHomeRepository } from '@/src/lib/repositories/myHome';
import { useAuth } from '@/src/auth/useAuth';

export const MY_HOME_KEY = 'my-home';

export function useMyHome() {
  const { currentUser } = useAuth();
  return useQuery({ queryKey: [MY_HOME_KEY, currentUser?.id], queryFn: () => myHomeRepository.get(), enabled: Boolean(currentUser?.id) });
}

/** Transfers sent to the person, waiting for their count (the same list on the full home and on the phone home). */
export function useMyDeliveries() {
  const { currentUser } = useAuth();
  return useQuery({ queryKey: ['my-deliveries', currentUser?.id], queryFn: () => myHomeRepository.deliveries(currentUser!.id), enabled: Boolean(currentUser?.id) });
}

export function useMyTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'To Do' | 'In Progress' | 'Done' | 'Blocked' }) => myHomeRepository.setTaskStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: [MY_HOME_KEY] }),
  });
}

export function useSeatReport(enabled: boolean) {
  return useQuery({ queryKey: ['org-seat-report'], queryFn: () => myHomeRepository.seatReport(), enabled, retry: false });
}
