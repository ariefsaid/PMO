/**
 * #895 AC-ACD-005 / -028 / -029 — reversing a posted journal on Odoo through `account.move.reversal` + `refund_moves`, once.
 * Odoo accepts a second reversal of the same move (V-ACD2), so the adapter reads `reversal_move_ids` first and never sends one
 * when a reversal already exists that is not this key's.
 */
import { describe, expect, it } from 'vitest';
import { journalKey, journalReversalKey, type LedgerJournal } from '../../ledgerJournal.ts';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { externalIdentifier } from '../purchase/anchors.ts';
import { postOdooJournal } from './adapter.ts';
import { DESK_JOURNAL_CONFIG_KEY } from './body.ts';
import { recoverOdooReversal, reverseOdooJournal } from './reversal.ts';

const ORIGINAL_ID = '123e4567-e89b-12d3-a456-426614174000';
const REVERSAL_ID = '223e4567-e89b-12d3-a456-426614174000';
const TODAY = '2026-11-15';
const ORIGINAL: LedgerJournal = {
  key: journalKey(ORIGINAL_ID), date: '2026-11-10', memo: 'Accrual November',
  lines: [
    { account: '601', debit: '60.00', credit: '0.00', label: 'a' },
    { account: '602', debit: '40.00', credit: '0.00', label: 'b' },
    { account: '101', debit: '0.00', credit: '100.00', label: 'c' },
  ],
};
const reversalOf = (externalRecordId: string, date = '2026-11-12'): LedgerJournal => ({
  key: journalReversalKey(REVERSAL_ID), date, memo: 'Reversal of Accrual November',
  lines: ORIGINAL.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
  reverses: { externalRecordId, reason: 'accrual reversed' },
});

