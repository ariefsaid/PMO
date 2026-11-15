/**
 * #895 FR-ACD-027 — the Odoo half of the journal read-back: read the move Odoo holds and its line sums, judge them against what
 * was sent (`judgeReadBack`, tier-agnostic), and either answer the canonical PMO result or HOLD. A hold is an
 * `AppError('command-held')`, which `dispatchMoneyWrite` turns into `markOutboxHeld`, so a re-dated or altered post shows as
 * "Needs a check", never Posted. Shared by the post (adapter.ts) and the reversal (reversal.ts).
 */
import { AppError } from '../../../appError.ts';
import { AdapterError, type CommandResult } from '../../contract.ts';
import { JOURNAL_KEY_RE, JOURNAL_REVERSAL_KEY_RE, type LedgerJournal } from '../../ledgerJournal.ts';
import { judgeReadBack, type PostedJournalRead } from '../../ledgerJournalReadBack.ts';
import type { OdooCall } from '../client.ts';
import { toAdapterError } from '../connectAdapter.ts';
import { formatCents, nanoToCents, toNano } from '../ledger/cents.ts';
import { externalIdentifier, odooExternalRef } from '../purchase/anchors.ts';

export const MOVE_MODEL = 'account.move';

/** Odoo failures become contract errors (transient vs rejected); the message is the class, never Odoo's text. */
export const guardedCall = (call: OdooCall): OdooCall => async (model, method, body) => {
  try { return await call(model, method, body); } catch (err) { return toAdapterError(err); }
};

/** The PMO journal row a key names: `journal:<id>` the journal, `journal-rev:<id>` the reversal journal (FR-ACD-025). */
export function journalIdOfKey(key: string): string {
  if (!JOURNAL_KEY_RE.test(key) && !JOURNAL_REVERSAL_KEY_RE.test(key)) throw new AdapterError('commit-rejected', 'journal-key-invalid');
  return key.slice(key.indexOf(':') + 1).toLowerCase();
}

/** The move this key anchored (`ir.model.data`, module `pmo`), or null. Never `ref`: V-ACD1 shows the same ref twice posts twice. */
export async function probeJournalByAnchor(call: OdooCall, key: string): Promise<{ externalRecordId: string } | null> {
  journalIdOfKey(key);
  const { module, name } = externalIdentifier(key);
  const rows = await call<Array<{ res_id: number }>>('ir.model.data', 'search_read', {
    domain: [['module', '=', module], ['name', '=', name], ['model', '=', MOVE_MODEL]], fields: ['res_id'], limit: 2,
  });
  if (rows.length > 1) throw new AdapterError('commit-rejected', 'ambiguous-anchor');
  return rows.length === 1 ? { externalRecordId: odooExternalRef(MOVE_MODEL, rows[0].res_id) } : null;
}

/** Writes the external identifier that anchors this key to the move. */
export async function anchorMove(call: OdooCall, key: string, moveId: number): Promise<void> {
  const { module, name } = externalIdentifier(key);
  await call('ir.model.data', 'create', { vals_list: [{ module, name, model: MOVE_MODEL, res_id: moveId }] });
}

interface MoveRow { name: string | false; state: PostedJournalRead['state']; date: string; ref: string | false }

const sum = (values: unknown[]): string => formatCents(values.reduce<bigint>((acc, v) => {
  const nano = toNano(v);
  if (nano === null) throw new AdapterError('commit-rejected', 'journal-readback-amount-invalid');
  return acc + nanoToCents(nano);
}, 0n));

export async function readMove(call: OdooCall, moveId: number): Promise<PostedJournalRead & { name: string | null }> {
  const [move] = await call<MoveRow[]>(MOVE_MODEL, 'read', { ids: [moveId], fields: ['name', 'state', 'date', 'ref'] });
  if (!move) throw new AdapterError('commit-rejected', 'journal-move-missing');
  const lines = await call<Array<{ debit: unknown; credit: unknown }>>('account.move.line', 'search_read', {
    domain: [['move_id', '=', moveId]], fields: ['debit', 'credit'],
  });
  return {
    date: move.date, state: move.state, ref: move.ref || null, name: move.name || null,
    debit: sum(lines.map((l) => l.debit)), credit: sum(lines.map((l) => l.credit)),
  };
}

/**
 * Brings the move to its settled state and judges it. `postDraft`: post a draft first (a manual journal); a reversal dated after
 * today stays a draft on purpose (Odoo auto-posts it on its day) and reads as `scheduled`.
 */
export async function settleAndReadBack(call: OdooCall, journal: LedgerJournal, moveId: number, today: string, postDraft: boolean): Promise<CommandResult> {
  let read = await readMove(call, moveId);
  if (read.state === 'draft' && postDraft) {
    await call(MOVE_MODEL, 'action_post', { ids: [moveId] });
    read = await readMove(call, moveId);
  }
  const verdict = judgeReadBack(journal, read, today);
  if (verdict.kind === 'mismatch') throw new AppError(verdict.reason, 'command-held');
  const externalRecordId = odooExternalRef(MOVE_MODEL, moveId);
  return {
    externalRecordId,
    // The dispatch's journal result contract: `posted_date` is the ledger's own date from this read, never the request's.
    canonical: {
      id: journalIdOfKey(journal.key),
      status: verdict.kind,
      external_record_id: externalRecordId,
      ledger_name: read.name,
      posted_date: verdict.kind === 'posted' ? read.date : null,
    },
  };
}
