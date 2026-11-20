/** repositories/stockSiteWork.ts (#2523) — the seam over stock tags, document attachments and the per-work-order balance (ADR-0017). */
import {
  addStockDocumentFile, archiveStockDocumentFile, createStockTag, deleteStockDocumentFile, getWorkOrderStockBalance,
  listStockDocumentFiles, listStockTags, setStockTagArchived, updateStockTag, uploadStockDocumentFile, stockDocumentFileUrl,
  type StockDocumentFileRow, type StockTagInput, type StockTagRow, type WorkOrderStockRow,
} from '@/src/lib/db/stockSiteWork';
import { wrap } from './repositoryErrors';

export type { StockDocumentFileRow, StockTagInput, StockTagRow, WorkOrderStockRow };

export const stockSiteWorkRepository = {
  tags: {
    list: (includeArchived = false) => wrap(() => listStockTags(includeArchived)),
    create: (i: StockTagInput) => wrap(() => createStockTag(i)),
    update: (id: string, i: StockTagInput) => wrap(() => updateStockTag(id, i)),
    archive: (id: string, archived: boolean) => wrap(() => setStockTagArchived(id, archived)),
  },
  files: {
    list: (documentId: string) => wrap(() => listStockDocumentFiles(documentId)),
    upload: (orgId: string, documentId: string, file: File, label: string | null) => wrap(() => uploadStockDocumentFile(orgId, documentId, file, label)),
    download: (path: string) => wrap(() => stockDocumentFileUrl(path)),
    add: (a: { documentId: string; filePath: string; label: string | null }) => wrap(() => addStockDocumentFile(a)),
    remove: (id: string, filePath: string) => wrap(() => deleteStockDocumentFile(id, filePath)),
    archive: (id: string, reason: string) => wrap(() => archiveStockDocumentFile(id, reason)),
  },
  balance: (f: { workOrderId?: string; projectId?: string }) => wrap(() => getWorkOrderStockBalance(f)),
};
