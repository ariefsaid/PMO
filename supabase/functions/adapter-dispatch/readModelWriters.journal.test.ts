// #895 FR-MJE-022/-116 — the `accounting` read-model writer finalizes a manual journal into PMO state through the
// service-role outcome writer; the posted date is the ledger's read-back, never the request.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net --allow-read readModelWriters.journal.test.ts
import { assertEquals, assertRejects } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';

const ID = '89500000-0000-0000-0000-0000000000a1';
const command = (date = '2026-01-20') => ({
  domain: 'accounting', operation: 'create',
  record: { id: ID, erp_doc_kind: 'manual-journal', journal: { key: `journal:${ID}`, date, memo: 'fee', lines: [] } },
}) as never;
function rig(error: { message: string; code?: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { error }; } };
  return { ctx: { serviceClient: client as never, orgId: 'org-1' }, calls };
}
const writer = getReadModelWriter('accounting');

Deno.test('FR-MJE-116 a confirmed post records posted with the ledger ref, its number and the read-back date', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, { id: ID, status: 'posted', external_record_id: 'account.move:52', ledger_name: 'MISC/2026/0052', posted_date: '2026-02-01' }, command());
  assertEquals(calls, [{ fn: 'record_journal_outcome', args: {
    p_id: ID, p_status: 'posted', p_external_record_id: 'account.move:52', p_external_name: 'MISC/2026/0052', p_posted_date: '2026-02-01', p_reason: null,
  } }]);
});

Deno.test('FR-MJE-028 a scheduled reversal records scheduled and no posted date', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, { id: ID, status: 'scheduled', external_record_id: 'account.move:53', ledger_name: null, posted_date: '2026-12-01' }, command('2026-12-01'));
  assertEquals([calls[0].args.p_status, calls[0].args.p_posted_date], ['scheduled', null]);
});

Deno.test('FR-MJE-027 a canonical with no read-back date is refused: the request date is never used', async () => {
  const { ctx, calls } = rig();
  await assertRejects(() => writer.upsert(ctx, { id: ID, status: 'posted', external_record_id: 'account.move:52', ledger_name: null, posted_date: null }, command()),
    Error, 'no ledger date');
  assertEquals(calls, []);
});

Deno.test('FR-MJE-116 an unknown status or a missing ref is refused; an RPC error surfaces', async () => {
  await assertRejects(() => writer.upsert(rig().ctx, { id: ID, status: 'approved', external_record_id: 'account.move:1', posted_date: '2026-01-20' }, command()), Error);
  await assertRejects(() => writer.upsert(rig().ctx, { id: ID, status: 'posted', posted_date: '2026-01-20' }, command()), Error);
  await assertRejects(() => writer.upsert(rig({ message: 'boom', code: 'P0001' }).ctx,
    { id: ID, status: 'posted', external_record_id: 'account.move:1', posted_date: '2026-01-20' }, command()), Error, 'boom');
});
