/**
 * #895 AC-ACD-003 / AC-ACD-027 — the shipped Odoo journal adapter on the fake Odoo: one `entry` move, posted, anchored by
 * external identifier, read back; a silent re-date inside a locked period is held, never shown Posted. AC-ACD-003 (lost
 * answer) drives the shipped `dispatchMoneyWrite` over the trimmed outbox: a recovery that cannot find the move HOLDS.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AdapterCommand } from '../../contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyOutboxDeps } from '../../dispatch.ts';
import { journalKey, type LedgerJournal } from '../../ledgerJournal.ts';
import { bindCall } from '../client.ts';
import { createFakeOdoo } from '../fakeOdoo.ts';
import { createFakeOutbox, LEASE_MS } from '../purchase/fakeOutbox.ts';
import { DESK_JOURNAL_CONFIG_KEY, DESK_JOURNAL_UNSET } from './body.ts';
import {
  ACCOUNTING_DOMAIN, createOdooJournalAdapter, jakartaToday, ODOO_JOURNAL_REISSUE_ON_INCONCLUSIVE_ABSENCE, odooJournalReissueOnInconclusiveAbsence,
  probeJournalByAnchor, recoverOdooJournal,
} from './adapter.ts';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const KEY = journalKey(ID);
const TODAY = '2026-11-15';
const JOURNAL: LedgerJournal = {
  key: KEY, date: '2026-11-10', memo: 'Bank fee November',
  lines: [{ account: '601', debit: '100.00', credit: '0.00', label: 'fee' }, { account: '101', debit: '0.00', credit: '100.00', label: 'bank' }],
};
const CONFIG = { [DESK_JOURNAL_CONFIG_KEY]: 9 };
const COMMAND: AdapterCommand = { domain: ACCOUNTING_DOMAIN, operation: 'create', idempotencyKey: KEY, record: { id: ID } };

function world(journal: LedgerJournal = JOURNAL, config: Record<string, unknown> | null = CONFIG) {
  const fake = createFakeOdoo({ key: 'k', today: TODAY });
  fake.seed('res.company', [{ id: 1, name: 'Co' }]);
  fake.seed('account.journal', [{ id: 9, name: 'Miscellaneous', code: 'MISC', type: 'general' }]);
  const call = bindCall({ baseUrl: 'https://odoo.example.test', apiKey: 'k', database: 'db1', fetchImpl: fake.fetch });
  const adapter = createOdooJournalAdapter({ call, resolveJournal: async () => ({ journal, config }), today: () => TODAY });
  const moves = () => fake.rows('account.move');
  const writes = () => fake.calls.filter((c) => c.method === 'create' || c.method === 'action_post');
  return { fake, call, adapter, moves, writes };
}

describe('#895 AC-ACD-003 / AC-ACD-027 the Odoo journal adapter posts once, anchored, and reads back', () => {
  it('one entry move, posted on the desk journal and anchored with the pmo external identifier', async () => {
    const w = world();
    const result = await w.adapter.commit(COMMAND);
    expect(w.moves()).toHaveLength(1);
    const [move] = w.moves();
    expect(move).toMatchObject({ move_type: 'entry', state: 'posted', journal_id: 9, date: '2026-11-10', ref: 'Bank fee November' });
    expect(w.fake.rows('ir.model.data')).toEqual([expect.objectContaining({ module: 'pmo', name: `journal_${ID.replace(/-/g, '_')}`, model: 'account.move', res_id: move.id })]);
    expect(result).toEqual({ externalRecordId: `account.move:${move.id}`, canonical: expect.objectContaining({ id: ID, status: 'posted', posted_date: '2026-11-10', external_record_id: `account.move:${move.id}`, ledger_name: expect.any(String) }) });
    expect(await probeJournalByAnchor(w.call, KEY)).toEqual({ externalRecordId: `account.move:${move.id}` });
  });

  it('AC-ACD-027 a post re-dated by a lock is HELD with the reason, never shown Posted', async () => {
    const w = world({ ...JOURNAL, date: '2026-01-20' });
    w.fake.seed('res.company', [{ id: 1, name: 'Co', fiscalyear_lock_date: '2026-01-31' }]);
    await expect(w.adapter.commit(COMMAND)).rejects.toMatchObject({ code: 'command-held', message: 'posted in the ledger on 2026-02-01, not 2026-01-20' });
  });

  it('FR-ACD-029 no desk journal chosen: refused config-rejected with the Admin setup message and no Odoo write', async () => {
    const w = world(JOURNAL, {});
    await expect(w.adapter.commit(COMMAND)).rejects.toMatchObject({ code: 'config-rejected', message: DESK_JOURNAL_UNSET });
    expect(w.writes()).toEqual([]);
  });

  it('AC-ACD-001 an unbalanced journal is refused before any Odoo write', async () => {
    const w = world({ ...JOURNAL, lines: [JOURNAL.lines[0], { ...JOURNAL.lines[1], credit: '99.99' }] });
    await expect(w.adapter.commit(COMMAND)).rejects.toMatchObject({ code: 'commit-rejected', message: 'journal: does not balance by 0.01' });
    expect(w.writes()).toEqual([]);
  });

  it('a command whose key is not the journal\'s own is refused before any write', async () => {
    const w = world();
    await expect(w.adapter.commit({ ...COMMAND, idempotencyKey: journalKey('223e4567-e89b-12d3-a456-426614174000') })).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(w.writes()).toEqual([]);
  });

  it('recovery finishes an anchored draft (the post never happened) and adopts it: no second move', async () => {
    const w = world();
    const [id] = await w.call<number[]>('account.move', 'create', { vals_list: [{ move_type: 'entry', journal_id: 9, date: '2026-11-10', ref: 'Bank fee November', line_ids: [[0, 0, { account_id: 601, debit: 100, credit: 0 }], [0, 0, { account_id: 101, debit: 0, credit: 100 }]] }] });
    w.fake.seed('ir.model.data', [{ module: 'pmo', name: `journal_${ID.replace(/-/g, '_')}`, model: 'account.move', res_id: id }]);
    expect(await recoverOdooJournal(w.call, JOURNAL, TODAY)).toMatchObject({ externalRecordId: `account.move:${id}`, canonical: { status: 'posted', external_record_id: `account.move:${id}` } });
    expect(w.moves()).toHaveLength(1);
    expect(w.moves()[0].state).toBe('posted');
  });
});

describe('#895 AC-ACD-003 a lost answer is recovered by anchor, and HELD when the anchor is missing (OBS-ACD-002)', () => {
  it('the policy: an Odoo accounting command is never reissued on an inconclusive miss', () => {
    expect(odooJournalReissueOnInconclusiveAbsence(ACCOUNTING_DOMAIN)).toBe(false);
  });

  const outboxWorld = () => {
    const w = world();
    const probe: DispatchMoneyOutboxDeps['probeByRemarksKey'] = async () => recoverOdooJournal(w.call, JOURNAL, TODAY);
    const o = createFakeOutbox(ODOO_JOURNAL_REISSUE_ON_INCONCLUSIVE_ABSENCE, probe);
    const run = () => dispatchMoneyWrite({ adapter: w.adapter, command: COMMAND, writeReadModel: vi.fn(), recordExternalRef: vi.fn(), money: o.deps });
    /** The claimant's lease runs out, the row is quarantined, then its visibility window elapses: the next dispatch is a recovery. */
    const toRecovery = async () => {
      o.rows.get('o1')!.updatedAt = Date.now() - LEASE_MS - 1;
      await expect(run()).rejects.toMatchObject({ code: 'external-unreachable' });
      o.rows.get('o1')!.reconcileAfter = Date.now() - 1;
    };
    return { ...w, o, run, toRecovery };
  };

  it('the create answer is lost before the anchor: the probe finds nothing, the row is HELD, Odoo holds exactly one move', async () => {
    const w = outboxWorld();
    w.fake.failAt('after-create');
    await expect(w.run()).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(w.moves()).toHaveLength(1);
    await w.toRecovery();
    const outcome = await w.run().then(() => 'resolved', (e: { code?: string }) => e.code);
    expect(w.moves()).toHaveLength(1);   // the money assertion first: a reissue would have posted a second move
    expect(outcome).toBe('command-held');
    expect(w.o.state()).toBe('held');
  });

  it('the post answer is lost after the anchor: the recovery adopts the anchored move, no second move', async () => {
    const w = outboxWorld();
    w.fake.failAt('after-post');
    await expect(w.run()).rejects.toMatchObject({ code: 'external-unreachable' });
    await w.toRecovery();
    const result = await w.run();
    expect(w.o.state()).toBe('confirmed');
    expect(w.moves()).toHaveLength(1);
    expect(result.externalRecordId).toBe(`account.move:${w.moves()[0].id}`);
  });
});

