// #895 FR-MJE-022 — the manual-journal dispatch gate, unit-proven at the seam.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net --allow-read --config deno.json journalGuard.test.ts
//
// The property under test: whether a journal posts, and WHAT posts, both come from `approved_journal_for_push`
// read under the caller's own JWT — never from the command payload (ADR-0059 §3.3).
import { assert, assertEquals } from 'jsr:@std/assert';
import { applyCanonicalJournalTruth, enforceJournalApproved, isJournalPush, JOURNAL_DOMAIN, type JournalRpcClient } from './journalGuard.ts';

const ID = '89500000-0000-0000-0000-0000000000a1';
const client = (result: { data: unknown; error: { code?: string; message: string } | null }): JournalRpcClient & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return { calls, rpc(fn: string, args: Record<string, unknown>) { calls.push({ fn, args }); return Promise.resolve(result); } };
};
const ROW = {
  id: ID, key: `journal:${ID}`, date: '2026-11-15', memo: 'Bank fee', tier: 'odoo', desk_journal_id: '3', status: 'approved',
  reverses: null,
  lines: [
    { account: '6100', account_id: '601', debit: '25000.00', credit: '0.00', partner: null, analytic: '77', label: 'fee' },
    { account: '1100', account_id: '101', debit: '0.00', credit: '25000.00', partner: null, analytic: null, label: 'fee' },
  ],
};
const command = (record: Record<string, unknown>) => ({ domain: JOURNAL_DOMAIN, operation: 'create', record, idempotencyKey: 'caller-key' });

Deno.test('isJournalPush: only an accounting-domain manual-journal command', () => {
  assert(isJournalPush(command({ id: ID, erp_doc_kind: 'manual-journal' })));
  assert(!isJournalPush({ domain: 'procurement', record: { id: ID, erp_doc_kind: 'manual-journal' } }));
  assert(!isJournalPush({ domain: JOURNAL_DOMAIN, record: { id: ID, erp_doc_kind: 'payment' } }));
});

Deno.test('FR-MJE-022 an approved journal passes and the gate hands back the server-read journal', async () => {
  const c = client({ data: ROW, error: null });
  const r = await enforceJournalApproved(c, ID);
  assert(r.ok);
  assertEquals(c.calls, [{ fn: 'approved_journal_for_push', args: { p_id: ID } }]);
  assertEquals(r.journal?.ledger, { key: `journal:${ID}`, date: '2026-11-15', memo: 'Bank fee', lines: [
    { account: '6100', debit: '25000.00', credit: '0.00', analytic: '77', label: 'fee' },
    { account: '1100', debit: '0.00', credit: '25000.00', label: 'fee' },
  ] });
  assertEquals(r.journal?.accountIds, ['601', '101']);
  assertEquals(r.journal?.deskJournalId, 3);
});

Deno.test('FR-MJE-022 a draft or submitted journal (RPC 42501) is refused 403', async () => {
  const r = await enforceJournalApproved(client({ data: null, error: { code: '42501', message: 'only an approved journal can be posted' } }), ID);
  assertEquals([r.ok, r.status, r.message], [false, 403, 'only an approved journal can be posted']);
});

Deno.test('OQ-4 the desk-journal setup refusal reaches the caller in plain words', async () => {
  const msg = 'An Admin must choose the Odoo journal for desk entries in Odoo setup before journals can post';
  const r = await enforceJournalApproved(client({ data: null, error: { code: 'P0001', message: msg } }), ID);
  assertEquals([r.ok, r.status, r.message], [false, 422, msg]);
});

Deno.test('FR-MJE-022 an RPC failure or an empty answer refuses (fail closed)', async () => {
  assertEquals((await enforceJournalApproved(client({ data: null, error: { code: 'XX000', message: 'boom' } }), ID)).ok, false);
  assertEquals((await enforceJournalApproved(client({ data: null, error: null }), ID)).ok, false);
  assertEquals((await enforceJournalApproved(client({ data: { ...ROW, lines: [] }, error: null }), ID)).ok, false);
  assertEquals((await enforceJournalApproved(client({ data: { ...ROW, key: 'po:x' }, error: null }), ID)).ok, false);
  assertEquals((await enforceJournalApproved(client({ data: { ...ROW, lines: [ROW.lines[0], { ...ROW.lines[1], credit: '1.00' }] }, error: null }), ID)).ok, false);
});

Deno.test('FR-MJE-022 a non-uuid record id is refused before any read', async () => {
  const c = client({ data: ROW, error: null });
  const r = await enforceJournalApproved(c, 'not-a-uuid');
  assertEquals([r.ok, r.status], [false, 422]);
  assertEquals(c.calls, []);
});

Deno.test('FR-MJE-022 the body comes only from the server read: a forged payload amount and key are discarded', async () => {
  const r = await enforceJournalApproved(client({ data: ROW, error: null }), ID);
  const cmd = command({ id: ID.toUpperCase(), erp_doc_kind: 'manual-journal', lines: [{ account: '6100', debit: '9999999.00', credit: '0.00' }], amount: '1.00' });
  applyCanonicalJournalTruth(cmd, r.journal!);
  assertEquals(cmd.idempotencyKey, `journal:${ID}`);
  assertEquals(cmd.record.id, ID);
  assertEquals(cmd.record.amount, undefined);
  assertEquals((cmd.record.journal as { lines: Array<{ debit: string }> }).lines[0].debit, '25000.00');
});

Deno.test('FR-MJE-025 a reversal carries its own reversal key and the original ledger ref', async () => {
  const rev = { ...ROW, key: `journal-rev:${ID}`, reverses: { journal_id: '89500000-0000-0000-0000-0000000000a0', external_record_id: 'account.move:52', reason: 'Charged twice' } };
  const r = await enforceJournalApproved(client({ data: rev, error: null }), ID);
  assert(r.ok);
  assertEquals(r.journal?.ledger.reverses, { externalRecordId: 'account.move:52', reason: 'Charged twice' });
  assertEquals(r.journal?.ledger.key, `journal-rev:${ID}`);
});
