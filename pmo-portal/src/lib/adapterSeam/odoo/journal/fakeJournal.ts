/**
 * The manual-journal half of the test-only Odoo (fakeOdoo.ts), #895. It mirrors the dev-bed facts recorded in
 * `supabase/functions/_shared/odooAccountantsDeskFacts.bed.test.ts` (branch spike/accountants-desk-odoo-facts):
 * - V-ACD1: an `entry` move created with `line_ids`; an unbalanced create is refused (422) and nothing is kept; the same `ref`
 *   twice is accepted and both post, so `ref` can never be the anchor.
 * - V-ACD4: a post dated inside the company's `fiscalyear_lock_date` succeeds, silently re-dated to the day after the lock.
 * - V-ACD2: `account.move.reversal` (context `active_ids`) + `refund_moves` answers an action whose `res_id` is the reversal; the
 *   reversal carries `reversed_entry_id`, the original lists it in `reversal_move_ids`, a reversal dated after today waits as a
 *   draft (auto-post at date), and a second reversal of the same move is accepted.
 */
import { Rejected } from '../purchase/fakeBill.ts';

type Row = Record<string, unknown> & { id: number };
export interface JournalEnv {
  table(model: string): Map<number, Row>; nextId(model: string): number; stamp(): string; today: string;
  /** Records a move as a modelled entry, so `action_post` posts it through `postEntry`. */
  markEntry(id: number): void;
}

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Is this a manual journal entry the fake models (an `entry` created with `line_ids`)? */
export const isModelledEntry = (vals: Record<string, unknown>) => vals.move_type === 'entry' && Array.isArray(vals.line_ids);

function insertEntry(env: JournalEnv, header: Record<string, unknown>, lines: Array<Record<string, unknown>>): number {
  if (lines.length < 2) throw new Rejected('An entry needs at least two lines.');
  const debit = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + cents(l.credit), 0);
  if (debit !== credit) throw new Rejected('The entry is not balanced.');   // checked before anything is stored: nothing is kept
  const id = env.nextId('account.move');
  const stamp = env.stamp();
  env.markEntry(id);
  env.table('account.move').set(id, {
    active: true, name: '/', state: 'draft', ref: false, reversed_entry_id: false, reversal_move_ids: [], auto_post: 'no',
    ...header, id, move_type: 'entry', date: header.date ?? env.today, amount_total: debit / 100, create_date: stamp, write_date: stamp,
  });
  for (const l of lines) {
    const lineId = env.nextId('account.move.line');
    env.table('account.move.line').set(lineId, {
      partner_id: false, analytic_distribution: false, ...l,
      id: lineId, move_id: id, display_type: 'product', debit: Number(l.debit ?? 0), credit: Number(l.credit ?? 0),
      balance: (cents(l.debit) - cents(l.credit)) / 100, write_date: stamp,
    });
  }
  return id;
}

export function createEntry(env: JournalEnv, vals: Record<string, unknown>): number {
  const { line_ids: commands, ...header } = vals;
  const lines = (commands as unknown[][]).filter((c) => c[0] === 0).map((c) => c[2] as Record<string, unknown>);
  return insertEntry(env, header, lines);
}

const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** `action_post` on an entry: a date inside the soft lock is moved to the day after it (V-ACD4); the move takes its number. */
export function postEntry(env: JournalEnv, move: Row): void {
  if (move.state !== 'draft') throw new Rejected('This journal entry is already posted');
  const company = [...env.table('res.company').values()][0];
  const lock = typeof company?.fiscalyear_lock_date === 'string' ? company.fiscalyear_lock_date : null;
  const date = lock && String(move.date) <= lock ? dayAfter(lock) : move.date;
  const seq = [...env.table('account.move').values()].filter((m) => m.move_type === 'entry' && m.state === 'posted').length + 1;
  Object.assign(move, { state: 'posted', date, name: `MISC/${String(date).slice(0, 4)}/${String(seq).padStart(5, '0')}`, write_date: env.stamp() });
  for (const l of env.table('account.move.line').values()) if (l.move_id === move.id) l.parent_state = 'posted';
}

export function createReversalWizard(env: JournalEnv, vals: Record<string, unknown>, context: Record<string, unknown>): number {
  const ids = Array.isArray(context.active_ids) ? context.active_ids.map(Number) : [];
  const id = env.nextId('account.move.reversal');
  env.table('account.move.reversal').set(id, { ...vals, id, move_ids: ids, write_date: env.stamp() });
  return id;
}

/** `refund_moves`: one swapped entry per original, linked both ways; posted now, or a draft that auto-posts on a later date. */
export function refundMoves(env: JournalEnv, wizardId: number): { name: string; type: string; res_model: string; res_id: number } {
  const wizard = env.table('account.move.reversal').get(wizardId);
  if (!wizard) throw new Rejected('Record does not exist or has been deleted.');
  let last = 0;
  for (const origId of wizard.move_ids as number[]) {
    const orig = env.table('account.move').get(origId);
    if (!orig || orig.state !== 'posted') throw new Rejected('You can only reverse posted moves.');
    const date = typeof wizard.date === 'string' ? wizard.date : env.today;
    const lines = [...env.table('account.move.line').values()].filter((l) => l.move_id === origId).map((l) => ({
      account_id: l.account_id, name: l.name ?? false, partner_id: l.partner_id ?? false, analytic_distribution: l.analytic_distribution ?? false,
      debit: l.credit, credit: l.debit,
    }));
    const future = date > env.today;
    const id = insertEntry(env, {
      journal_id: wizard.journal_id ?? orig.journal_id, date, ref: `Reversal of: ${String(orig.name)}${wizard.reason ? `, ${String(wizard.reason)}` : ''}`,
      reversed_entry_id: origId, auto_post: future ? 'at_date' : 'no',
    }, lines);
    if (!future) postEntry(env, env.table('account.move').get(id)!);
    orig.reversal_move_ids = [...(Array.isArray(orig.reversal_move_ids) ? orig.reversal_move_ids as number[] : []), id];
    last = id;
  }
  return { name: 'Reverse Moves', type: 'ir.actions.act_window', res_model: 'account.move', res_id: last };
}
