/** repositories/headcount.ts — the seam over daily head counts (ADR-0017). Errors keep their Postgres code via `wrap`. */
import {
  approveHeadcount, attachHeadcountDocument, clearHeadcount, detachHeadcountDocument, headcountProjectId, listHeadcountDay, listHeadcountEvidence, recordHeadcount,
  type HeadcountEvidence, type HeadcountInput, type HeadcountLine,
} from '@/src/lib/db/headcount';
import { wrap } from './repositoryErrors';

export type { HeadcountEvidence, HeadcountInput, HeadcountLine };

export const headcountRepository = {
  day: (workOrderId: string, date: string) => wrap(() => listHeadcountDay(workOrderId, date)),
  record: (input: HeadcountInput) => wrap(() => recordHeadcount(input)),
  approve: (id: string) => wrap(() => approveHeadcount(id)),
  clear: (id: string) => wrap(() => clearHeadcount(id)),
  evidence: (headcountIds: string[]) => wrap(() => listHeadcountEvidence(headcountIds)),
  attachDocument: (headcountId: string, documentId: string) => wrap(() => attachHeadcountDocument(headcountId, documentId)),
  detachDocument: (id: string) => wrap(() => detachHeadcountDocument(id)),
  projectId: (workOrderId: string) => wrap(() => headcountProjectId(workOrderId)),
};
