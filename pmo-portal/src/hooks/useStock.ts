import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { StockItemInput, StockUnitInput, StockWarehouseInput } from '@/src/lib/db/stockMaster';

/** Stock master data reads (#1512 S1). Every key carries the org id so the cache is tenant-scoped. */
export function useStockUnits(includeArchived = false) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-units', orgId, includeArchived], queryFn: () => repositories.stock.master.listUnits(includeArchived), enabled: Boolean(orgId) });
}
export function useStockItems(includeArchived = false) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-items', orgId, includeArchived], queryFn: () => repositories.stock.master.listItems(includeArchived), enabled: Boolean(orgId) });
}
export function useStockWarehouses(includeArchived = false) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-warehouses', orgId, includeArchived], queryFn: () => repositories.stock.master.listWarehouses(includeArchived), enabled: Boolean(orgId) });
}
export function useStockKeepers() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-keepers', orgId], queryFn: () => repositories.stock.master.listKeepers(), enabled: Boolean(orgId) });
}

type MasterTable = 'stock_units' | 'stock_items' | 'stock_warehouses';
const KEY: Record<MasterTable, string> = { stock_units: 'stock-units', stock_items: 'stock-items', stock_warehouses: 'stock-warehouses' };

/** Master-data writes; each invalidates its own list (a unit change also moves the item list, which shows the unit). */
export function useStockMasterMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const m = repositories.stock.master;
  const refresh = (...keys: string[]) => () => { for (const k of keys) void qc.invalidateQueries({ queryKey: [k, orgId] }); };
  return {
    createUnit: useMutation({ mutationFn: (i: StockUnitInput) => m.createUnit(i), onSuccess: refresh('stock-units') }),
    updateUnit: useMutation({ mutationFn: (a: { id: string; input: StockUnitInput }) => m.updateUnit(a.id, a.input), onSuccess: refresh('stock-units', 'stock-items') }),
    createItem: useMutation({ mutationFn: (i: StockItemInput) => m.createItem(i), onSuccess: refresh('stock-items') }),
    updateItem: useMutation({ mutationFn: (a: { id: string; input: StockItemInput }) => m.updateItem(a.id, a.input), onSuccess: refresh('stock-items') }),
    createWarehouse: useMutation({ mutationFn: (i: StockWarehouseInput) => m.createWarehouse(i), onSuccess: refresh('stock-warehouses') }),
    updateWarehouse: useMutation({ mutationFn: (a: { id: string; input: StockWarehouseInput }) => m.updateWarehouse(a.id, a.input), onSuccess: refresh('stock-warehouses') }),
    archive: useMutation({
      mutationFn: (a: { table: MasterTable; id: string; archived: boolean }) => m.archive(a.table, a.id, a.archived),
      onSuccess: (_d, a) => refresh(KEY[a.table], ...(a.table === 'stock_units' ? ['stock-items'] : []))(),
    }),
    setKeeper: useMutation({ mutationFn: (a: { warehouseId: string; userId: string; assigned: boolean }) => m.setKeeper(a), onSuccess: refresh('stock-keepers') }),
  };
}

/** Active org members a warehouse keeper can be picked from (RLS scopes the org). */
export function useStockKeeperCandidates() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['stock-keeper-candidates', orgId],
    queryFn: async () => (await repositories.profile.listOrgProfiles()).filter((p) => p.status === 'active'),
    enabled: Boolean(orgId),
  });
}
