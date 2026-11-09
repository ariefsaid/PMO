/**
 * #1504 S8-T2 — the tier-neutral send drain. A stub tier stands in for the ERP so the loop's own contract is pinned: the tier name reaches
 * every claim, the connection opens only when something was claimed, a probe miss is reissued or held as the tier says, and org B is never
 * named. (ERPNext's full journey stays in erpnext-sweep/connectSends.test.ts, which runs through this core unchanged.)
 */
import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { ConnectAdapter } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { CONNECT_SEND_REJECTION_TEXT, drainSends, type SendTier } from './connectSendsCore.ts';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute } from './testing/edgeTestKit.ts';

const env = installEdgeEnv();
afterAll(() => env.restore());
const ORG = 'org-a';
const org = { orgId: ORG, bindingId: 'binding-a' };
const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
const body = (c: FetchCall) => c.bodyJson as Record<string, unknown>;
const P = (id: string, kind: string, pmo: string) => ({ id, kind, pmo_ids: [pmo], decided_by: 'admin-1', snapshot: {} });

function run(claimed: unknown[], tier: Partial<SendTier> & { send?: ConnectAdapter['sendMaster'] }, outbox: Array<Record<string, unknown>> = []) {
  const sends: string[] = [];
  const t: SendTier = {
    tier: 'stub',
    open: async () => ({
      connect: { tier: 'stub', listMasters: async () => ({ rows: [], nextCursor: null }), countDomain: async () => 0,
        sendMaster: tier.send ?? (async (kind, rec) => { sends.push(`${kind}:${rec.id}`); return { externalId: `X-${rec.id}` }; }) },
      probe: async () => null,
    }),
    reissueOnInconclusiveAbsence: () => false,
    reasonOf: () => null,
    ...tier,
  };
  const f = (c: FetchCall, k: string) => c.url.searchParams.get(k)?.replace(/^eq\./, '');
  const routes: MockRoute[] = [
    supabaseRpc('enqueue_new_item_sends', () => jsonResponse(0)),
    supabaseRpc('claim_connect_sends', () => jsonResponse(claimed)),
    supabaseRpc('connect_send_existing_link', () => jsonResponse(null)),
    supabaseSelect('companies', () => one({ id: 'c-1', name: 'PT Sinar Baja', type: 'Vendor', erp_tax_id: null })),
    supabaseSelect('profiles', () => one({ id: 'admin-1' })),
    supabaseRpc('record_connect_send_result', () => jsonResponse(null)),
    supabaseRpc('record_connect_send_held', () => jsonResponse(null)),
    supabaseSelect('external_command_outbox', (c) => {
      const row = outbox.find((x) => x.idempotency_key === f(c, 'idempotency_key'));
      return row ? one(row) : none();
    }),
    { label: 'outbox-insert', method: 'POST', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const b = body(c);
      const row = { id: `ob-${outbox.length + 1}`, domain: b.domain, pmo_record_id: b.pmo_record_id, idempotency_key: b.idempotency_key, state: 'pending', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null };
      outbox.push(row);
      return one(row);
    } },
    { label: 'outbox-update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox', response: (c: FetchCall) => {
      const row = outbox.find((x) => x.id === f(c, 'id'))!;
      Object.assign(row, c.bodyJson);
      return jsonResponse([{ id: row.id }]);
    } },
    supabaseRpc('claim_outbox_for_commit', (c) => {
      const row = outbox.find((x) => x.id === body(c).p_id)!;
      Object.assign(row, { state: 'committing', claim_generation: Number(row.claim_generation) + 1 });
      return jsonResponse(row);
    }),
    supabaseRpc('quarantine_committing', (c) => {
      const row = outbox.find((x) => x.id === body(c).p_id)!;
      if (row.state === 'committing') row.state = 'quarantined';
      return jsonResponse(row);
    }),
    supabaseRpc('confirm_outbox', (c) => { outbox.find((x) => x.id === body(c).p_id)!.state = 'confirmed'; return jsonResponse(1); }),
    supabaseRpc('mark_outbox_held', (c) => { outbox.find((x) => x.id === body(c).p_id)!.state = 'held'; return jsonResponse(1); }),
  ];
  const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return withFetchMock(routes, async ({ calls }) => ({ result: await drainSends(sc, org, t), calls, sends, outbox }));
}

