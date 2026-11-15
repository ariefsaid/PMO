// #895 FR-ACD-022 — a manual journal reaches the ledger ONLY once it is approved in PMO by a second person.
//
// Runs under the CALLER's own JWT (the deputy client — never service_role), so `approved_journal_for_push` (0887)
// evaluates its org, role and status arms against the real caller. The command payload is NEVER trusted: this is a
// DB re-read (ADR-0059 §3.3), modelled on approvalGuard.ts. It returns the journal the RPC read, and the dispatch
// builds the ledger body from THAT — the lines, amounts, date, key and the ledger refs — so a forged payload can
// decide neither whether a post happens nor what it posts. The second-approver rule itself (owner ruling 2) is
// enforced by `approve_journal` / `may_approve_journal`; this gate only lets an already-approved journal through.
//
// Fail-closed: every non-ok shape (an error, an empty answer, a malformed or unbalanced body) is a refusal.
import { assertLedgerJournal, JOURNAL_KEY_RE, JOURNAL_REVERSAL_KEY_RE, type LedgerJournal } from '../../../pmo-portal/src/lib/adapterSeam/ledgerJournal.ts';

export const JOURNAL_DOMAIN = 'accounting';
export const JOURNAL_DOC_KIND = 'manual-journal';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JournalRpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
}

/** The approved journal as the database read it — the only source the post is built from. */
export interface ApprovedJournal {
  id: string;
  tier: 'odoo' | 'erpnext';
  /** Odoo only: the general journal an Admin picked for desk entries (owner ruling 4). */
  deskJournalId: number | null;
  /** Odoo account ids, one per ledger line, in line order (null where the chart has not been mirrored). */
  accountIds: Array<string | null>;
  ledger: LedgerJournal;
}

export interface JournalGuardResult {
  ok: boolean;
  status: number;
  message: string;
  journal?: ApprovedJournal;
}

export function isJournalPush(command: { domain: string; record: Record<string, unknown> }): boolean {
  return command.domain === JOURNAL_DOMAIN && command.record.erp_doc_kind === JOURNAL_DOC_KIND;
}

const REFUSED = (status: number, message: string): JournalGuardResult => ({ ok: false, status, message });
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export async function enforceJournalApproved(callerClient: JournalRpcClient, journalId: string): Promise<JournalGuardResult> {
  if (!UUID.test(journalId)) return REFUSED(422, 'journal record.id must be a canonical UUID');
  const { data, error } = await callerClient.rpc('approved_journal_for_push', { p_id: journalId.toLowerCase() });
  if (error) {
    if (error.code === '42501') return REFUSED(403, error.message || 'not-authorized');
    // P0001 is the database's plain refusal (setup, an unlinked project or company); it is shown as written.
    if (error.code === 'P0001') return REFUSED(422, error.message);
    return REFUSED(422, 'journal-check-failed');
  }
  const row = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!row || typeof row.id !== 'string' || typeof row.key !== 'string' || !Array.isArray(row.lines)) return REFUSED(422, 'journal-check-failed');
  if (row.tier !== 'odoo' && row.tier !== 'erpnext') return REFUSED(422, 'journal-check-failed');
  if (!JOURNAL_KEY_RE.test(row.key) && !JOURNAL_REVERSAL_KEY_RE.test(row.key)) return REFUSED(422, 'journal-check-failed');

  const lines = row.lines as Array<Record<string, unknown>>;
  const rev = row.reverses as Record<string, unknown> | null | undefined;
  const ledger: LedgerJournal = {
    key: row.key,
    date: String(row.date ?? ''),
    memo: String(row.memo ?? ''),
    lines: lines.map((l) => ({
      account: String(l.account ?? ''),
      debit: String(l.debit ?? ''),
      credit: String(l.credit ?? ''),
      ...(str(l.partner) ? { partner: str(l.partner) } : {}),
      ...(str(l.analytic) ? { analytic: str(l.analytic) } : {}),
      label: String(l.label ?? ''),
    })),
    ...(rev ? { reverses: { externalRecordId: String(rev.external_record_id ?? ''), reason: String(rev.reason ?? '') } } : {}),
  };
  try { assertLedgerJournal(ledger); } catch { return REFUSED(422, 'journal-check-failed'); }
  if (ledger.reverses && !ledger.reverses.externalRecordId) return REFUSED(422, 'the original journal has no ledger reference yet');
  const desk = str(row.desk_journal_id);
  return {
    ok: true, status: 200, message: '',
    journal: {
      id: row.id,
      tier: row.tier,
      deskJournalId: desk && /^[0-9]{1,9}$/.test(desk) ? Number(desk) : null,
      accountIds: lines.map((l) => str(l.account_id) ?? null),
      ledger,
    },
  };
}

/** Server truth replaces the command: its id, its key (one outbox row per PMO intent) and the whole body. */
export function applyCanonicalJournalTruth<T extends { record: Record<string, unknown>; idempotencyKey?: string }>(
  command: T, journal: ApprovedJournal,
): T {
  command.record = {
    id: journal.id,
    erp_doc_kind: JOURNAL_DOC_KIND,
    journal: journal.ledger,
    desk_journal_id: journal.deskJournalId,
    account_ids: journal.accountIds,
  };
  command.idempotencyKey = journal.ledger.key;
  return command;
}
