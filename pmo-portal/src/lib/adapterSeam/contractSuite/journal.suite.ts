/**
 * journal.post (v1) and journal.reverse (v1) — the accountant's desk manual journal (#895, AC-ACD-005, AC-ACD-024): one
 * balanced journal posts once by key and is read back; the same key again adopts; an unbalanced journal is refused before any
 * write; a lost answer never leaves two documents. A reversal nets the original to zero per account, leaves it unchanged, and
 * is never sent a second time under another key (Odoo accepts a second reversal, V-ACD2).
 */
import { describe, expect, it } from 'vitest';
import { journalKey, journalReversalKey, type LedgerJournal } from '../ledgerJournal.ts';
import type { ErpHarness, JournalHarness, Suite } from './harness.ts';

const ID = '89500000-0000-4000-8000-000000000001';
const OTHER = '89500000-0000-4000-8000-000000000002';
const REV = '89500000-0000-4000-8000-0000000000a1';
const REV_OTHER = '89500000-0000-4000-8000-0000000000b1';
const JOURNAL: LedgerJournal = {
  key: journalKey(ID), date: '2026-11-10', memo: 'Accrual November',
  lines: [
    { account: '601', debit: '60.00', credit: '0.00', label: 'rent' },
    { account: '602', debit: '40.00', credit: '0.00', label: 'power' },
    { account: '101', debit: '0.00', credit: '100.00', label: 'accrued' },
  ],
};
const reversalOf = (externalRecordId: string, id = REV, date = '2026-11-12'): LedgerJournal => ({
  key: journalReversalKey(id), date, memo: 'Reversal of Accrual November',
  lines: JOURNAL.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
  reverses: { externalRecordId, reason: 'accrual reversed' },
});

function journalOf(h: ErpHarness): JournalHarness {
  if (!h.journal) throw new Error(`${h.tier} declares a journal workflow supported but its harness has no journal()`);
  return h.journal();
}

export const journalPostSuite: Suite = (h) => describe(`journal.post (${h.tier})`, () => {
  it('AC-ACD-024 a journal posts one document under its key, with its lines, on its own date', async () => {
    const t = journalOf(h);
    const posted = await t.post(JOURNAL);
    expect(posted).toEqual({ externalId: posted.externalId, status: 'posted', postedDate: '2026-11-10' });
    expect(t.documents()).toEqual([{ externalId: posted.externalId, key: JOURNAL.key }]);
    expect(t.lines(posted.externalId)).toEqual([
      { account: '601', debit: '60.00', credit: '0.00' },
      { account: '602', debit: '40.00', credit: '0.00' },
      { account: '101', debit: '0.00', credit: '100.00' },
    ]);
  });

  it('AC-ACD-003 posting the same key again adopts the first document: no second journal', async () => {
    const t = journalOf(h);
    const first = await t.post(JOURNAL);
    expect(await t.post(JOURNAL)).toEqual(first);
    expect(t.documents()).toHaveLength(1);
  });

  it('AC-ACD-001 an unbalanced journal is refused before any write reaches the ledger', async () => {
    const t = journalOf(h);
    const before = t.writes();
    await expect(t.post({ ...JOURNAL, lines: [JOURNAL.lines[0], JOURNAL.lines[1], { ...JOURNAL.lines[2], credit: '99.99' }] }))
      .rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('does not balance by 0.01') });
    expect(t.writes()).toBe(before);
    expect(t.documents()).toEqual([]);
  });

  it('AC-ACD-003 a lost answer then a retry never leaves two documents (adopted, or held for a person)', async () => {
    const t = journalOf(h);
    t.failNextWrite('lost-response');
    await expect(t.post(JOURNAL)).rejects.toMatchObject({ code: 'external-unreachable' });
    const retry = await t.post(JOURNAL).then((r) => r, (e: { code?: string }) => e);
    expect(t.documents()).toHaveLength(1);
    if ('externalId' in retry) expect(retry.externalId).toBe(t.documents()[0].externalId);
    else expect(retry.code).toBe('command-held');
  });

  it('a journal under another key is its own document, never the first one adopted', async () => {
    const t = journalOf(h);
    const first = await t.post(JOURNAL);
    const second = await t.post({ ...JOURNAL, key: journalKey(OTHER) });
    expect(second.externalId).not.toBe(first.externalId);
    expect(t.documents().map((d) => d.key).sort()).toEqual([journalKey(ID), journalKey(OTHER)].sort());
  });
});

export const journalReverseSuite: Suite = (h) => describe(`journal.reverse (${h.tier})`, () => {
  const net = (t: JournalHarness, ids: string[]) => {
    const m = new Map<string, number>();
    for (const id of ids) for (const l of t.lines(id)) m.set(l.account, (m.get(l.account) ?? 0) + Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100));
    return [...m.values()];
  };

  it('AC-ACD-005 the reversal is one new document that nets the original to zero per account and leaves it unchanged', async () => {
    const t = journalOf(h);
    const original = await t.post(JOURNAL);
    const before = t.lines(original.externalId);
    const reversal = await t.post(reversalOf(original.externalId));
    expect(reversal).toMatchObject({ status: 'posted', postedDate: '2026-11-12' });
    expect(reversal.externalId).not.toBe(original.externalId);
    expect(t.lines(original.externalId)).toEqual(before);
    expect(net(t, [original.externalId, reversal.externalId]).every((v) => v === 0)).toBe(true);
    expect(t.documents().find((d) => d.externalId === reversal.externalId)?.key).toBe(journalReversalKey(REV));
  });

  it('AC-ACD-005 reversing again with the same key adopts the reversal: no third document', async () => {
    const t = journalOf(h);
    const original = await t.post(JOURNAL);
    const first = await t.post(reversalOf(original.externalId));
    expect(await t.post(reversalOf(original.externalId))).toEqual(first);
    expect(t.documents()).toHaveLength(2);
  });

  it('AC-ACD-029 a second reversal under another key is refused and nothing new is sent', async () => {
    const t = journalOf(h);
    const original = await t.post(JOURNAL);
    await t.post(reversalOf(original.externalId));
    await expect(t.post(reversalOf(original.externalId, REV_OTHER))).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('reversal-exists') });
    expect(t.documents()).toHaveLength(2);
  });

  it('FR-ACD-028 a reversal dated after the ledger\'s day is scheduled, not shown posted', async () => {
    const t = journalOf(h);
    const original = await t.post(JOURNAL);
    const reversal = await t.post(reversalOf(original.externalId, REV, '2026-12-01'));
    expect(reversal).toMatchObject({ status: 'scheduled', postedDate: null });
  });
});
