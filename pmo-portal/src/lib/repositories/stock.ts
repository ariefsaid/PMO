/** Stock repository implementation (#1512 S1). */
import {
  listStockUnits, listStockItems, listStockWarehouses, listWarehouseKeepers, createStockUnit, updateStockUnit,
  createStockItem, updateStockItem, createStockWarehouse, updateStockWarehouse, setArchived as setStockArchived,
  setWarehouseKeeper,
} from '@/src/lib/db/stockMaster';
import {
  cancelStockDocument, createStockDocument, getStockDocument, listIssuableWorkItems, listProjectIssueLines, listStockDocuments, postStockDocument, saveStockDraft,
} from '@/src/lib/db/stockDocuments';
import { getStockLedgerAll, getStockLedgerPage, getStockOnHand } from '@/src/lib/db/stockReports';
import { wrap } from './repositoryErrors';
import type { StockRepository } from './contracts/stock';

export const stockRepository: StockRepository = {
  master: {
    listUnits: (i) => wrap(() => listStockUnits(i)),
    listItems: (i) => wrap(() => listStockItems(i)),
    listWarehouses: (i) => wrap(() => listStockWarehouses(i)),
    listKeepers: () => wrap(() => listWarehouseKeepers()),
    createUnit: (i) => wrap(() => createStockUnit(i)),
    updateUnit: (id, i) => wrap(() => updateStockUnit(id, i)),
    createItem: (i) => wrap(() => createStockItem(i)),
    updateItem: (id, i) => wrap(() => updateStockItem(id, i)),
    createWarehouse: (i) => wrap(() => createStockWarehouse(i)),
    updateWarehouse: (id, i) => wrap(() => updateStockWarehouse(id, i)),
    archive: (table, id, archived) => wrap(() => setStockArchived(table, id, archived)),
    setKeeper: (a) => wrap(() => setWarehouseKeeper(a)),
  },
  documents: {
    list: (f) => wrap(() => listStockDocuments(f)),
    get: (id) => wrap(() => getStockDocument(id)),
    create: (i, o) => wrap(() => createStockDocument(i, o)),
    saveDraft: (id, i) => wrap(() => saveStockDraft(id, i)),
    post: (id) => wrap(() => postStockDocument(id)),
    cancel: (id) => wrap(() => cancelStockDocument(id)),
    issuableWorkItems: (p) => wrap(() => listIssuableWorkItems(p)),
    issueLines: (p) => wrap(() => listProjectIssueLines(p)),
  },
  reports: {
    onHand: (f) => wrap(() => getStockOnHand(f)),
    ledgerPage: (f) => wrap(() => getStockLedgerPage(f)),
    ledgerAll: (f) => wrap(() => getStockLedgerAll(f)),
  },
};
