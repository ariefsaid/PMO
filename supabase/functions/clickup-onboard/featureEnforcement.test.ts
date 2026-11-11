let servedHandler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (handler: (req: Request) => Response | Promise<Response>) => unknown }).serve = (handler) => {
  servedHandler = async (req) => await handler(req);
  return { finished: Promise.resolve() };
};
await import('./index.ts');

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_API_TOKEN'] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, Deno.env.get(key)]));
Deno.env.set('SUPABASE_URL', 'https://edge-test.supabase');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-key');
Deno.env.set('CLICKUP_API_TOKEN', 'synthetic-clickup-token');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function onboard(featureEnabled: boolean, bound = true) {
  const calls: Array<{ url: URL; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? '' : await request.clone().text();
    calls.push({ url, body });
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') return new Response(JSON.stringify(featureEnabled), { status: 200 });
    if (url.pathname === '/rest/v1/external_org_bindings') return new Response(JSON.stringify(bound ? [{ secret_ref: 'ref-org-1' }] : []), { status: 200 });
    if (url.pathname === '/rest/v1/rpc/read_vault_secret') return new Response(JSON.stringify('synthetic-org-token'), { status: 200 });
    throw new Error(`unexpected request: ${request.method} ${url.href}`);
  }) as typeof fetch;
  try {
    if (!servedHandler) throw new Error('the shipped clickup-onboard handler was not registered');
    const response = await servedHandler(new Request('http://edge.test/clickup-onboard', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-service-role-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'provision', orgId: 'org-1', projectId: 'project-1' }),
    }));
    return { response, body: await response.json(), calls };
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

Deno.test('FR-PLN-006 clickup-onboard refuses before provisioning when clickup_sync is off', async () => {
  const r = await onboard(false);
  assert(r.response.status === 409, 'a disabled sync module returns HTTP 409');
  assert((r.body as { error: string }).error === 'feature_off', 'the refusal is typed feature_off');
  assert(r.calls.length === 1 && r.calls[0].body.includes('clickup_sync'), 'the org entitlement is resolved before provisioning');
});

Deno.test('FR-PLN-006 clickup-onboard proceeds past an enabled entitlement', async () => {
  const r = await onboard(true);
  assert(r.response.status === 400, 'the enabled request reaches the ordinary missing-target validation');
  assert((r.body as { error: string }).error === 'BAD_REQUEST', 'the feature gate does not refuse an enabled org');
});

Deno.test('FR-PLN-006 clickup-onboard fails closed for an org with no ClickUp binding (no deployment-wide token)', async () => {
  const r = await onboard(true, false);
  assert(r.response.status === 409, 'an unbound org is refused');
  assert((r.body as { error: string }).error === 'NOT_CONNECTED', 'the refusal is typed NOT_CONNECTED');
  assert(!r.calls.some((c) => c.url.hostname === 'api.clickup.com'), 'no ClickUp request is made');
});

Deno.test('restore the test runtime', () => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
});
