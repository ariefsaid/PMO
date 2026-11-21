import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import * as dal from '@/src/lib/db/dsrStockIssue';

/** #2676 hooks. Keys are org-scoped; the setting read never throws (a failed read means off). */
/** A screen rendered without a query client (a bare unit test of an older screen) reads nothing and shows no new control. */
const IDLE = new QueryClient();
const useClient = () => useContext(QueryClientContext) ?? IDLE;
const useOrg = () => useContext(AuthContext)?.currentUser?.org_id;
const key = (orgId: string | undefined, ...rest: unknown[]) => ['dsr-stock-issue', orgId, ...rest] as const;

export function useDsrStockSettings() {
  const orgId = useOrg();
  const qc = useClient();
  return useQuery({ queryKey: key(orgId, 'settings'), queryFn: dal.getDsrStockSettings, enabled: Boolean(orgId), staleTime: 60_000, retry: false }, qc);
}
export function useDsrStockStatus(reportId: string, enabled: boolean) {
  const orgId = useOrg();
  const qc = useClient();
  return useQuery({ queryKey: key(orgId, 'status', reportId), queryFn: () => dal.getDsrStockStatus(reportId), enabled: Boolean(orgId) && enabled, retry: false }, qc);
}
export function useDsrStockFlags(reportIds: string[], enabled: boolean) {
  const orgId = useOrg();
  const qc = useClient();
  return useQuery({ queryKey: key(orgId, 'flags', reportIds), queryFn: () => dal.listDsrStockFlags(reportIds), enabled: Boolean(orgId) && enabled && reportIds.length > 0, retry: false }, qc);
}
export function useSiteLocations(projectId: string, enabled: boolean) {
  const orgId = useOrg();
  const qc = useClient();
  return useQuery({ queryKey: key(orgId, 'locations', projectId), queryFn: () => dal.listSiteLocations(projectId), enabled: Boolean(orgId) && enabled, retry: false }, qc);
}
export function useWorkOrderSiteLocation(workOrderId: string, enabled: boolean) {
  const orgId = useOrg();
  const qc = useClient();
  return useQuery({ queryKey: key(orgId, 'wo-location', workOrderId), queryFn: () => dal.getWorkOrderSiteLocation(workOrderId), enabled: Boolean(orgId) && enabled, retry: false }, qc);
}
export function useConsumableFlags(enabled: boolean) {
  const orgId = useOrg();
  const qc = useClient();
  return useQuery({ queryKey: key(orgId, 'consumable-flags'), queryFn: dal.listConsumableFlags, enabled: Boolean(orgId) && enabled, retry: false }, qc);
}
export function useDsrStockMutations() {
  const qc = useClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['dsr-stock-issue'] });
  return {
    setSettings: useMutation({ mutationFn: (v: { enabled: boolean; items: dal.DsrStockItems }) => dal.setDsrStockSettings(v.enabled, v.items), onSuccess: refresh }, qc),
    setLocation: useMutation({ mutationFn: (v: { workOrderId: string; warehouseId: string | null }) => dal.setWorkOrderSiteLocation(v.workOrderId, v.warehouseId), onSuccess: refresh }, qc),
    setConsumable: useMutation({ mutationFn: (v: { itemId: string; consumable: boolean }) => dal.setItemConsumable(v.itemId, v.consumable), onSuccess: refresh }, qc),
  };
}
