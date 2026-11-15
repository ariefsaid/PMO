/** Manual journals repository contract (#895). One-to-one with the DAL: the RPCs hold every rule. */
import type * as dal from '@/src/lib/db/journals';

export interface JournalRepository {
  list: typeof dal.listJournals;
  get: typeof dal.getJournal;
  mayApprove: typeof dal.mayApproveJournal;
  ledgerSetup: typeof dal.getLedgerSetup;
  saveDraft: typeof dal.saveJournalDraft;
  submit: typeof dal.submitJournal;
  approve: typeof dal.approveJournal;
  /** Return to the maker with a reason (`return` is reserved). */
  returnToMaker: typeof dal.returnJournal;
  requestReversal: typeof dal.requestJournalReversal;
  setDeskJournal: typeof dal.setDeskJournal;
  /** Send an approved (or held) journal to the ledger through the money outbox (#895 FR-MJE-022). */
  post: (id: string) => Promise<void>;
}
