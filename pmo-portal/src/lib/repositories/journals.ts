/** Manual journals repository (#895, ADR-0017): the API seam over the journals DAL. Thin by design: the RPCs hold every rule. */
import * as dal from '@/src/lib/db/journals';
import { wrap } from './repositoryErrors';
import type { JournalRepository } from './contracts/journals';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import { journalKey } from '@/src/lib/adapterSeam/ledgerJournal';

export const journalRepository: JournalRepository = {
  list: (from, to) => wrap(() => dal.listJournals(from, to)),
  get: (id) => wrap(() => dal.getJournal(id)),
  mayApprove: (id, approverId) => wrap(() => dal.mayApproveJournal(id, approverId)),
  ledgerSetup: () => wrap(() => dal.getLedgerSetup()),
  saveDraft: (input) => wrap(() => dal.saveJournalDraft(input)),
  submit: (id) => wrap(() => dal.submitJournal(id)),
  approve: (id) => wrap(() => dal.approveJournal(id)),
  returnToMaker: (id, reason) => wrap(() => dal.returnJournal(id, reason)),
  requestReversal: (id, date, reason) => wrap(() => dal.requestJournalReversal(id, date, reason)),
  setDeskJournal: (journalId) => wrap(() => dal.setDeskJournal(journalId)),
  /** Send an approved journal to the ledger. Only the id travels: the dispatch re-reads the approved journal under the
   *  caller and builds the body, the key and the ledger refs from that read (journalGuard.ts); a reversal's key is
   *  derived there too, so the key sent here is only a well-formed placeholder the server replaces. */
  post: async (id) => {
    const canonical = id.toLowerCase();
    await dispatchDomainCommand('accounting', 'create', { id: canonical, erp_doc_kind: 'manual-journal' }, { idempotencyKey: journalKey(canonical) });
  },
};
