import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { JournalLinePayload } from '@/src/lib/journals/journalBalance';

/**
 * Manual journals DAL (#895, migration 0887). Every write goes through an RPC that holds the rule (balance, chart,
 * second approver); the three tables are select-only for Finance-or-above. Never sends org_id or a status.
 * `database.types.ts` predates 0887, so the RPC and table names are cast at this seam.
 */
export const JOURNAL_KINDS = ['fee', 'interest', 'tax-deposit', 'accrual', 'reclassification', 'correction',
  'funding', 'depreciation', 'revaluation', 'closing'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export type JournalStatus = 'draft' | 'submitted' | 'approved' | 'sending' | 'posted' | 'scheduled' | 'held' | 'refused';

/** One row of `list_journals`: a PMO journal, or a read-only ledger move PMO did not write (`outside-pmo`, no id). */
export interface JournalListRow {
  origin: 'pmo' | 'outside-pmo';
  id: string | null;
  kind: JournalKind | null;
  date: string;
  memo: string | null;
  status: JournalStatus;
  maker_id?: string | null;
  approver_id?: string | null;
  ledger_name: string | null;
  external_record_id?: string | null;
  posted_date?: string | null;
  held_reason?: string | null;
  return_reason?: string | null;
  reverses_journal_id?: string | null;
  /** Sum of debits, exact two-decimal text. */
  total: string;
}

export interface JournalEntryRow {
  id: string;
  kind: JournalKind;
  entry_date: string;
  memo: string;
  status: JournalStatus;
  maker_id: string;
  approver_id: string | null;
  approved_at: string | null;
  return_reason: string | null;
  reverses_journal_id: string | null;
  reversal_reason: string | null;
  external_record_id: string | null;
  external_name: string | null;
  posted_date: string | null;
  held_reason: string | null;
}

export interface JournalLineRow {
  id: string;
  journal_id: string;
  line_no: number;
  account: string;
  /** numeric(18,2) as PostgREST returns it. */
  debit: string | number;
  credit: string | number;
  partner_company_id: string | null;
  project_id: string | null;
  label: string;
}

export interface JournalDetail {
  entry: JournalEntryRow;
  lines: JournalLineRow[];
  /** The maker and every editor (the second-approver rule). */
  authorIds: string[];
  /** For a reversal: everyone who wrote the original. */
  originalAuthorIds: string[];
}

export interface JournalLedgerSetup {
  tier: 'odoo' | 'erpnext' | null;
  desk_journal_id: string | null;
  needs_desk_journal: boolean;
}

export interface JournalDraftInput {
  id: string | null;
  kind: JournalKind;
  date: string;
  memo: string;
  lines: JournalLinePayload[];
}

/** `save_journal_draft` takes at most 200 lines; one more row is never read. */
const LINES_LIMIT = 200;
const AUTHORS_LIMIT = 500;

const fail = (error: { message: string; code?: string } | null): void => { if (error) throw new AppError(error.message, error.code); };
const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  fail(error as { message: string; code?: string } | null);
  return data;
};
const table = (name: string) => supabase.from(name as never);

export async function listJournals(from: string, to: string): Promise<JournalListRow[]> {
  return ((await rpc('list_journals', { p_from: from, p_to: to })) ?? []) as JournalListRow[];
}

export async function getJournal(id: string): Promise<JournalDetail | null> {
  const { data: entry, error } = await table('journal_entries').select('*').eq('id', id).maybeSingle();
  fail(error);
  if (!entry) return null;
  const row = entry as unknown as JournalEntryRow;
  const journalIds = row.reverses_journal_id ? [row.id, row.reverses_journal_id] : [row.id];
  const [lines, authors] = await Promise.all([
    table('journal_entry_lines').select('*').eq('journal_id', row.id).order('line_no', { ascending: true }).limit(LINES_LIMIT),
    table('journal_entry_authors').select('journal_id, profile_id').in('journal_id', journalIds).limit(AUTHORS_LIMIT),
  ]);
  fail(lines.error);
  fail(authors.error);
  const authorRows = (authors.data ?? []) as unknown as Array<{ journal_id: string; profile_id: string }>;
  return {
    entry: row,
    lines: (lines.data ?? []) as unknown as JournalLineRow[],
    authorIds: authorRows.filter((a) => a.journal_id === row.id).map((a) => a.profile_id),
    originalAuthorIds: authorRows.filter((a) => a.journal_id !== row.id).map((a) => a.profile_id),
  };
}

export async function getLedgerSetup(): Promise<JournalLedgerSetup> {
  const data = (await rpc('journal_ledger_setup', {})) as Partial<JournalLedgerSetup> | null;
  return {
    tier: data?.tier ?? null,
    desk_journal_id: data?.desk_journal_id ?? null,
    needs_desk_journal: data?.needs_desk_journal === true,
  };
}

export const saveJournalDraft = async (input: JournalDraftInput): Promise<string> =>
  (await rpc('save_journal_draft', { p_id: input.id, p_kind: input.kind, p_date: input.date, p_memo: input.memo, p_lines: input.lines })) as string;
export const submitJournal = async (id: string): Promise<void> => { await rpc('submit_journal', { p_id: id }); };
export const approveJournal = async (id: string): Promise<void> => { await rpc('approve_journal', { p_id: id }); };
export const returnJournal = async (id: string, reason: string): Promise<void> => { await rpc('return_journal', { p_id: id, p_reason: reason }); };
export const requestJournalReversal = async (originalId: string, date: string, reason: string): Promise<string> =>
  (await rpc('request_journal_reversal', { p_original: originalId, p_date: date, p_reason: reason })) as string;
/** Admin only (owner ruling 4): the mirrored general Odoo journal desk entries post to. */
export const setDeskJournal = async (journalId: string): Promise<void> => { await rpc('set_desk_journal', { p_journal_id: journalId }); };
