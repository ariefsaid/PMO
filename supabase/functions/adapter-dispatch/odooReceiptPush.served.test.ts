// #1506 C5 D-lane (AC-OCI-044b / AC-OCI-046): the shipped dispatch handler stamps the receipt
// recorder from the verified JWT and refuses a withholding shape before opening the money outbox.
// Supabase and Odoo are modeled as facts over fetch; the Odoo adapter is the stock fake.
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, withFetchMock,
  type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';
import { APPROVER_ID, AUTHOR_ID, RECEIPT_ID, receiptCommand, receiptOdooWorld, revenueRoutes, type World } from './odooRevenueFixtures.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

async function dispatch(record: Record<string, unknown>, sharedWorld?: World, caller = APPROVER_ID) {
  const unexpected: FetchCall[] = [];
  const world: World = sharedWorld ?? { odoo: receiptOdooWorld(), writes: [] };
  const writes = world.writes ?? (world.writes = []);
  const odoo = (world.odoo ?? (world.odoo = receiptOdooWorld())) as ReturnType<typeof receiptOdooWorld>;
  const result = await withFetchMock(revenueRoutes(unexpected, caller, world), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: caller });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(receiptCommand(record)),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  assertEquals(unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'all reads have explicit fixture facts');
  return { ...result, odoo, writes, world };
}

