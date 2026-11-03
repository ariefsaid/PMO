import { handleOnboardRequest } from './index.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, Deno.env.get(key)]));
Deno.env.set('SUPABASE_URL', 'https://edge-test.supabase');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-key');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function onboard(features: Record<string, boolean>) {
  const calls: Array<{ url: URL; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? '' : await request.clone().text();
    calls.push({ url, body });
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') {
      const key = (JSON.parse(body) as { p_key: string }).p_key;
      return new Response(JSON.stringify(features[key] === true), { status: 200 });
    }
    if (url.pathname === '/rest/v1/external_org_bindings') {
      return new Response(JSON.stringify({ code: 'PGRST116', message: 'no rows' }), { status: 406 });
    }
    throw new Error(`unexpected request: ${request.method} ${url.href}`);
  }) as typeof fetch;
  try {
    const response = await handleOnboardRequest(new Request('http://edge.test/erpnext-onboard', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-service-role-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1' }),
    }));
    return { response, body: await response.json(), calls };
  } finally {
    globalThis.fetch = ORIGINAL_FETCH;
  }
}

Deno.test('FR-PLN-006 erpnext-onboard refuses when crm is off before any binding or ERP read', async () => {
  const r = await onboard({ erp_sync: true, crm: false });
  assert(r.response.status === 409, 'a disabled CRM module returns HTTP 409');
  assert((r.body as { error: string }).error === 'feature_off', 'the response is typed feature_off');
  assert(r.calls.filter((c) => c.url.pathname === '/rest/v1/rpc/service_feature_enabled').length === 2,
    'both erp_sync and crm entitlements are resolved');
  assert(!r.calls.some((c) => c.url.pathname === '/rest/v1/external_org_bindings'), 'off onboarding performs no binding read');
});

Deno.test('FR-PLN-006 erpnext-onboard proceeds past both enabled entitlements', async () => {
  const r = await onboard({ erp_sync: true, crm: true });
  assert(r.response.status === 500, 'an enabled org proceeds to its ordinary missing-binding result');
  assert((r.body as { error: string }).error !== 'feature_off', 'the feature gate does not refuse an enabled org');
  assert(r.calls.some((c) => c.url.pathname === '/rest/v1/external_org_bindings'), 'the normal onboard path starts');
});

Deno.test('restore the test runtime', () => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
});
