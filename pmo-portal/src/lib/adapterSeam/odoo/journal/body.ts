/**
 * #895 — the Odoo `account.move` (`entry`) create body for one manual journal (V-ACD1), pure. The PMO key is NOT in the body:
 * Odoo accepts the same `ref` twice and posts both (V-ACD1), so the anchor is the external identifier written right after the
 * create (anchors.ts). The journal the move posts on is the one an Admin picked per company in Odoo setup (binding config
 * `desk_journal_id`); until one is picked, posting is refused with a plain setup message (owner ruling, FR-ACD-029).
 */
import { AppError } from '../../../appError.ts';
import { AdapterError } from '../../contract.ts';
import { assertLedgerJournal, type LedgerJournal, type LedgerJournalLine } from '../../ledgerJournal.ts';

/** The binding-config key the Admin's choice of desk journal is stored under. */
export const DESK_JOURNAL_CONFIG_KEY = 'desk_journal_id';
export const DESK_JOURNAL_UNSET = 'An Admin must choose the Odoo journal for desk entries in Odoo setup before journals can post.';

const odooId = (v: unknown): number | null => {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return /^[1-9][0-9]*$/.test(s) ? Number(s) : null;
};
const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

/** The desk journal from the binding config; refuses `config-rejected` (no write attempted) when none has been chosen. */
export function deskJournalId(config: Record<string, unknown> | null | undefined): number {
  return odooId(config?.[DESK_JOURNAL_CONFIG_KEY]) ?? (() => { throw new AppError(DESK_JOURNAL_UNSET, 'config-rejected'); })();
}

/** `accountId`: the Odoo account id the dispatch resolved from the mirrored chart; absent, the line's account is taken as the id. */
function moveLine(l: LedgerJournalLine, accountId?: string | null): Record<string, unknown> {
  const account = accountId === undefined
    ? odooId(l.account) ?? refuse(`journal: account ${l.account} is not an Odoo account`)
    : odooId(accountId) ?? refuse(`journal: account ${l.account} is not in the Odoo chart PMO has read`);
  const partner = l.partner === undefined ? null : odooId(l.partner) ?? refuse(`journal: partner ${l.partner} is not an Odoo partner`);
  const analytic = l.analytic === undefined ? null : odooId(l.analytic) ?? refuse(`journal: analytic ${l.analytic} is not an Odoo analytic account`);
  return {
    account_id: account,
    debit: Number(l.debit),
    credit: Number(l.credit),
    name: l.label,
    ...(partner === null ? {} : { partner_id: partner }),
    ...(analytic === null ? {} : { analytic_distribution: { [String(analytic)]: 100 } }),
  };
}

/** Validates the journal (balance to the unit, two or more lines) and maps it; every refusal comes before any Odoo write. */
export function buildJournalMoveBody(
  journal: LedgerJournal, config: Record<string, unknown> | null | undefined, accountIds?: ReadonlyArray<string | null>,
): Record<string, unknown> {
  try { assertLedgerJournal(journal); } catch (e) { refuse((e as Error).message); }
  if (accountIds && accountIds.length !== journal.lines.length) refuse('journal: account ids do not match the lines');
  const journalId = deskJournalId(config);
  return {
    move_type: 'entry',
    journal_id: journalId,
    date: journal.date,   // always sent: Odoo's default is today (V-ACD1), never the journal's day
    ref: journal.memo,
    line_ids: journal.lines.map((l, i) => [0, 0, moveLine(l, accountIds ? accountIds[i] : undefined)]),
  };
}

export interface OdooJournalInput {
  journal: LedgerJournal;
  /** The binding config, with the desk journal the dispatch re-read laid over it. */
  config: Record<string, unknown> | null;
  /** Per line, the Odoo account id resolved from the mirrored chart (absent: each line's account is the id). */
  accountIds?: ReadonlyArray<string | null>;
}

/**
 * The adapter input from the dispatch record (`applyCanonicalJournalTruth`: `journal`, `desk_journal_id`, `account_ids`, all
 * re-read from the database under the caller) and the Odoo binding's config. Nothing here is taken from the request payload.
 */
export function odooJournalInput(record: Record<string, unknown>, bindingConfig: Record<string, unknown> | null): OdooJournalInput {
  const journal = record.journal as LedgerJournal | undefined;
  if (!journal || typeof journal !== 'object' || !Array.isArray(journal.lines)) return refuse('journal: the command carries no journal');
  const desk = odooId(record.desk_journal_id);
  const config = desk === null ? bindingConfig : { ...(bindingConfig ?? {}), [DESK_JOURNAL_CONFIG_KEY]: desk };
  const ids = record.account_ids;
  return { journal, config, ...(Array.isArray(ids) ? { accountIds: ids.map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)) } : {}) };
}