describe('#895 the adapter reads the dispatch record by default', () => {
  it('posts from { journal, desk_journal_id, account_ids } with no resolver, and refuses a missing desk journal with the setup message', async () => {
    const w = world();
    const adapter = createOdooJournalAdapter({ call: w.call, bindingConfig: {}, today: () => TODAY });
    const record = { id: ID, erp_doc_kind: 'manual-journal', journal: { ...JOURNAL, lines: JOURNAL.lines.map((l) => ({ ...l, account: `code-${l.account}` })) }, account_ids: ['601', '101'] };
    await expect(adapter.commit({ ...COMMAND, record: { ...record, desk_journal_id: null } })).rejects.toMatchObject({ code: 'config-rejected', message: DESK_JOURNAL_UNSET });
    const result = await adapter.commit({ ...COMMAND, record: { ...record, desk_journal_id: 9 } });
    expect(result.canonical).toMatchObject({ id: ID, status: 'posted', posted_date: '2026-11-10' });
    expect(w.fake.rows('account.move.line').map((l) => l.account_id)).toEqual([601, 101]);
  });

  it('the org day is Asia/Jakarta (UTC+7)', () => {
    expect(jakartaToday(Date.parse('2026-11-15T17:30:00Z'))).toBe('2026-11-16');
    expect(jakartaToday(Date.parse('2026-11-15T16:59:00Z'))).toBe('2026-11-15');
  });
});
