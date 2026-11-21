/** Work-order close-out checklist (#2593): the organisation's list and each issued work order's copy. The close rule is the database's. */
import type { CloseoutTemplateItem, WorkOrderCloseoutItem } from '@/src/lib/db/closeoutChecklist';

export interface CloseoutChecklistRepository {
  getTemplate(): Promise<CloseoutTemplateItem[]>;
  setTemplate(items: CloseoutTemplateItem[]): Promise<number>;
  listItems(workOrderId: string): Promise<WorkOrderCloseoutItem[]>;
  attachDocument(itemId: string, documentId: string): Promise<void>;
  completeItem(itemId: string, doneOn: string): Promise<void>;
}
