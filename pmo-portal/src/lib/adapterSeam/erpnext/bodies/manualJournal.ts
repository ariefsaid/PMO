/**
 * #895 — the accountant's desk manual journal as an ERPNext Journal Entry (AC-ACD-004). The record is what the dispatch re-read
 * from the database (`applyCanonicalJournalTruth`: `journal` is a `LedgerJournal`), never the request payload. The key is the
 * anchor, in the immutable `user_remark` (`adapter.ts` stampAnchor keeps a remark that starts with the key). A line's
 * `analytic` is the ERPNext project; a `partner` is refused until the desk carries a party type (ERPNext will not post a party
 * without one), never dropped.
 */
import { AppError } from '../../../appError.ts';
import type { PmoRecord } from '../../contract.ts';
import { AdapterError } from '../../contract.ts';
import { assertLedgerJournal, type LedgerJournal } from '../../ledgerJournal.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };

function journalOf(rec: PmoRecord): LedgerJournal {
  const j = rec.journal as LedgerJournal | undefined;
  if (!j || typeof j !== 'object' || !Array.isArray(j.lines)) return refuse('journal: the command carries no journal');
  try { return assertLedgerJournal(j); } catch (e) { return refuse((e as Error).message); }
}

function companyOf(rec: PmoRecord, ctx: ErpCtx): string {
  const company = typeof rec.company === 'string' && rec.company ? rec.company : ctx.config.company;
  return typeof company === 'string' && company ? company : refuse('journal: the ERPNext connection names no company');
}

function journalBody(j: LedgerJournal, company: string, userRemark: string, title: string): Record<string, unknown> {
  return {
    company,
    voucher_type: 'Journal Entry',
    posting_date: j.date,   // always sent (FR-ACD-113)
    title,
    user_remark: userRemark,
    accounts: j.lines.map((l) => {
      if (l.partner !== undefined) refuse(`journal: a partner on ${l.account} cannot be posted to ERPNext yet`);
      return {
        account: l.account,
        debit_in_account_currency: Number(l.debit),
        credit_in_account_currency: Number(l.credit),
        ...(l.analytic ? { project: l.analytic } : {}),
        user_remark: l.label,
      };
    }),
  };
}

/** A manual journal (or, when it carries `reverses`, its reversal) as one Journal Entry. */
export function manualJournalToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const j = journalOf(rec);
  if (j.reverses) return manualJournalReversalToBody(rec, ctx);
  return journalBody(j, companyOf(rec, ctx), j.key, j.memo);
}

/**
 * OWNER RULING: ERPNext reversal is posted as a swapped journal (debits and credits exchanged) until native reversal is probed (V-ACD3).
 *
 * The reversal journal arrives with its sides already exchanged (the desk swaps every line when the reversal is requested,
 * FR-ACD-024), so it posts as a new Journal Entry under its own `journal-rev:` key. The original is named by its ERPNext
 * document name in `user_remark`, after the key, and never by its PMO key: the anchor probe matches `like %key%`, so the
 * original's key here would let the original's recovery adopt this reversal.
 */
export function manualJournalReversalToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const j = journalOf(rec);
  if (!j.reverses) return refuse('journal: not a reversal');
  const original = j.reverses.externalRecordId || refuse('journal: the original has no ERPNext document');
  const reason = j.reverses.reason ? `: ${j.reverses.reason}` : '';
  return journalBody(j, companyOf(rec, ctx), `${j.key} reverses ${original}${reason}`, j.memo || `Reversal of ${original}`);
}

/**
 * The Journal Entry as the dispatch's journal result (the same shape the Odoo adapter answers): `posted_date` is the ledger's
 * own `posting_date`, never the request's. Anything but a submitted entry is not Posted: it holds for a person (FR-ACD-027).
 */
export function manualJournalFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  const name = String(d.name);
  const docstatus = (d.docstatus as number | null | undefined) ?? null;
  if (docstatus !== 1) throw new AppError(`the ledger holds ${name} as ${docstatus === 2 ? 'cancelled' : 'draft'}, not posted`, 'command-held');
  return {
    id: name,
    status: 'posted',
    external_record_id: name,
    ledger_name: name,
    posted_date: typeof d.posting_date === 'string' ? d.posting_date : null,
    erp_name: name,
    erp_docstatus: docstatus,
    erp_modified: (d.modified as string | null | undefined) ?? null,
  };
}
