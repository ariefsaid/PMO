import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockReservationsRepository as repo } from '@/src/lib/repositories/stockReservations';
import { useOrgId } from '@/src/hooks/useOrgId';

/** The organisation's reservation settings (#2693), off by default. While unread or failed they read as off: nothing new shows. */
export function useReservationSettings() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['stock-reservation-settings', orgId], queryFn: () => repo.settings(), enabled: Boolean(orgId), staleTime: 60_000, retry: false });
}
export function useReservationsEnabled(): boolean {
  return useReservationSettings().data?.enabled === true;
}
/** Free and reserved per item and location; fetched only while reservations are on. */
export function useFreeReserved(enabled: boolean, warehouseId?: string) {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['stock-free-reserved', orgId, warehouseId ?? 'all'], queryFn: () => repo.freeReserved(warehouseId), enabled: Boolean(orgId) && enabled, retry: false });
}
export function useWorkOrderReservations(workOrderId: string | undefined, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['wo-reservations', orgId, workOrderId], queryFn: () => repo.forWorkOrder(workOrderId!), enabled: Boolean(orgId) && Boolean(workOrderId) && enabled, retry: false });
}
export function useRequestBorrowing(requestId: string | undefined, enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['request-borrowing', orgId, requestId], queryFn: () => repo.requestBorrowing(requestId!), enabled: Boolean(orgId) && Boolean(requestId) && enabled, retry: false });
}
/** After a reserve, release or setting change the figures are stale. */
export function useReservationRefresh() {
  const qc = useQueryClient();
  return () => Promise.all(['stock-reservation-settings', 'stock-free-reserved', 'wo-reservations', 'request-borrowing'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
/** Who may reserve in the screen (UX only; the database decides): the location's keeper, a planner (master-data rank) or an Admin; never while viewing as another role. */
export function mayReserve(realRole: string | null | undefined, viewOnly: boolean, isKeeper: boolean): boolean {
  if (viewOnly) return false;
  return isKeeper || realRole === 'Admin' || realRole === 'Project Manager' || realRole === 'Finance' || realRole === 'Executive';
}