describe('AC-OCI-046 the receipt recorder is the verified JWT subject', () => {
  it('ignores every payload spelling of a forged recorder and stamps the server mirror from the JWT', async () => {
    const r = await dispatch({
      date: '2026-11-03', paid_amount: 111000, received_amount: 111000,
      recorded_by: 'forged-user', recorded_by_id: 'forged-user', recordedBy: 'forged-user',
    });
    assertEquals(r.status, 200, r.body);
    const mirror = r.writes.find((w) => w.table === 'incoming_payments' && w.method === 'POST')?.body as Record<string, unknown> | undefined;
    assert(mirror, 'the shipped read-model writer inserted the receipt mirror');
    assertEquals(mirror.recorded_by_id, APPROVER_ID, 'the verified subject, never the payload, is recorded');
    const outbox = r.calls.find((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/external_command_outbox');
    assert(outbox, 'the command traversed the shipped money outbox');
    const stored = (outbox.bodyJson as { payload: Record<string, unknown> }).payload;
    assertEquals(['recorded_by', 'recorded_by_id', 'recordedBy'].some((key) => key in stored), false, 'actor claims do not enter persisted command material');
    assertEquals(r.odoo.calls.some((call) => JSON.stringify(call).includes('forged-user')), false, 'actor claims never reach Odoo');
    assertEquals(r.odoo.rows('account.payment').length, 1);
    assertEquals(r.odoo.rows('account.payment')[0].reconciled_invoice_ids, [301]);
    assertEquals(RECEIPT_ID, (mirror.id as string));
  });
});

describe('AC-OCI-044b an unsupported withholding shape is refused before an outbox command', () => {
  it('refuses partial withholding by a named reason with no outbox row and no Odoo write', async () => {
    const r = await dispatch({
      date: '2026-11-03', paid_amount: 70000, received_amount: 68000, withheld_amount: 2000,
      withholding_slip_number: 'BP-TEST-1',
    });
    assertEquals(r.status, 422, r.body);
    assertEquals(JSON.parse(r.body).message, 'config-rejected: withheld-partial');
    assertEquals(r.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/external_command_outbox').length, 0, 'the refusal leaves no outbox row');
    assertEquals(r.odoo.calls.filter((call) => !['read', 'search_read', 'search_count'].includes(call.method)), [], 'the refusal writes nothing to Odoo');
  });

  it('AC-OCI-045 a tax-prepaid account outside company currency is refused before an outbox command', async () => {
    const world: World = { odoo: receiptOdooWorld(), writes: [] };
    const taxAccount = (world.odoo as ReturnType<typeof receiptOdooWorld>).rows('account.account').find((row) => row.id === 88)!;
    taxAccount.currency_id = [99, 'USD'];
    const r = await dispatch({
      date: '2026-11-03', paid_amount: 111000, received_amount: 109000, withheld_amount: 2000,
      withholding_slip_number: 'BP-TEST-2',
    }, world);
    assertEquals(r.status, 422, r.body);
    assertEquals(JSON.parse(r.body).message, 'config-rejected: account-currency');
    assertEquals(r.calls.filter((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/external_command_outbox').length, 0);
    assertEquals(r.odoo.calls.filter((call) => !['read', 'search_read', 'search_count'].includes(call.method)), []);
  });
});

describe('FR-OCI-070 / FR-OCI-075 a same-key receipt replay is the same intent after Odoo has settled the invoice', () => {
  it('AC-OCI-042 retries a lost reconcile response through the shipped outbox probe and settles the same receipt once', async () => {
    const world: World = { odoo: receiptOdooWorld(), writes: [], outbox: new Map() };
    const fake = world.odoo as ReturnType<typeof receiptOdooWorld>;
    fake.failAt('after-reconcile');
    const record = { date: '2026-11-03', paid_amount: 111000, received_amount: 111000 };

    const first = await dispatch(record, world, APPROVER_ID);

    assert(first.status !== 200, 'a lost Odoo response remains pending instead of claiming success');
    assertEquals([fake.rows('account.payment').length, fake.rows('account.move')[0].amount_residual], [1, 0]);
    const outboxKey = `${RECEIPT_ID}|${receiptCommand(record).idempotencyKey}`;
    const stranded = world.outbox!.get(outboxKey);
    assert(stranded, 'the failed claimant left its persisted money command');
    // A lost invocation remains `committing` until its claim lease expires, then the reconciler
    // quarantines it. Model that post-lease state directly so this retry exercises the shipped probe.
    world.outbox!.set(outboxKey, { ...stranded, state: 'quarantined', claim_generation: 1 });
    const retry = await dispatch(record, world, AUTHOR_ID);

    assertEquals(retry.status, 200, retry.body);
    assertEquals(fake.rows('account.payment').length, 1, 'the outbox probe adopts the committed receipt');
    assertEquals(['create', 'action_post', 'reconcile'].map((method) => fake.calls.filter((call) =>
      call.model === (method === 'reconcile' ? 'account.move.line' : 'account.payment') && call.method === method).length), [1, 1, 1]);
    assertEquals(retry.writes.filter((write) => write.table === 'incoming_payments' && write.method === 'POST').length, 1);
    const mirror = retry.writes.find((write) => write.table === 'incoming_payments' && write.method === 'POST')?.body as Record<string, unknown>;
    assertEquals(mirror.recorded_by_id, APPROVER_ID, 'the original JWT actor persisted on the outbox command remains the receipt recorder');
  });

  it('returns the confirmed receipt without rejecting its now-zero invoice residual or posting a second payment', async () => {
    const idempotencyKey = 'cccccccc-cccc-4ccc-8ccc-000000001507';
    const world: World = { odoo: receiptOdooWorld(), writes: [], outbox: new Map() };
    const record = { date: '2026-11-03', paid_amount: 111000, received_amount: 111000 };
    const first = await dispatch(record, world);
    assertEquals(first.status, 200, first.body);
    assertEquals(first.odoo.rows('account.move')[0].amount_residual, 0);
    const firstBody = JSON.parse(first.body) as { externalRecordId: string; canonical: Record<string, unknown> };
    const key = `${RECEIPT_ID}|${idempotencyKey}`;
    const row = world.outbox!.get(key);
    assert(row, 'the first dispatch left its durable money command');
    world.outbox!.set(key, { ...row, state: 'confirmed', external_record_id: firstBody.externalRecordId, canonical: firstBody.canonical });
    const writesBeforeReplay = first.odoo.calls.filter((call) => !['read', 'search_read', 'search_count'].includes(call.method)).length;

    const replay = await dispatch(record, world);

    assertEquals(replay.status, 200, replay.body);
    assertEquals(JSON.parse(replay.body), firstBody);
    assertEquals(replay.odoo.rows('account.payment').length, 1);
    assertEquals(['create', 'action_post', 'reconcile'].map((method) => replay.odoo.calls.filter((call) =>
      call.model === (method === 'reconcile' ? 'account.move.line' : 'account.payment') && call.method === method).length), [1, 1, 1]);
    assertEquals(replay.odoo.calls.filter((call) => !['read', 'search_read', 'search_count'].includes(call.method)).length, writesBeforeReplay, 'a confirmed replay is read-only in Odoo');
  });
});
