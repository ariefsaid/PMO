/**
 * #895 FR-MJE-025 / -028 — reversing one posted journal on Odoo, once. The reversal is its own PMO journal row with its own key
 * (`journal-rev:<id>`); the original's Odoo move rides in `reverses`. Odoo accepts a second reversal of the same move (V-ACD2),
 * so the original's `reversal_move_ids` are read FIRST:
 * - one anchored with this key: ours (a retry, or a lost answer after the anchor) and is adopted;
 * - any other: refused `reversal-exists`, naming it, and no second reversal is ever sent;
 * - none: `account.move.reversal` + `refund_moves`, always sending the date and the reason, then the external identifier is
 *   written on the returned `res_id` and the reversal is read back. Dated after today it is a draft Odoo posts on its day:
 *   `scheduled`, never shown Posted.
 */
import { AdapterError, type CommandResult } from '../../contract.ts';
import { assertLedgerJournal, type LedgerJournal } from '../../ledgerJournal.ts';
import type { OdooCall } from '../client.ts';
import { parseOdooExternalRef } from '../purchase/anchors.ts';
import { anchorMove, guardedCall, MOVE_MODEL, probeJournalByAnchor, settleAndReadBack } from './readBack.ts';

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const many2oneId = (v: unknown): number | null => (Array.isArray(v) ? Number(v[0]) : typeof v === 'number' ? v : null);
const moveIdOf = (externalRecordId: string): number => Number(externalRecordId.slice(MOVE_MODEL.length + 1));

interface OriginalRow { name: string | false; state: string; journal_id: unknown; reversal_move_ids: unknown }

/** The anchored reversal of this key, finished and read back; null when none carries it (the outbox then holds, OBS-ACD-002). */
export async function recoverOdooReversal(raw: OdooCall, journal: LedgerJournal, today: string): Promise<CommandResult | null> {
  const call = guardedCall(raw);
  const hit = await probeJournalByAnchor(call, journal.key);
  return hit ? settleAndReadBack(call, journal, moveIdOf(hit.externalRecordId), today, journal.date <= today) : null;
}

export async function reverseOdooJournal(raw: OdooCall, journal: LedgerJournal, today: string): Promise<CommandResult> {
  const call = guardedCall(raw);
  if (!journal.reverses) return refuse('journal-is-not-a-reversal');
  try { assertLedgerJournal(journal); } catch (e) { refuse((e as Error).message); }
  const originalId = parseOdooExternalRef(MOVE_MODEL, journal.reverses.externalRecordId) ?? refuse('journal-original-not-an-odoo-move');
  const [original] = await call<OriginalRow[]>(MOVE_MODEL, 'read', { ids: [originalId], fields: ['name', 'state', 'journal_id', 'reversal_move_ids'] });
  if (!original) return refuse('journal-original-missing');
  if (original.state !== 'posted') return refuse('journal-original-not-posted');

  const existing = Array.isArray(original.reversal_move_ids) ? original.reversal_move_ids.map(Number) : [];
  if (existing.length > 0) {
    const hit = await probeJournalByAnchor(call, journal.key);
    const ours = hit ? moveIdOf(hit.externalRecordId) : null;
    if (ours !== null && existing.includes(ours)) return settleAndReadBack(call, journal, ours, today, journal.date <= today);
    const other = existing.find((id) => id !== ours) ?? existing[0];
    const [row] = await call<Array<{ name: string | false }>>(MOVE_MODEL, 'read', { ids: [other], fields: ['name'] });
    return refuse(`reversal-exists: ${row?.name || `account.move ${other}`}`);
  }

  const context = { active_model: MOVE_MODEL, active_ids: [originalId] };
  const journalId = many2oneId(original.journal_id);
  const [wizard] = await call<number[]>('account.move.reversal', 'create', {
    vals_list: [{ date: journal.date, reason: journal.reverses.reason, ...(journalId ? { journal_id: journalId } : {}) }], context,
  });
  const action = await call<{ res_id?: unknown }>('account.move.reversal', 'refund_moves', { ids: [wizard], context });
  const reversalId = Number(action?.res_id);
  if (!Number.isInteger(reversalId) || reversalId <= 0) return refuse('journal-reversal-id-missing');
  await anchorMove(call, journal.key, reversalId);
  return settleAndReadBack(call, journal, reversalId, today, journal.date <= today);
}
