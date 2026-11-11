// agent-dispatch/index.ts `buildDispatchModelClients` [Deno unit] — the automation tick's
// model clients are resolved through the SAME deployment policy as the interactive paths
// (agent-chat, compose-view): the env-configured provider routing policy
// (allow-list / order / data-collection limits) and the configured model fallbacks apply to
// BOTH the run client and the condition client, so an operator's provider policy cannot be
// bypassed by automated runs (T-10 #1538 slice 2).
//
// Proven at the real shipped boundary: the factory the Deno.serve wrapper consults is
// imported from the actual index.ts, and each client's wire payload is captured through a
// stubbed fetch — the same capture style as openRouterModelClient's own unit tests.
//
// Verify: cd supabase/functions/agent-dispatch && deno test index.test.ts --config deno.json

// Stub Deno.serve BEFORE the dynamic import (the module wires its handler at top level —
// mirror of clickup-webhook/index.test.ts's stance).
let servedHandler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (handler: (req: Request) => Response | Promise<Response>) => unknown }).serve = (handler) => {
  servedHandler = async (req) => await handler(req);
  return { finished: Promise.resolve() };
};
const { buildDispatchModelClients } = await import('./index.ts');
const { DEFAULT_PROVIDER_POLICY } = await import('../_shared/openRouterModelClient.ts');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Stub fetch, capture each request body, answer a minimal valid chat-completions payload. */
function stubFetch(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  (globalThis as { fetch: unknown }).fetch = ((_url: unknown, init: { body: string }) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        model: 'deepseek/deepseek-v4-flash',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      }),
    });
  }) as unknown;
  return bodies;
}

async function callOnce(client: { create(params: unknown): Promise<unknown> }, model: string): Promise<void> {
  await client.create({ model, max_tokens: 64, messages: [{ role: 'user', content: 'ping' }] });
}

// ── Defaults: the no-train provider pin + the default model fallbacks, on BOTH clients ──
{
  const bodies = stubFetch();
  const clients = buildDispatchModelClients('test-key', {});
  await callOnce(clients.modelClient, 'deepseek/deepseek-v4-flash');
  await callOnce(clients.conditionModel, 'deepseek/deepseek-v4-flash');
  assert(bodies.length === 2, 'both dispatch clients must issue their own model call');
  for (const body of bodies) {
    const provider = body.provider as Record<string, unknown>;
    assert(JSON.stringify(provider.order) === JSON.stringify(DEFAULT_PROVIDER_POLICY.order), `default provider order must match the no-train pin, got ${JSON.stringify(provider.order)}`);
    assert(JSON.stringify(provider.only) === JSON.stringify(DEFAULT_PROVIDER_POLICY.only), `default provider allow-list must match the no-train pin, got ${JSON.stringify(provider.only)}`);
    assert(provider.allow_fallbacks === DEFAULT_PROVIDER_POLICY.allow_fallbacks, 'default allow_fallbacks must match');
    assert(Array.isArray(body.models) && (body.models as string[]).length === 2, 'default model fallbacks must ride the request');
  }
  assert(clients.model === 'deepseek/deepseek-v4.1-flash-1017', 'default model resolution');
  assert(clients.conditionModelId === 'deepseek/deepseek-v4.1-flash-1017', 'condition model falls back to the default model without a cheap-tier override');
}

