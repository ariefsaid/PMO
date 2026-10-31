/** Stock repository contract (#1512 S1). */
import type {
  StockItemInput, StockItemRow, StockKeeperRow, StockUnitInput, StockUnitRow, StockWarehouseInput, StockWarehouseRow,
} from '@/src/lib/db/stockMaster';

/** Stock master data (#1512 S1): units, items, warehouses and keepers. Later slices add `documents` and `reports`. */
export interface StockMasterRepository {
  listUnits(includeArchived?: boolean): Promise<StockUnitRow[]>;
  listItems(includeArchived?: boolean): Promise<StockItemRow[]>;
  listWarehouses(includeArchived?: boolean): Promise<StockWarehouseRow[]>;
  listKeepers(): Promise<StockKeeperRow[]>;
  createUnit(input: StockUnitInput): Promise<StockUnitRow>;
  updateUnit(id: string, input: StockUnitInput): Promise<void>;
  createItem(input: StockItemInput): Promise<StockItemRow>;
  updateItem(id: string, input: StockItemInput): Promise<void>;
  createWarehouse(input: StockWarehouseInput): Promise<StockWarehouseRow>;
  updateWarehouse(id: string, input: StockWarehouseInput): Promise<void>;
  archive(table: 'stock_units' | 'stock_items' | 'stock_warehouses', id: string, archived: boolean): Promise<void>;
  /** Admin only (`set_stock_warehouse_keeper`); the keeper table has no client write grant. */
  setKeeper(a: { warehouseId: string; userId: string; assigned: boolean }): Promise<void>;
}

export interface StockRepository {
  master: StockMasterRepository;
}
