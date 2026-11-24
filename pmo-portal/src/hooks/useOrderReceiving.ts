import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { orderReceivingRepository } from '@/src/lib/repositories/orderReceiving';

export function useOrderReceivingEnabled() {
  const org = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['order-receiving-enabled', org], queryFn: orderReceivingRepository.enabled, enabled: Boolean(org) });
}
export function useReceivingOrders(enabled: boolean) {
  const org = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['receiving-orders', org], queryFn: orderReceivingRepository.orders, enabled: Boolean(org) && enabled });
}
export function useOrderReceiving(orderId: string) {
  const org = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['order-receiving', org, orderId], queryFn: () => orderReceivingRepository.read(orderId), enabled: Boolean(org && orderId) });
}
