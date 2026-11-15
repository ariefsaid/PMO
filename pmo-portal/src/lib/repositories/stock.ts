/** Stock repository implementation (#1512 S1). */
import {
  listStockUnits, listStockItems, listStockWarehouses, listWarehouseKeepers, createStockUnit, updateStockUnit,
  createStockItem, updateStockItem, createStockWarehouse, updateStockWarehouse, setArchived as setStockArchived,
  setWarehouseKeeper,
} from '@/src/lib/db/stockMaster';
import {
  cancelStockDocument, countStockDocuments, createStockDocument, getStockDocument, getStockDocumentCosts, getStockErpState, releaseStockHold, listIssuableWorkItems, listProjectIssueLines, listStockDocuments, postStockDocument, saveStockDraft,
} from '@/src/lib/db/stockDocuments';
import { getProjectConsumption, getStockLedgerAll, getStockLedgerPage, getStockOnHand } from '@/src/lib/db/stockReports';
import { clearAllowance, listAllowances, setAllowance } from '@/src/lib/db/stockAllowances';
import { getBelowReorder, getReorderSuggestion, setReorderLevel } from '@/src/lib/db/stockReorder';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { INVENTORY_DOMAIN, STOCK_DOC_KIND } from '@/src/lib/adapterSeam/odoo/stock/constants';
import { AppError } from '@/src/lib/appError';
import { StockDispatchError } from '@/src/lib/stockDispatchError';
import { wrap } from './repositoryErrors';
import type { StockRepository } from './contracts/stock';

/** A connected org posts a transfer or an issue through the Odoo dispatch; every other kind keeps the RPC (which refuses it while the ERP owns stock). */
const connectedKind = (kind: string): boolean => kind === 'transfer' || kind === 'issue';
const dispatchPost = (id: string, revision: number) => dispatchDomainCommand(INVENTORY_DOMAIN, 'create', { id, revision, erp_doc_kind: STOCK_DOC_KIND });

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
    count: (f) => wrap(() => countStockDocuments(f)),
    get: (id) => wrap(() => getStockDocument(id)),
    // Connected: save the Draft first (no post), then dispatch with the revision the keeper just saved.
    create: async (i, o) => {
      if (!o.post || routeDomainWrite(INVENTORY_DOMAIN) !== 'external' || !connectedKind(i.kind)) return wrap(() => createStockDocument(i, o));
      const id = await wrap(() => createStockDocument(i, { ...o, post: false }));
      const saved = await wrap(() => getStockDocument(id));
      if (!saved) throw new AppError('The saved stock document could not be read back', 'not-found');
      try { await wrap(() => dispatchPost(id, saved.revision)); } catch (err) { throw new StockDispatchError(err as AppError, id); }
      return id;
    },
    saveDraft: (id, i) => wrap(() => saveStockDraft(id, i)),
    post: async (id, revision) => {
      if (routeDomainWrite(INVENTORY_DOMAIN) !== 'external') return wrap(() => postStockDocument(id, revision));
      const doc = await wrap(() => getStockDocument(id));
      if (!doc || !connectedKind(doc.kind)) return wrap(() => postStockDocument(id, revision));
      await wrap(() => dispatchPost(id, revision ?? doc.revision));
    },
    erpState: (id) => wrap(() => getStockErpState(id)),
    releaseHold: (commandId) => wrap(() => releaseStockHold(commandId)),
    costs: (id) => wrap(() => getStockDocumentCosts(id)),
    cancel: (id) => wrap(() => cancelStockDocument(id)),
    issuableWorkItems: (p) => wrap(() => listIssuableWorkItems(p)),
    issueLines: (p) => wrap(() => listProjectIssueLines(p)),
  },
  reports: {
    onHand: (f) => wrap(() => getStockOnHand(f)),
    ledgerPage: (f) => wrap(() => getStockLedgerPage(f)),
    ledgerAll: (f) => wrap(() => getStockLedgerAll(f)),
  },
  consumption: {
    report: (p, from, to) => wrap(() => getProjectConsumption(p, from, to)),
  },
  allowances: {
    list: (p) => wrap(() => listAllowances(p)),
    set: (i) => wrap(() => setAllowance(i)),
    clear: (id) => wrap(() => clearAllowance(id)),
  },
  reorder: {
    suggestion: (w, i) => wrap(() => getReorderSuggestion(w, i)),
    worklist: () => wrap(() => getBelowReorder()),
    setLevel: (a) => wrap(() => setReorderLevel(a)),
  },
};