async function world() {
  const fake = createFakeOdoo({ key: 'k', today: TODAY });
  fake.seed('res.company', [{ id: 1, name: 'Co' }]);
  fake.seed('account.journal', [{ id: 9, name: 'Miscellaneous', code: 'MISC', type: 'general' }]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const posted = await postOdooJournal(call, ORIGINAL, { [DESK_JOURNAL_CONFIG_KEY]: 9 }, TODAY);
  const originalMoveId = Number(posted.externalRecordId.split(':')[1]);
  const moves = () => fake.rows('account.move');
  const lines = (moveId: number) => fake.rows('account.move.line').filter((l) => l.move_id === moveId).map((l) => ({ account: l.account_id, debit: l.debit, credit: l.credit }));
  const otherReversal = async (anchor?: string) => {
    const ctx = { active_model: 'account.move', active_ids: [originalMoveId] };
    const [w] = await call<number[]>('account.move.reversal', 'create', { vals_list: [{ date: '2026-11-11', reason: 'by hand' }], context: ctx });
    const { res_id } = await call<{ res_id: number }>('account.move.reversal', 'refund_moves', { ids: [w], context: ctx });
    if (anchor) fake.seed('ir.model.data', [{ ...externalIdentifier(anchor), model: 'account.move', res_id }]);
    return res_id;
  };
  return { fake, call, posted, originalMoveId, moves, lines, otherReversal };
}

describe('#895 AC-ACD-005 / -028 the Odoo journal reversal', () => {
  it('no reversal yet: one reversal move linked to the original, the original unchanged, the two net to zero per account', async () => {
    const w = await world();
    const before = w.lines(w.originalMoveId);
    const result = await reverseOdooJournal(w.call, reversalOf(w.posted.externalRecordId), TODAY);
    expect(w.moves()).toHaveLength(2);
    const reversal = w.moves().find((m) => m.id !== w.originalMoveId)!;
    expect(reversal).toMatchObject({ reversed_entry_id: w.originalMoveId, state: 'posted', date: '2026-11-12' });
    expect(String(reversal.ref)).toContain('accrual reversed');   // the reason is always sent
    expect(result).toMatchObject({ externalRecordId: `account.move:${reversal.id}`, canonical: { id: REVERSAL_ID, status: 'posted', posted_date: '2026-11-12', external_record_id: `account.move:${reversal.id}` } });
    expect(w.lines(w.originalMoveId)).toEqual(before);
    const net = new Map<unknown, number>();
    for (const l of [...before, ...w.lines(reversal.id)]) net.set(l.account, (net.get(l.account) ?? 0) + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100));
    expect([...net.values()].every((v) => v === 0)).toBe(true);
    expect(w.fake.rows('ir.model.data').find((r) => r.res_id === reversal.id)).toMatchObject(externalIdentifier(journalReversalKey(REVERSAL_ID)));
  });

  it('a reversal already anchored with this key is adopted: no new move', async () => {
    const w = await world();
    const existing = await w.otherReversal(journalReversalKey(REVERSAL_ID));
    const result = await reverseOdooJournal(w.call, reversalOf(w.posted.externalRecordId, '2026-11-11'), TODAY);
    expect(result.externalRecordId).toBe(`account.move:${existing}`);
    expect(w.moves()).toHaveLength(2);
    expect(await recoverOdooReversal(w.call, reversalOf(w.posted.externalRecordId, '2026-11-11'), TODAY)).toMatchObject({ externalRecordId: `account.move:${existing}` });
  });

  it.each([
    ['with another anchor', journalReversalKey('323e4567-e89b-12d3-a456-426614174000')],
    ['with no anchor (made in Odoo)', undefined],
  ])('AC-ACD-029 an existing reversal %s: refused reversal-exists naming it, and no second reversal is sent (V-ACD2)', async (_label, anchor) => {
    const w = await world();
    const existing = await w.otherReversal(anchor);
    const name = w.moves().find((m) => m.id === existing)!.name;
    const calls = w.fake.calls.length;
    await expect(reverseOdooJournal(w.call, reversalOf(w.posted.externalRecordId), TODAY)).rejects.toMatchObject({ code: 'commit-rejected', message: `reversal-exists: ${String(name)}` });
    expect(w.moves()).toHaveLength(2);
    expect(w.fake.calls.slice(calls).filter((c) => c.model === 'account.move.reversal')).toEqual([]);
  });

  it('FR-ACD-028 a reversal dated after today is scheduled: Odoo keeps it a draft until its day, it is not shown Posted', async () => {
    const w = await world();
    const result = await reverseOdooJournal(w.call, reversalOf(w.posted.externalRecordId, '2026-12-01'), TODAY);
    expect(result.canonical).toMatchObject({ status: 'scheduled', posted_date: null });
    expect(w.moves().find((m) => m.id !== w.originalMoveId)).toMatchObject({ state: 'draft', date: '2026-12-01' });
  });

  it('refuses before any write: a draft original, an original that is not an Odoo move, a non-reversal journal', async () => {
    const w = await world();
    const calls = w.fake.calls.length;
    await expect(reverseOdooJournal(w.call, reversalOf('purchase.order:4'), TODAY)).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(reverseOdooJournal(w.call, { ...reversalOf(w.posted.externalRecordId), reverses: undefined }, TODAY)).rejects.toMatchObject({ code: 'commit-rejected' });
    w.fake.rows('account.move').find((m) => m.id === w.originalMoveId)!.state = 'draft';
    await expect(reverseOdooJournal(w.call, reversalOf(w.posted.externalRecordId), TODAY)).rejects.toMatchObject({ code: 'commit-rejected', message: 'journal-original-not-posted' });
    expect(w.fake.calls.slice(calls).filter((c) => c.method === 'create' || c.method === 'refund_moves')).toEqual([]);
  });

  it('the recovery probe finds nothing when no reversal carries this key (the caller decides: hold)', async () => {
    const w = await world();
    expect(await recoverOdooReversal(w.call, reversalOf(w.posted.externalRecordId), TODAY)).toBeNull();
  });
});
