import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const results: Record<string, { data: unknown; error: unknown }> = {};
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      c[m] = (...a: unknown[]) => { calls.push([table, m, ...a]); return c; };
    }
    c.maybeSingle = () => { calls.push([table, 'maybeSingle']); return Promise.resolve(results[table]); };
    c.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(results[table]).then(ok, bad);
    return c;
  };
  const rpc = vi.fn(async (fn: string, args: unknown) => { calls.push(['rpc', fn, args]); return results[`rpc:${fn}`] ?? { data: null, error: null }; });
  return { calls, results, chain, rpc };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: (t: string) => h.chain(t), rpc: h.rpc } }));

import * as dal from './journals';

beforeEach(() => { h.calls.length = 0; for (const k of Object.keys(h.results)) delete h.results[k]; });

describe('journals DAL (#895)', () => {
  it('listJournals asks list_journals for the range and returns its rows', async () => {
    h.results['rpc:list_journals'] = { data: [{ origin: 'pmo', id: 'j1', status: 'posted' }], error: null };
    await expect(dal.listJournals('2026-11-01', '2026-11-30')).resolves.toEqual([{ origin: 'pmo', id: 'j1', status: 'posted' }]);
    expect(h.calls).toContainEqual(['rpc', 'list_journals', { p_from: '2026-11-01', p_to: '2026-11-30' }]);
  });

  it('a refused RPC throws an AppError with its code', async () => {
    h.results['rpc:submit_journal'] = { data: null, error: { message: 'the journal does not balance by 0.01', code: 'P0001' } };
    await expect(dal.submitJournal('j1')).rejects.toMatchObject({ message: 'the journal does not balance by 0.01', code: 'P0001' });
  });

  it('saveJournalDraft sends null for a new draft and the exact line list', async () => {
    h.results['rpc:save_journal_draft'] = { data: 'j9', error: null };
    const lines = [{ account: '6100', debit: '10.00', credit: '0.00', label: '' }];
    await expect(dal.saveJournalDraft({ id: null, kind: 'fee', date: '2026-11-15', memo: 'Bank fee', lines })).resolves.toBe('j9');
    expect(h.calls).toContainEqual(['rpc', 'save_journal_draft', { p_id: null, p_kind: 'fee', p_date: '2026-11-15', p_memo: 'Bank fee', p_lines: lines }]);
  });

  it('every verb names its RPC and arguments', async () => {
    h.results['rpc:request_journal_reversal'] = { data: 'j2', error: null };
    await dal.approveJournal('j1');
    await dal.returnJournal('j1', 'wrong account');
    await expect(dal.requestJournalReversal('j1', '2026-11-20', 'posted twice')).resolves.toBe('j2');
    await dal.setDeskJournal('7');
    expect(h.calls).toEqual(expect.arrayContaining([
      ['rpc', 'approve_journal', { p_id: 'j1' }],
      ['rpc', 'return_journal', { p_id: 'j1', p_reason: 'wrong account' }],
      ['rpc', 'request_journal_reversal', { p_original: 'j1', p_date: '2026-11-20', p_reason: 'posted twice' }],
      ['rpc', 'set_desk_journal', { p_journal_id: '7' }],
    ]));
  });

  it('getLedgerSetup reads journal_ledger_setup; a missing answer reads as no ledger', async () => {
    h.results['rpc:journal_ledger_setup'] = { data: { tier: 'odoo', desk_journal_id: null, needs_desk_journal: true }, error: null };
    await expect(dal.getLedgerSetup()).resolves.toEqual({ tier: 'odoo', desk_journal_id: null, needs_desk_journal: true });
    h.results['rpc:journal_ledger_setup'] = { data: null, error: null };
    await expect(dal.getLedgerSetup()).resolves.toEqual({ tier: null, desk_journal_id: null, needs_desk_journal: false });
  });

  it('getJournal reads the entry, its lines in order, its author set and, for a reversal, the original\'s authors', async () => {
    h.results.journal_entries = { data: { id: 'j2', maker_id: 'u1', reverses_journal_id: 'j1' }, error: null };
    h.results.journal_entry_lines = { data: [{ line_no: 1, account: '6100', debit: '10.00', credit: '0.00' }], error: null };
    h.results.journal_entry_authors = { data: [{ journal_id: 'j2', profile_id: 'u1' }, { journal_id: 'j1', profile_id: 'u0' }], error: null };
    const out = await dal.getJournal('j2');
    expect(out).toEqual({
      entry: { id: 'j2', maker_id: 'u1', reverses_journal_id: 'j1' },
      lines: [{ line_no: 1, account: '6100', debit: '10.00', credit: '0.00' }],
      authorIds: ['u1'],
      originalAuthorIds: ['u0'],
    });
    expect(h.calls).toContainEqual(['journal_entry_lines', 'order', 'line_no', { ascending: true }]);
    expect(h.calls).toContainEqual(['journal_entry_authors', 'in', 'journal_id', ['j2', 'j1']]);
  });

  it('getJournal returns null for a journal the caller cannot read', async () => {
    h.results.journal_entries = { data: null, error: null };
    await expect(dal.getJournal('nope')).resolves.toBeNull();
  });
});
