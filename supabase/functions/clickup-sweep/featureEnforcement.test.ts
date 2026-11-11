let servedHandler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (handler: (req: Request) => Response | Promise<Response>) => unknown }).serve = (handler) => {
  servedHandler = async (req) => await handler(req);
  return { finished: Promise.resolve() };
};
await import('./index.ts');

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLICKUP_SWEEP_SECRET', 'EXTERNAL_CONNECT_ENABLED', 'CLICKUP_API_TOKEN']
  .map((key) => [key, Deno.env.get(key)]));
const ENV = {
  SUPABASE_URL: 'https://edge-test.supabase',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key',
  CLICKUP_SWEEP_SECRET: 'synthetic-sweep-secret',
  EXTERNAL_CONNECT_ENABLED: 'true',
  CLICKUP_API_TOKEN: 'synthetic-clickup-token',
};
for (const [key, value] of Object.entries(ENV)) Deno.env.set(key, value);

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(msg ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function tick(featureEnabled: boolean, bound = true) {
  const calls: Array<{ url: URL; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    calls.push({ url, method });
    if (url.pathname === '/rest/v1/external_domain_ownership') return new Response(JSON.stringify([{ org_id: 'org-1' }]), { status: 200 });
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') return new Response(JSON.stringify(featureEnabled), { status: 200 });
    if (url.pathname === '/rest/v1/external_org_bindings') {
      return new Response(JSON.stringify(bound ? [{ secret_ref: 'ref-org-1' }] : []), { status: 200 });
    }
    if (url.pathname === '/rest/v1/rpc/read_vault_secret') return new Response(JSON.stringify('synthetic-org-token'), { status: 200 });
    if (url.pathname === '/rest/v1/external_project_bindings') return new Response('[]', { status: 200 });
    throw new Error(`unexpected request: ${method} ${url.pathname}`);
  }) as typeof fetch;
  try {
    if (!servedHandler) throw new Error('the shipped clickup-sweep handler was not registered');
    const res = await servedHandler(new Request('http://edge.test/clickup-sweep', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-sweep-secret' }, body: '{}',
    }));
    return { res, body: await res.json(), calls };
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

Deno.test('FR-PLN-006 clickup_sync off holds the org before reading credentials or advancing sync state', async () => {
  const r = await tick(false);
  assertEquals(r.res.status, 200);
  assertEquals((r.body as { perOrg: unknown[] }).perOrg, [{ orgId: 'org-1', skipped: 'feature-off:clickup_sync' }]);
  assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_org_bindings').length, 0);
  assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_project_bindings').length, 0);
});

Deno.test('FR-PLN-006 clickup_sync on proceeds to the live sweep path', async () => {
  const r = await tick(true);
  assertEquals(r.res.status, 200);
  assertEquals((r.body as { failures: unknown[] }).failures, []);
  assertEquals((r.body as { perOrg: unknown[] }).perOrg, [{ orgId: 'org-1', applied: 0, archived: 0, skippedAmbiguous: 0, perList: [] }]);
});

Deno.test('an org with no ClickUp binding fails closed: no deployment-wide token is used', async () => {
  const r = await tick(true, false);
  assertEquals(r.res.status, 200);
  assertEquals((r.body as { applied: number }).applied, 0);
  assertEquals((r.body as { failures: unknown[] }).failures.length, 1);
  assertEquals(r.calls.filter((c) => c.url.hostname === 'api.clickup.com').length, 0);
  assertEquals(r.calls.filter((c) => c.url.pathname === '/rest/v1/external_project_bindings').length, 0);
});

Deno.test('test environment is restored after the suite', () => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
});
