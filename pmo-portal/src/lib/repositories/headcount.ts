/** repositories/headcount.ts — the seam over daily head counts (ADR-0017). Errors keep their Postgres code via `wrap`. */
import { approveHeadcount, clearHeadcount, listHeadcountDay, recordHeadcount, type HeadcountInput, type HeadcountLine } from '@/src/lib/db/headcount';
import { wrap } from './repositoryErrors';

export type { HeadcountInput, HeadcountLine };

export const headcountRepository = {
  day: (workOrderId: string, date: string) => wrap(() => listHeadcountDay(workOrderId, date)),
  record: (input: HeadcountInput) => wrap(() => recordHeadcount(input)),
  approve: (id: string) => wrap(() => approveHeadcount(id)),
  clear: (id: string) => wrap(() => clearHeadcount(id)),
};