// ── Env overrides reach the wire for the run client AND the condition client ──
{
  const bodies = stubFetch();
  const clients = buildDispatchModelClients('test-key', {
    AGENT_PROVIDER_ONLY: 'deepinfra',
    AGENT_PROVIDER_DATA_COLLECTION: 'deny',
    AGENT_PROVIDER_ORDER: 'deepinfra,digitalocean',
    AGENT_MODEL_FALLBACKS: '',
    AGENT_MODEL_DEFAULT: 'deepseek/deepseek-v4.1-flash-1017',
    AGENT_MODEL_CHEAP: 'deepseek/deepseek-v4-flash',
  });
  await callOnce(clients.modelClient, 'deepseek/deepseek-v4.1-flash-1017');
  await callOnce(clients.conditionModel, 'deepseek/deepseek-v4-flash');
  const provider = bodies[0].provider as Record<string, unknown>;
  assert(JSON.stringify(provider.only) === JSON.stringify(['deepinfra']), `env allow-list must restrict routing, got ${JSON.stringify(provider.only)}`);
  assert(provider.data_collection === 'deny', 'env data-collection limit must ride the request');
  assert(JSON.stringify(provider.order) === JSON.stringify(['deepinfra', 'digitalocean']), 'env order must ride the request');
  assert(bodies[0].models === undefined && bodies[1].models === undefined, "AGENT_MODEL_FALLBACKS='' must disable model fallbacks");
  assert(clients.model === 'deepseek/deepseek-v4.1-flash-1017', 'env default model');
  assert(clients.conditionModelId === 'deepseek/deepseek-v4-flash', 'cheap-tier condition model override');
}

console.log('agent-dispatch/index.test.ts: dispatch model-client policy wiring OK');

async function dispatchTick(featureEnabled: boolean) {
  const previousEnv = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'OPENROUTER_API_KEY']
    .map((key) => [key, Deno.env.get(key)]));
  const env = {
    SUPABASE_URL: 'https://edge-test.supabase',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
    SUPABASE_ANON_KEY: 'synthetic-anon-key',
    OPENROUTER_API_KEY: 'synthetic-model-key',
  };
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; method: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = init?.method ?? request.method;
    const body = method === 'GET' ? '' : await request.clone().text();
    calls.push({ url, method, body });
    if (url.pathname === '/rest/v1/agent_automations') {
      const kind = url.searchParams.get('kind');
      if (kind === 'eq.schedule') return new Response('[]', { status: 200 });
      if (kind === 'eq.trigger') return new Response(JSON.stringify([{
        id: 'automation-1', kind: 'trigger', owner_id: 'owner-1', org_id: 'org-1', prompt: 'run safely',
        trigger_on: { source: 'procurement_status_events', event: 'Approved' }, enabled: true, archived_at: null,
      }]), { status: 200 });
    }
    if (url.pathname === '/rest/v1/agent_dispatch_watermarks') return new Response('[]', { status: 200 });
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') return new Response(JSON.stringify(featureEnabled), { status: 200 });
    if (url.pathname === '/rest/v1/rpc/select_trigger_events') return new Response('[]', { status: 200 });
    throw new Error(`unexpected request: ${method} ${url.href}`);
  }) as typeof fetch;
  try {
    if (!servedHandler) throw new Error('the shipped agent-dispatch handler was not registered');
    const response = await servedHandler(new Request('http://edge.test/agent-dispatch', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-service-role-key' },
      body: '{}',
    }));
    return { response, body: await response.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value as string);
    }
  }
}

Deno.test('FR-PLN-006 agent_assistant off skips trigger polling before any automation can fire', async () => {
  const r = await dispatchTick(false);
  assert(r.response.status === 200, 'feature-off automation is a no-op tick');
  const entitlement = r.calls.find((c) => c.url.pathname === '/rest/v1/rpc/service_feature_enabled');
  assert(entitlement !== undefined && entitlement.body.includes('agent_assistant'), 'the org entitlement is resolved');
  assert(!r.calls.some((c) => c.url.pathname === '/rest/v1/rpc/select_trigger_events'), 'off org trigger events are not selected');
});

Deno.test('FR-PLN-006 agent_assistant on continues into trigger polling', async () => {
  const r = await dispatchTick(true);
  assert(r.response.status === 200, 'enabled automation tick succeeds');
  assert(r.calls.some((c) => c.url.pathname === '/rest/v1/rpc/select_trigger_events'), 'enabled org trigger events are selected');
});
