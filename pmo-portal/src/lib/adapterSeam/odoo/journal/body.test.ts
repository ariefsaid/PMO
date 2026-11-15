import { describe, expect, it } from 'vitest';
import { AppError } from '../../../appError.ts';
import { AdapterError } from '../../contract.ts';
import { journalKey, type LedgerJournal } from '../../ledgerJournal.ts';
import { buildJournalMoveBody, DESK_JOURNAL_CONFIG_KEY, DESK_JOURNAL_UNSET, deskJournalId, odooJournalInput } from './body.ts';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const JOURNAL: LedgerJournal = {
  key: journalKey(ID), date: '2026-11-10', memo: 'Bank fee November',
  lines: [
    { account: '601', debit: '100.00', credit: '0.00', label: 'fee', partner: '77', analytic: '12' },
    { account: '101', debit: '0.00', credit: '100.00', label: 'bank' },
  ],
};
const CONFIG = { [DESK_JOURNAL_CONFIG_KEY]: 9 };
const caught = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } return null; };

describe('#895 V-ACD1 the Odoo manual-journal move body', () => {
  it('a two-line journal becomes one `entry` move on the desk journal, dated, with the memo as ref and one line per side', () => {
    expect(buildJournalMoveBody(JOURNAL, CONFIG)).toEqual({
      move_type: 'entry', journal_id: 9, date: '2026-11-10', ref: 'Bank fee November',
      line_ids: [
        [0, 0, { account_id: 601, debit: 100, credit: 0, name: 'fee', partner_id: 77, analytic_distribution: { '12': 100 } }],
        [0, 0, { account_id: 101, debit: 0, credit: 100, name: 'bank' }],
      ],
    });
  });

  it('the PMO key is never written into a business field: the anchor is the external identifier (V-ACD1: the same ref twice makes two moves)', () => {
    expect(JSON.stringify(buildJournalMoveBody(JOURNAL, CONFIG))).not.toContain(ID);
  });

  it('FR-ACD-029 no desk journal chosen: posting is refused with the setup message for the Admin, before any write', () => {
    for (const config of [null, {}, { [DESK_JOURNAL_CONFIG_KEY]: '' }, { [DESK_JOURNAL_CONFIG_KEY]: 0 }, { [DESK_JOURNAL_CONFIG_KEY]: 'misc' }]) {
      const e = caught(() => buildJournalMoveBody(JOURNAL, config));
      expect(e, JSON.stringify(config)).toBeInstanceOf(AppError);
      expect(e).toMatchObject({ code: 'config-rejected', message: DESK_JOURNAL_UNSET });
    }
    expect(DESK_JOURNAL_UNSET).toBe('An Admin must choose the Odoo journal for desk entries in Odoo setup before journals can post.');
    expect(deskJournalId({ [DESK_JOURNAL_CONFIG_KEY]: '14' })).toBe(14);
  });

  it('AC-ACD-001 an unbalanced journal is refused (commit-rejected) before any body exists', () => {
    const unbalanced = { ...JOURNAL, lines: [JOURNAL.lines[0], { ...JOURNAL.lines[1], credit: '99.99' }] };
    const e = caught(() => buildJournalMoveBody(unbalanced, CONFIG));
    expect(e).toBeInstanceOf(AdapterError);
    expect(e).toMatchObject({ code: 'commit-rejected', message: 'journal: does not balance by 0.01' });
  });

  it('an account, partner or analytic that is not an Odoo id is refused, never guessed', () => {
    for (const line of [{ account: '6-01' }, { partner: 'Vendor' }, { analytic: '0' }]) {
      const bad = { ...JOURNAL, lines: [{ ...JOURNAL.lines[0], ...line }, JOURNAL.lines[1]] };
      expect(caught(() => buildJournalMoveBody(bad, CONFIG)), JSON.stringify(line)).toMatchObject({ code: 'commit-rejected' });
    }
  });

  it('the per-line Odoo account ids the dispatch resolved replace the chart codes; a line with no Odoo id is refused', () => {
    const body = buildJournalMoveBody({ ...JOURNAL, lines: JOURNAL.lines.map((l) => ({ ...l, account: `6${l.account}00` })) }, CONFIG, ['601', '101']) as { line_ids: Array<[number, number, Record<string, unknown>]> };
    expect(body.line_ids.map(([, , l]) => l.account_id)).toEqual([601, 101]);
    expect(caught(() => buildJournalMoveBody(JOURNAL, CONFIG, ['601', null]))).toMatchObject({ code: 'commit-rejected', message: 'journal: account 101 is not in the Odoo chart PMO has read' });
    expect(caught(() => buildJournalMoveBody(JOURNAL, CONFIG, ['601']))).toMatchObject({ code: 'commit-rejected' });
  });

  it('reads the dispatch record (journal, desk journal, account ids) over the binding config', () => {
    const record = { id: ID, erp_doc_kind: 'manual-journal', journal: JOURNAL, desk_journal_id: 14, account_ids: ['601', '101'] };
    expect(odooJournalInput(record, { [DESK_JOURNAL_CONFIG_KEY]: 9, other: 1 })).toEqual({ journal: JOURNAL, config: { [DESK_JOURNAL_CONFIG_KEY]: 14, other: 1 }, accountIds: ['601', '101'] });
    expect(odooJournalInput({ ...record, desk_journal_id: null, account_ids: undefined }, { [DESK_JOURNAL_CONFIG_KEY]: 9 })).toEqual({ journal: JOURNAL, config: { [DESK_JOURNAL_CONFIG_KEY]: 9 } });
    expect(caught(() => odooJournalInput({ ...record, journal: undefined }, {}))).toMatchObject({ code: 'commit-rejected' });
  });
});
