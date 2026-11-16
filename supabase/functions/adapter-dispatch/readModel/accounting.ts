/**
 * #895 — the `accounting` (manual journal) writer. A journal is PMO-authored and the ledger holds the posted copy, so
 * finalizing writes only the ledger's answer back onto the journal through the service-role outcome writer
 * `record_journal_outcome` (0887): the ledger ref, its document number, and the date the READ-BACK found — never the
 * request's date (Odoo silently re-dates a post inside a locked period, FR-MJE-027). A scheduled reversal (dated after
 * today, still draft in the ledger) records `scheduled` and no posted date (FR-MJE-028).
 */
import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { ReadModelWriter } from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export const accountingWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const status = canonical.status;
    if (status !== 'posted' && status !== 'scheduled') throw new AppError(`not a ledger outcome: ${String(status)}`, 'commit-rejected');
    const ref = str(canonical.external_record_id);
    if (!ref) throw new AppError('the ledger answer has no reference', 'commit-rejected');
    const postedDate = str(canonical.posted_date);
    if (status === 'posted' && (!postedDate || !DATE.test(postedDate))) {
      throw new AppError('the ledger answer has no ledger date', 'commit-rejected');
    }
    const { error } = await ctx.serviceClient.rpc('record_journal_outcome', {
      p_id: String(canonical.id ?? command.record.id),
      p_status: status,
      p_external_record_id: ref,
      p_external_name: str(canonical.ledger_name),
      p_posted_date: status === 'posted' ? postedDate : null,
      p_reason: null,
    });
    if (error) throw new AppError(error.message, error.code);
  },
};

/** The hold/refusal half: a `command-held` answer (read-back mismatch, inconclusive probe) shows Needs a check. */
export async function recordJournalHold(
  serviceClient: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> },
  journalId: string, status: 'held' | 'refused' | 'sending', reason: string | null,
): Promise<void> {
  const { error } = await serviceClient.rpc('record_journal_outcome', {
    p_id: journalId, p_status: status, p_external_record_id: null, p_external_name: null, p_posted_date: null, p_reason: reason,
  });
  if (error) throw new AppError(error.message, error.code);
}
