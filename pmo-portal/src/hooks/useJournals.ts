import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { JournalDraftInput } from '@/src/lib/db/journals';
import { ApprovedSendFailure } from '@/src/lib/journals/approvedSendFailure';

/** Manual journals (#895) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const JOURNAL_QUERY_ROOTS = ['journals', 'journal', 'journal-ledger-setup'] as const;

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

export function useJournals(from: string, to: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['journals', orgId, from, to],
    queryFn: () => repositories.journal.list(from, to),
    enabled: Boolean(orgId) && Boolean(from) && Boolean(to),
  });
}
export function useJournal(id: string | null | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['journal', orgId, id],
    queryFn: () => repositories.journal.get(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}
/** Whether the server's approver rule lets this viewer approve the journal (the sole-member exception lives there). */
export function useMayApproveJournal(id: string | null | undefined, approverId: string | null | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['journal', orgId, id, 'may-approve', approverId],
    queryFn: () => repositories.journal.mayApprove(id as string),
    enabled: Boolean(orgId) && Boolean(id) && Boolean(approverId),
  });
}
export function useJournalLedgerSetup() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['journal-ledger-setup', orgId], queryFn: () => repositories.journal.ledgerSetup(), enabled: Boolean(orgId) });
}

/** Every journal write refreshes every journal read: the list and the open record show one set of facts. */
function useJournalMutation<A, R>(fn: (a: A) => Promise<R>, extraRoots: readonly string[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // On settle, not success: an approval whose ledger send failed has still changed the journal.
    onSettled: () => {
      for (const root of [...JOURNAL_QUERY_ROOTS, ...extraRoots]) void qc.invalidateQueries({ queryKey: [root] });
    },
  });
}

export const useSaveJournalDraft = () => useJournalMutation((input: JournalDraftInput) => repositories.journal.saveDraft(input));
export const useSubmitJournal = () => useJournalMutation((id: string) => repositories.journal.submit(id));
/** Approve, then send it to the ledger. A send that fails leaves the journal approved (or Needs a check) and throws
 *  `ApprovedSendFailure`, so the caller offers a retry of the send only; it is sent again with `usePostJournal`. */
export const useApproveJournal = () => useJournalMutation(async (id: string) => {
  await repositories.journal.approve(id);
  try {
    await repositories.journal.post(id);
  } catch (err) {
    throw new ApprovedSendFailure(err);
  }
});
export const usePostJournal = () => useJournalMutation((id: string) => repositories.journal.post(id));
export const useReturnJournal = () => useJournalMutation((a: { id: string; reason: string }) => repositories.journal.returnToMaker(a.id, a.reason));
export const useRequestJournalReversal = () => useJournalMutation((a: { id: string; date: string; reason: string }) =>
  repositories.journal.requestReversal(a.id, a.date, a.reason));
/** Admin, Odoo setup (owner ruling 4): also refreshes the Odoo connection read so the checklist step shows Done. */
export const useSetDeskJournal = () => useJournalMutation((journalId: string) => repositories.journal.setDeskJournal(journalId), ['odoo']);
