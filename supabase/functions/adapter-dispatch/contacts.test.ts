import { assertEquals, assert } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, jsonResponse, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
Deno.env.set('TEST_BINDING_KEY', 'synthetic-key');
Deno.env.set('TEST_BINDING_SECRET', 'synthetic-secret');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => {
  handler = h;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG = '00000000-0000-4000-8000-000000000073';
const USER = '00000000-0000-4000-8000-000000000074';
const ID = '00000000-0000-4000-8000-000000000075';
const COMPANY = '00000000-0000-4000-8000-000000000076';
const KEY = '00000000-0000-4000-8000-000000000077';
const command = (id = ID) => ({ domain: 'companies', operation: 'create', idempotencyKey: KEY,
  record: { id, erp_doc_kind: 'contact', company_id: COMPANY, full_name: 'Example Contact', email: 'contact@example.test' } });
type Row = Record<string, unknown>;

async function run(opts: { id?: string; existing?: boolean; outboxState?: string; mapped?: boolean; lookupError?: boolean; outboxError?: boolean; existingOrg?: string; role?: string; badDigest?: boolean } = {}) {
  const cmd = command(opts.id);
  let row: Row | null = opts.outboxState ? {
    id: 'synthetic-outbox', org_id: ORG, domain: 'companies', pmo_record_id: cmd.record.id,
    idempotency_key: KEY, operation: 'create', state: opts.outboxState, claim_generation: 1,
    payload_digest: opts.badDigest ? 'different-digest' : await canonicalCommandDigest(cmd),
    external_record_id: opts.outboxState === 'confirmed' || opts.outboxState === 'committed' ? 'CON-1' : null,
    canonical: opts.outboxState === 'confirmed' || opts.outboxState === 'committed' ? { ...cmd.record } : null,
  } : null;
  let mapped = opts.mapped ?? false;
  const jwt = await auth.mintJwt({ sub: USER });
  const result = await withFetchMock([{
    label: 'contact served boundary',
    response: (call: FetchCall) => {
      const path = call.url.pathname;
      const table = path.split('/').at(-1)!;
      const id = call.url.searchParams.get('id')?.slice(3);
      const pmoId = call.url.searchParams.get('pmo_record_id')?.slice(3);
      if (path.startsWith('/rest/v1/rpc/')) {
        if (table === 'read_vault_secret') return jsonResponse('synthetic-key:synthetic-secret');
        if (table === 'actor_authorization_state') return jsonResponse({ role: opts.role ?? 'Project Manager', active: true });
        if (table === 'domain_owned_by_tier' || table === 'org_has_active_erpnext_binding') return jsonResponse(true);
        if (table === 'claim_outbox_for_commit') {
          if (row) row = { ...row, state: 'committing', claim_generation: Number(row.claim_generation) + 1 };
          return jsonResponse(row);
        }
        if (table === 'record_outbox_ref') { mapped = true; return jsonResponse(1); }
        if (table === 'confirm_outbox') { if (row) row.state = 'confirmed'; return jsonResponse(1); }
        if (table === 'mark_outbox_held') { if (row) row.state = 'held'; return jsonResponse(1); }
        throw new Error(`unexpected RPC ${table}`);
      }
      if (path.startsWith('/rest/v1/')) {
        if (table === 'profiles') return jsonResponse({ org_id: ORG });
        if (table === 'external_refs') {
          if (pmoId === COMPANY) return jsonResponse({ external_record_id: 'Customer:CUST-1' });
          return jsonResponse(mapped ? { external_record_id: 'Contact:CON-1' } : null);
        }
        if (table === 'external_org_bindings') return jsonResponse({ site_url: 'https://erp.example.test', secret_ref: 'test-binding', activated_at: '2026-01-01', version_major: 15, config: {} });
        if (table === 'companies') return jsonResponse(id === COMPANY ? { id: COMPANY, org_id: ORG } : null);
        if (table === 'contacts') {
          if (call.method !== 'GET') return jsonResponse([]);
          if (opts.lookupError) return jsonResponse({ code: 'XX000', message: 'synthetic lookup failure' }, { status: 500 });
          const existingOrg = opts.existingOrg ?? ORG;
          const orgFilter = call.url.searchParams.get('org_id')?.slice(3);
          const visible = opts.existing && (orgFilter === undefined || orgFilter === existingOrg);
          return jsonResponse(visible ? { id: cmd.record.id, org_id: existingOrg } : null);
        }
        if (table === 'external_command_outbox') {
          if (opts.outboxError && call.method === 'GET') return jsonResponse({ code: 'XX000', message: 'synthetic outbox lookup failure' }, { status: 500 });
          if (call.method === 'POST') row = { ...(call.bodyJson as Row), id: 'synthetic-outbox', claim_generation: 0, external_record_id: null, canonical: null };
          if (call.method === 'PATCH' && row) Object.assign(row, call.bodyJson);
          return jsonResponse(call.method === 'PATCH' ? [{ id: row?.id }] : row);
        }
        throw new Error(`unexpected table ${table}`);
      }
      if (path === '/api/resource/Contact' && call.method === 'POST') return jsonResponse({ data: { ...(call.bodyJson as Row), name: 'CON-1' } });
      throw new Error(`unexpected ERP ${call.method} ${path}`);
    },
  }], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd),
    }));
    return { status: res.status, body: await res.json(), calls };
  });
  return { ...result, row };
}
const erpWrites = (calls: FetchCall[]) => calls.filter((c) => c.url.pathname.startsWith('/api/resource/') && c.method !== 'GET');