describe('S8-T2 drainSends (tier-neutral core)', () => {
  it('AC-ECA-010 the tier name reaches the queue and the claim; a claimed party is sent and recorded under its anchor', async () => {
    const { result, calls, sends } = await run([P('prop-1', 'party', 'c-1')], {});
    assertEquals(body(rpcCall(calls, 'enqueue_new_item_sends')[0]), { p_org_id: ORG, p_tier: 'stub' });
    assertEquals(body(rpcCall(calls, 'claim_connect_sends')[0]).p_tier, 'stub');
    assertEquals(sends, ['party:c-1']);
    assertEquals(rpcCall(calls, 'record_connect_send_result').map((c) => [body(c).p_id, body(c).p_external_id, body(c).p_rejection]), [['prop-1', 'X-c-1', null]]);
    assertEquals(result, { sent: 1, rejected: 0, held: 0, pending: 0 });
  });

  it('nothing claimed: the connection is never opened', async () => {
    let opened = 0;
    const { result } = await run([], { open: async () => { opened += 1; return { refusal: 'x' }; } });
    assertEquals([opened, result], [0, { sent: 0, rejected: 0, held: 0, pending: 0 }]);
  });

  it('an unusable connection keeps every claimed row pending and records nothing', async () => {
    const { result, calls } = await run([P('a', 'party', 'c-1'), P('b', 'party', 'c-1')], { open: async () => ({ refusal: 'kill-switch' }) });
    assertEquals(result, { sent: 0, rejected: 0, held: 0, pending: 2, error: 'connection:kill-switch' });
    assertEquals(rpcCall(calls, 'record_connect_send_result').length, 0);
  });

  it('a person is rejected with the tier\'s own words, never sent', async () => {
    const { result, calls, sends } = await run([P('e', 'employee', 'u-1')], { personText: 'Add this person in the ERP by hand.' });
    assertEquals(rpcCall(calls, 'record_connect_send_result').map((c) => body(c).p_rejection), ['Add this person in the ERP by hand.']);
    assertEquals([sends.length, result.rejected], [0, 1]);
  });

  it('external-unreachable stops the tick and records nothing; the rest wait', async () => {
    const { result, calls } = await run([P('a', 'party', 'c-1'), P('b', 'party', 'c-1')], { send: async () => { throw new AdapterError('external-unreachable', 'unreachable'); } });
    assertEquals(result, { sent: 0, rejected: 0, held: 0, pending: 2 });
    assertEquals(rpcCall(calls, 'record_connect_send_result').length + rpcCall(calls, 'record_connect_send_held').length, 0);
  });

  it('commit-rejected is recorded with the tier\'s short reason', async () => {
    const { calls } = await run([P('a', 'party', 'c-1')], { send: async () => { throw new AdapterError('commit-rejected', 'validation'); }, reasonOf: () => 'the VAT number is not valid' });
    assertEquals(rpcCall(calls, 'record_connect_send_result').map((c) => body(c).p_rejection), [CONNECT_SEND_REJECTION_TEXT.refused('party', 'the VAT number is not valid')]);
  });

  it('an earlier undecided create is held when the tier says never reissue, and sent again when it says it may', async () => {
    const earlier = () => [{ id: 'ob-0', domain: 'companies', pmo_record_id: 'c-1', idempotency_key: 'seed:party:c-1', state: 'quarantined', external_record_id: null, canonical: null, claim_generation: 1, payload_digest: null }];
    const held = await run([P('a', 'party', 'c-1')], { reissueOnInconclusiveAbsence: () => false }, earlier());
    assertEquals([held.result.held, held.sends.length], [1, 0]);
    const again = await run([P('a', 'party', 'c-1')], { reissueOnInconclusiveAbsence: () => true }, earlier());
    assertEquals([again.result.sent, again.sends.length], [1, 1]);
  });

  it('NFR-ECA-003 every claim and record names this org only', async () => {
    const { calls } = await run([P('a', 'party', 'c-1')], {});
    assertEquals(JSON.stringify(calls.map((c) => [c.url.toString(), c.bodyText])).includes('org-b'), false);
  });
});
