// #895 — the Odoo journal dispatch parts refuse a command that was not rebuilt from the approved journal, before any read.
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net --allow-read odooJournal.test.ts
import { assertEquals, assertRejects } from '@std/assert';
import { resolveOdooJournalAdapter, resolveOdooJournalMoneyOutboxDeps } from './odooJournal.ts';

const ID = '89500000-0000-0000-0000-0000000000a1';
const journal = { key: `journal:${ID}`, date: '2026-11-15', memo: 'fee', lines: [] };
const reads: string[] = [];
const serviceClient = { from: (t: string) => { reads.push(t); throw new Error('no read expected'); }, rpc: (f: string) => { reads.push(f); throw new Error('no rpc expected'); } };
const ctx = (over: Record<string, unknown>) => ({
  orgId: 'org-1', userId: 'u-1', serviceClient, faultGate: {}, erpAuth: {},
  command: { domain: 'accounting', operation: 'create', idempotencyKey: journal.key, record: { id: ID, erp_doc_kind: 'manual-journal', journal }, ...over },
}) as never;

for (const resolve of [resolveOdooJournalAdapter, resolveOdooJournalMoneyOutboxDeps]) {
  Deno.test(`${resolve.name}: another domain, operation or kind is refused before any read`, async () => {
    await assertRejects(() => resolve(ctx({ domain: 'procurement' })), Error, 'only a manual-journal create');
    await assertRejects(() => resolve(ctx({ operation: 'update' })), Error, 'only a manual-journal create');
    await assertRejects(() => resolve(ctx({ record: { id: ID, erp_doc_kind: 'payment', journal } })), Error, 'only a manual-journal create');
    assertEquals(reads, []);
  });
  Deno.test(`${resolve.name}: a key that is not the approved journal's key is refused (the payload was not rebuilt)`, async () => {
    await assertRejects(() => resolve(ctx({ idempotencyKey: crypto.randomUUID() })), Error, 'not rebuilt from the approved journal');
    await assertRejects(() => resolve(ctx({ record: { id: ID, erp_doc_kind: 'manual-journal' } })), Error, 'not rebuilt from the approved journal');
    assertEquals(reads, []);
  });
}
