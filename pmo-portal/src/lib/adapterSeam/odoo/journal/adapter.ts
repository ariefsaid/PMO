/**
 * #895 — the Odoo `Adapter` (contract.ts) for domain `accounting`: one approved PMO manual journal becomes one posted Odoo
 * `account.move` of type `entry`, exactly once. A command is create → anchor → post → read back:
 * - create: the body refuses everything it can before any write (balance, desk journal, ids; body.ts);
 * - anchor: the `ir.model.data` external identifier (module `pmo`) written right after the create, never `ref` (V-ACD1);
 * - post, then read the move back and judge it (`judgeReadBack`): a silent re-date inside a locked period (V-ACD4) HOLDS.
 *
 * Recovery (`recoverOdooJournal`) is the outbox probe adapter-dispatch runs on every claim: it finds the move by its anchor and
 * finishes it. A move created whose answer was lost before the anchor landed cannot be told from nothing, so an inconclusive miss
 * HOLDS for a person and is never reissued (OBS-ACD-002): holding can leave a journal waiting, reissuing can post it twice.
 */
import { AdapterError, type Adapter, type AdapterCommand, type CommandResult } from '../../contract.ts';
import type { LedgerJournal } from '../../ledgerJournal.ts';
import type { OdooCall } from '../client.ts';
import { ODOO_TIER } from '../connectAdapter.ts';
import { buildJournalMoveBody, odooJournalInput, type OdooJournalInput } from './body.ts';
import { anchorMove, guardedCall, journalIdOfKey, MOVE_MODEL, probeJournalByAnchor, settleAndReadBack } from './readBack.ts';
import { recoverOdooReversal, reverseOdooJournal } from './reversal.ts';

export { probeJournalByAnchor } from './readBack.ts';

export const ACCOUNTING_DOMAIN = 'accounting';

/**
 * OBS-ACD-002: on Odoo the anchor is a second write after the create, so a recovery that finds no anchor is inconclusive (the
 * move may exist without one). It holds; it is never reissued.
 */
export const ODOO_JOURNAL_REISSUE_ON_INCONCLUSIVE_ABSENCE = false;

export function odooJournalReissueOnInconclusiveAbsence(domain: string): boolean {
  if (domain !== ACCOUNTING_DOMAIN) throw new Error(`not a journal domain: ${domain}`);
  return ODOO_JOURNAL_REISSUE_ON_INCONCLUSIVE_ABSENCE;
}

export interface OdooJournalDeps {
  call: OdooCall;
  /** The Odoo binding's config; the record's `desk_journal_id` (re-read by the dispatch) is laid over it. */
  bindingConfig?: Record<string, unknown> | null;
  /** Override for tests: the journal input. Default: `odooJournalInput(command.record, bindingConfig)`, i.e. the dispatch record
   *  `{ id, erp_doc_kind: 'manual-journal', journal, desk_journal_id, account_ids }` (never the request payload). */
  resolveJournal?(command: AdapterCommand): Promise<OdooJournalInput>;
  /** The org's day, YYYY-MM-DD: a reversal dated after it is scheduled, not posted. Default: today in Asia/Jakarta. */
  today?(): string;
}

/** Today in the org's zone (Asia/Jakarta, UTC+7, no DST), YYYY-MM-DD. */
export const jakartaToday = (now = Date.now()): string => new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** Post one manual journal: create, anchor, post, read back. Every refusal the body can make comes before the create. */
export async function postOdooJournal(
  raw: OdooCall, journal: LedgerJournal, config: Record<string, unknown> | null, today: string, accountIds?: ReadonlyArray<string | null>,
): Promise<CommandResult> {
  const call = guardedCall(raw);
  if (journal.reverses) refuse('journal-is-a-reversal');
  const body = buildJournalMoveBody(journal, config, accountIds);
  const [moveId] = await call<number[]>(MOVE_MODEL, 'create', { vals_list: [body] });
  await anchorMove(call, journal.key, moveId);
  return settleAndReadBack(call, journal, moveId, today, true);
}

/** The outbox recovery probe: the move (or reversal) this key anchored, finished and read back; null when no anchor exists. */
export async function recoverOdooJournal(raw: OdooCall, journal: LedgerJournal, today: string): Promise<CommandResult | null> {
  const call = guardedCall(raw);
  if (journal.reverses) return recoverOdooReversal(call, journal, today);
  const hit = await probeJournalByAnchor(call, journal.key);
  if (!hit) return null;
  return settleAndReadBack(call, journal, Number(hit.externalRecordId.slice(MOVE_MODEL.length + 1)), today, true);
}

export function createOdooJournalAdapter(deps: OdooJournalDeps): Adapter {
  const call = guardedCall(deps.call);
  return {
    tier: ODOO_TIER,
    capabilityMap: new Set([ACCOUNTING_DOMAIN]),
    async commit(command) {
      if (command.domain !== ACCOUNTING_DOMAIN || command.operation !== 'create') refuse('journal-command-unsupported');
      const { journal, config, accountIds } = deps.resolveJournal
        ? await deps.resolveJournal(command)
        : odooJournalInput(command.record, deps.bindingConfig ?? null);
      if (command.idempotencyKey !== journal.key || journalIdOfKey(journal.key) !== String(command.record.id).toLowerCase()) refuse('journal-key-mismatch');
      const today = deps.today ? deps.today() : jakartaToday();
      return journal.reverses ? reverseOdooJournal(call, journal, today) : postOdooJournal(call, journal, config, today, accountIds);
    },
    // The journal's ledger reads are the desk's own (pieces 4 and 6), not adapter reads.
    listChangesSinceWatermark: () => Promise.reject(new AdapterError('commit-rejected', 'odoo journal reads are not adapter reads')),
    getByExternalId: () => Promise.reject(new AdapterError('commit-rejected', 'odoo journal reads are not adapter reads')),
  };
}
