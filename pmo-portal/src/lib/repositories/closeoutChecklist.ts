import {
  attachCloseoutItemDocument, completeCloseoutItem, getCloseoutTemplate, listWorkOrderCloseoutItems, setCloseoutTemplate,
} from '@/src/lib/db/closeoutChecklist';
import { wrap } from './repositoryErrors';
import type { CloseoutChecklistRepository } from './contracts/closeoutChecklist';

/** Work-order close-out checklist (#2593). Every rule, the order, the documents and the close guard, lives in the database (1400–1402). */
export const closeoutChecklistRepository: CloseoutChecklistRepository = {
  getTemplate: () => wrap(() => getCloseoutTemplate()),
  setTemplate: (items) => wrap(() => setCloseoutTemplate(items)),
  listItems: (workOrderId) => wrap(() => listWorkOrderCloseoutItems(workOrderId)),
  attachDocument: (itemId, documentId) => wrap(() => attachCloseoutItemDocument(itemId, documentId)),
  completeItem: (itemId, doneOn) => wrap(() => completeCloseoutItem(itemId, doneOn)),
};
