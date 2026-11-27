// #2789 — a price-hidden requester can ask the shipped assistant about their own request without receiving its price.
// Drives the exported edge handler with a real signed JWT and a mocked wire; the raw procurements endpoint is rejected.
import { assertEquals, assert } from 'jsr:@std/assert@1.0.0';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { AgentEvent } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';

const SUPABASE_URL = 'https://edge-test.supabase.test';
const ORG_ID = 'a9278900-0000-4000-8000-00000000a001';
const USER_ID = 'a9278900-0000-4000-8000-00000000a002';
const RUN_ID = 'a9278900-0000-4000-8000-00000000a003';
const THREAD_ID = 'a9278900-0000-4000-8000-00000000a004';
const REQUEST_ID = 'a9278900-0000-4000-8000-00000000a005';
const WITHHELD_VALUE = '987654321';

const { handleAgentChatRequest, setTestJwks } = await import('./index.ts');
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'edge-test-hide-prices';
publicJwk.alg = 'ES256';
publicJwk.use = 'sig';
setTestJwks(createLocalJWKSet({ keys: [publicJwk] }));

async function token(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'edge-test-hide-prices' })
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setSubject(USER_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
}

async function drive() {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'OPENROUTER_API_KEY', 'AGENT_PERSISTENCE', 'AGENT_VERIFY_ANSWER'];
  const previous = Object.fromEntries(names.map((name) => [name, Deno.env.get(name)]));
  for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon-key', OPENROUTER_API_KEY: 'synthetic-model-key', AGENT_PERSISTENCE: 'false', AGENT_VERIFY_ANSWER: 'false' })) Deno.env.set(name, value);

  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  const procurementPaths: string[] = [];
  const script = [
    { finish_reason: 'tool_calls', content: null, tool_calls: [{ id: 'call-hide-price', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'procurements', columns: ['id', 'title', 'total_value'], filter: { column: 'id', op: 'eq', value: REQUEST_ID } }) } }] },
    { finish_reason: 'stop', content: 'You have one purchase request: Field gloves.' },
  ];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    const body = request.method === 'GET' ? '' : await request.clone().text();
    if (route === 'POST /api/v1/chat/completions') {
      const step = script[modelCalls++];
      if (!step) throw new Error('mock: unexpected extra model call');
      return Response.json({ model: 'test-model-hide-prices', choices: [{ finish_reason: step.finish_reason, message: { role: 'assistant', content: step.content, ...(step.tool_calls ? { tool_calls: step.tool_calls } : {}) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    switch (route) {
      case 'POST /rest/v1/rpc/rate_limit_hit': return Response.json(true);
      case 'POST /rest/v1/rpc/service_feature_enabled': {
        const key = (JSON.parse(body) as { p_key: string }).p_key;
        return Response.json(key === 'agent_assistant');
      }
      case 'POST /rest/v1/rpc/resolved_org_features':
        return Response.json([{ feature_key: 'agent_assistant', enabled: true }, { feature_key: 'procurement', enabled: true }]);
      case 'GET /rest/v1/profiles': {
        const select = url.searchParams.get('select');
        if (select === 'org_id') return Response.json({ org_id: ORG_ID });
        if (select === 'org_id,role') return Response.json({ org_id: ORG_ID, role: 'Site Supervisor' });
        throw new Error(`mock: unexpected profiles select ${select}`);
      }
      case 'GET /rest/v1/organizations': return Response.json({ default_timezone: 'UTC', default_locale: null, default_number_locale: null });
      case 'GET /rest/v1/procurements_masked':
        procurementPaths.push(url.pathname);
        return Response.json([{ id: REQUEST_ID, title: 'Field gloves', total_value: null }]);
      case 'GET /rest/v1/procurements':
        procurementPaths.push(url.pathname);
        throw new Error('price-hidden requester must not query the raw procurements table');
      case 'GET /rest/v1/agent_runs': return Response.json({ id: RUN_ID, owner_id: USER_ID, org_id: ORG_ID, thread_id: THREAD_ID });
      case 'GET /rest/v1/agent_threads': return Response.json({ id: THREAD_ID, owner_id: USER_ID, org_id: ORG_ID });
      case 'POST /rest/v1/agent_usage':
      case 'POST /rest/v1/error_events': return new Response(null, { status: 201 });
      default: throw new Error(`mock: unexpected fetch ${route} (${url.search})`);
    }
  }) as typeof fetch;

  try {
    const jwt = await token();
    const response = await handleAgentChatRequest(new Request('http://edge.test/agent-chat', {
      method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: RUN_ID, threadId: THREAD_ID, messages: [{ role: 'user', content: 'What purchase requests have I raised?' }] }),
    }));
    assertEquals(response.status, 200);
    const events = (await response.text()).split('\n\n').filter((frame) => frame.startsWith('data: ')).map((frame) => JSON.parse(frame.slice(6)) as AgentEvent);
    return { events, procurementPaths };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value as string);
    }
  }
}

Deno.test('#2789 the price-hidden requester sees their own request through the masked view and no price', async () => {
  const { events, procurementPaths } = await drive();
  assertEquals(procurementPaths, ['/rest/v1/procurements_masked']);
  const tool = events.find((event) => event.type === 'tool' && (event.payload as { name?: string } | undefined)?.name === 'query_entity');
  const result = (tool?.payload as { result?: { rows?: Array<{ id: string; title: string; total_value: number | null }> } } | undefined)?.result;
  assertEquals(result?.rows, [{ id: REQUEST_ID, title: 'Field gloves', total_value: null }]);
  assert(events.every((event) => !JSON.stringify(event).includes(WITHHELD_VALUE)), 'the hidden value never appears in an agent event');
  assertEquals(events.filter((event) => event.type === 'assistant').map((event) => event.text).join(' ').includes('Field gloves'), true);
});
