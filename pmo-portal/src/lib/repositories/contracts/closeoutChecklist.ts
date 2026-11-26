/** Work-order close-out checklist (#2593): the organisation's list and each issued work order's copy. The close rule is the database's. */
import type { CloseoutTemplateItem, WaitingCloseoutItem, WorkOrderCloseoutItem, WorkOrderCloser, OpenCloseoutDueRow } from '@/src/lib/db/closeoutChecklist';

export interface CloseoutChecklistRepository {
  assignOwner(itemId: string, ownerRole: string): Promise<void>;
  getTemplate(): Promise<CloseoutTemplateItem[]>;
  setTemplate(items: CloseoutTemplateItem[]): Promise<number>;
  listItems(workOrderId: string): Promise<WorkOrderCloseoutItem[]>;
  /** Open, targeted items on Issued work orders — one batch read for the work-orders list's overdue count (#2800). */
  listOpenDue(): Promise<OpenCloseoutDueRow[]>;
  /** The viewer's waiting close-out items (#2907): open items whose owner job role they hold. */
  waitingItems(): Promise<WaitingCloseoutItem[]>;
  getCloser(workOrderId: string): Promise<WorkOrderCloser | null>;
  attachDocument(itemId: string, documentId: string): Promise<void>;
  completeItem(itemId: string, doneOn: string): Promise<void>;
}
