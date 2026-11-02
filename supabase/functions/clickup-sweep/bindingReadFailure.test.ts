// FN2-006: the SHIPPED clickup-sweep handler fails closed when an org's binding read fails.
import { assert, assertEquals } from 'jsr:@std/assert@1';

const ORG = '00000000-0000-4000-8000-000000000093';
const priorEnv = new Map<string, string | undefined>();
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
  CLICKUP_SWEEP_SECRET: 'synthetic-sweep-secret',
  CLICKUP_API_TOKEN: 'synthetic-global-token',
  EXTERNAL_CONNECT_ENABLED: 'true',
})) { priorEnv.set(k, Deno.env.get(k)); Deno.env.set(k, v); }
addEventListener('unload', () => priorEnv.forEach((v, k) => (v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v))));

let served: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof served) => unknown }).serve = (h) => { served = h; return { finished: Promise.resolve() }; };
await import('./index.ts');

// supabase-js starts a token-refresh interval on createClient (harness artifact, not the code under test).
Deno.test({ name: 'FN2-006 a failed org-binding read fails the org closed: no ClickUp request with the global token', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const urls: URL[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url);
    const json = (b: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } }));
    if (url.pathname.startsWith('/rest/v1/external_domain_ownership')) return json([{ org_id: ORG }]);
    if (url.pathname.startsWith('/rest/v1/external_org_bindings')) return json({ message: 'db blip', code: '57P03' }, 500);
    throw new Error(`unexpected request ${url.host}${url.pathname}`);
  }) as typeof fetch;
  try {
    const res = await served(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer synthetic-sweep-secret' }, body: '{}' }));
    const body = await res.json();
    assert(urls.some((u) => u.pathname.includes('external_org_bindings')), 'binding read must be reached');
    // fail-closed means the sweep never proceeds past the binding read for this org
    assertEquals(urls.filter((u) => u.hostname === 'api.clickup.com' || u.pathname.includes('external_project_bindings')).length, 0);
    assertEquals(body.failures.length, 1);
    assertEquals(body.applied, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}});
