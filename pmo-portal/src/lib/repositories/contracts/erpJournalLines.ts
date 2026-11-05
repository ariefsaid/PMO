/** ERP journal cost lines contract (#1919, link only). */
import type { ErpJournalAttachResponse, ErpJournalAttachRow, ErpJournalLine } from '../erpJournalLines';

export interface ErpJournalLineRepository {
  listProject(projectId: string): Promise<ErpJournalLine[]>;
  listForPurchase(procurementId: string, projectId: string): Promise<ErpJournalLine[]>;
  attach(rows: ErpJournalAttachRow[], dryRun?: boolean): Promise<ErpJournalAttachResponse>;
  detach(linkId: string): Promise<void>;
}
