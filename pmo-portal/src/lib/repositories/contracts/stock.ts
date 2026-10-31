/** Stock repository contract (#1512 S1). */
import type {
  StockItemInput, StockItemRow, StockKeeperRow, StockUnitInput, StockUnitRow, StockWarehouseInput, StockWarehouseRow,
} from '@/src/lib/db/stockMaster';
import type {
  IssuableWorkItem, IssueLineRow, StockDocumentDetail, StockDocumentFilters, StockDocumentInput, StockDocumentListRow,
} from '@/src/lib/db/stockDocuments';
import type { StockLedgerFilters, StockLedgerPage, StockLedgerRow, StockOnHandRow } from '@/src/lib/db/stockReports';

/** Stock master data (#1512 S1): units, items, warehouses and keepers.  */
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

/** Stock documents (#1512 S3): the posting RPCs and the document reads. No client write grant exists; every write is an RPC. */
export interface StockDocumentsRepository {
  list(f?: StockDocumentFilters): Promise<StockDocumentListRow[]>;
  get(id: string): Promise<StockDocumentDetail | null>;
  create(input: StockDocumentInput, opts: { post: boolean; clientRequestId: string }): Promise<string>;
  saveDraft(id: string, input: StockDocumentInput): Promise<void>;
  post(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  issuableWorkItems(projectId: string): Promise<IssuableWorkItem[]>;
  /** Posted issue lines of a project: what a Return may cite. */
  issueLines(projectId: string): Promise<IssueLineRow[]>;
}

/** Stock reads (#1512 S3): cost keys are absent from the data below Project Manager rank. */
export interface StockReportsRepository {
  onHand(f: { warehouseId?: string; itemId?: string; includeZero?: boolean }): Promise<StockOnHandRow[]>;
  ledgerPage(f: StockLedgerFilters & { beforeSeq?: number; limit?: number }): Promise<StockLedgerPage>;
  ledgerAll(f: StockLedgerFilters): Promise<StockLedgerRow[]>;
}

export interface StockRepository {
  master: StockMasterRepository;
  documents: StockDocumentsRepository;
  reports: StockReportsRepository;
}