Deno.test('AC-CON-003 authenticated contact create validates UUID before ERP authoring', async () => {
  for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000075:extra']) {
    const result = await run({ id });
    assertEquals(result.status, 422, JSON.stringify(result.body));
    assertEquals(erpWrites(result.calls).length, 0);
  }
});
Deno.test('AC-CON-003 authenticated contact create requires a new local identity', async () => {
  const result = await run({ existing: true });
  assertEquals(result.status, 422, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
Deno.test('AC-CON-003 contact identity occupied in another org is refused before ERP authoring', async () => {
  const result = await run({ existing: true, existingOrg: '00000000-0000-4000-8000-0000000000ff' });
  assertEquals(result.status, 422, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
Deno.test('AC-CON-003 fresh authenticated contact command creates one ERP contact', async () => {
  const result = await run();
  assertEquals(result.status, 200, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 1);
  assertEquals(result.row?.state, 'confirmed');
});
Deno.test('AC-CON-003 authenticated contact replay preserves the same command identity', async () => {
  for (const outboxState of ['committed', 'confirmed']) {
    const result = await run({ existing: true, mapped: true, outboxState });
    assertEquals(result.status, 200, JSON.stringify(result.body));
    assertEquals(erpWrites(result.calls).length, 0);
  }
});
Deno.test('AC-CON-003 contact recovery holds an inconclusive quarantined command', async () => {
  const result = await run({ outboxState: 'quarantined' });
  assertEquals(result.body.error, 'command-held', JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
  assertEquals(result.row?.state, 'held');
});
Deno.test('AC-CON-003 contact replay rejects changed material payload', async () => {
  const result = await run({ existing: true, mapped: true, outboxState: 'confirmed', badDigest: true });
  assert(result.status >= 400, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
Deno.test('AC-CON-003 contact identity lookups fail closed', async () => {
  const result = await run({ existing: true, lookupError: true });
  assert(result.status >= 400, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
Deno.test('AC-CON-003 contact command retains caller authorization', async () => {
  const result = await run({ role: 'Engineer' });
  assertEquals(result.status, 403);
  assertEquals(erpWrites(result.calls).length, 0);
});

Deno.test('AC-CON-003 contact retry outbox lookup failure refuses authoring', async () => {
  const result = await run({ existing: true, mapped: true, outboxState: 'committed', outboxError: true });
  assert(result.status >= 400, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
Deno.test('AC-CON-003 known local identity cannot author again from a pending replay', async () => {
  const result = await run({ existing: true, outboxState: 'pending' });
  assert(result.status >= 400, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
const outboxWrites = (calls: FetchCall[]) => calls.filter((c) => c.url.pathname === '/rest/v1/external_command_outbox' && c.method !== 'GET');
Deno.test('AC-CON-003 occupied contact identity in any org is refused before the command is recorded', async () => {
  for (const existingOrg of [ORG, '00000000-0000-4000-8000-0000000000ff']) {
    const result = await run({ existing: true, existingOrg });
    assertEquals(result.status, 422, JSON.stringify(result.body));
    assertEquals(outboxWrites(result.calls).length, 0);
    assertEquals(erpWrites(result.calls).length, 0);
  }
});
Deno.test('AC-CON-003 contact identity lookup failure is refused before the command is recorded', async () => {
  const result = await run({ existing: true, lookupError: true });
  assertEquals(result.status, 503, JSON.stringify(result.body));
  assertEquals(outboxWrites(result.calls).length, 0);
  assertEquals(erpWrites(result.calls).length, 0);
});
Deno.test('AC-CON-003 identity occupied in another org cannot author from a pending replay', async () => {
  const result = await run({ existing: true, existingOrg: '00000000-0000-4000-8000-0000000000ff', outboxState: 'pending' });
  assert(result.status >= 400, JSON.stringify(result.body));
  assertEquals(erpWrites(result.calls).length, 0);
});
