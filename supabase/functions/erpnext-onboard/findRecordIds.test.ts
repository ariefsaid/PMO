// #2119 [Deno unit] — the SHIPPED erpnext-onboard handler reads the existing external-ref mappings in ONE
// batched lookup (findPmoRecordIds) with the ids of every ERP party, and uses its result: a mapped party is
// reconciled (update branch), an unmapped one is adopted. Binds ./index.ts and mocks globalThis.fetch.
// Verify: cd supabase/functions/erpnext-onboard && deno test --config deno.json --allow-env --allow-net --allow-read findRecordIds.test.ts
import '../_shared/testing/publicErpDns.ts';
import { handleOnboardRequest } from './index.ts';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

const ORG = '00000000-0000-4000-8000-0000000000bb';
const SITE = 'https://erp.findids-test.invalid';
const SERVICE_KEY = 'test-service-role-key';

Deno.test('#2119 the handler looks up every party mapping in one batch and reconciles the mapped party', async () => {
  const prevFetch = globalThis.fetch;
  const prevSetInterval = globalThis.setInterval;
  const intervals: ReturnType<typeof setInterval>[] = [];
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = prevSetInterval(...args);
    intervals.push(id);
    return id;
  }) as typeof setInterval;
  const env = { SUPABASE_URL: 'https://edge-test.supabase.test', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, EXTERNAL_CONNECT_ENABLED: 'true', LOCAL_BENCH_KEY: 'k', LOCAL_BENCH_SECRET: 's' };
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { previous[k] = Deno.env.get(k); Deno.env.set(k, v); }
  const json = (body: unknown, status = 200, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
  const refLookups: URL[] = [];
  const companyWrites: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => Promise.resolve().then(() => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const single = (req.headers.get('accept') ?? '').includes('pgrst.object');
    if (url.pathname === '/rest/v1/rpc/service_feature_enabled') return json(true);
    if (url.pathname === '/rest/v1/rpc/read_vault_secret') return json(null);
    if (url.pathname === '/rest/v1/external_org_bindings') return json({ site_url: SITE, secret_ref: 'local-bench', activated_at: '2026-01-01T00:00:00Z' }, 200, single ? 'application/vnd.pgrst.object+json' : 'application/json');
    if (url.pathname === '/rest/v1/external_refs') {
      if (req.method === 'GET') {
        refLookups.push(url);
        return json([{ external_record_id: 'Supplier:S-1', pmo_record_id: 'pmo-1' }]);
      }
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/rest/v1/companies') {
      if (req.method === 'GET') {
        const row = { id: 'pmo-1' };
        if (url.searchParams.get('id') === 'eq.pmo-1') return single ? json(row, 200, 'application/vnd.pgrst.object+json') : json([row]);
        return json([]); // the same-name / same-tax candidate lookup for the unmapped party: no match
      }
      companyWrites.push(req.method);
      return new Response(null, { status: req.method === 'POST' ? 201 : 204 });
    }
    if (url.host === new URL(SITE).host) {
      if (url.pathname === '/api/resource/Supplier') return json({ data: [{ name: 'S-1', supplier_name: 'Mapped Co' }, { name: 'S-2', supplier_name: 'Fresh Co' }] });
      return json({ data: [] });
    }
    throw new Error(`Unexpected fetch: ${req.method} ${url}`);
  })) as typeof fetch;
  try {
    const res = await handleOnboardRequest(new Request('http://edge.test/onboard', {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: ORG }),
    }));
    const body = await res.json();
    assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert(refLookups.length === 1, `expected ONE batched mapping read, got ${refLookups.length}`);
    const filter = decodeURIComponent(refLookups[0].searchParams.get('external_record_id') ?? '');
    assert(filter.startsWith('in.') && filter.includes('Supplier:S-1') && filter.includes('Supplier:S-2'), `lookup must carry both ids, got ${filter}`);
    assert(body.reconciled === 1 && body.adopted === 1, `the lookup result must be used: ${JSON.stringify(body)}`);
    assert(companyWrites.includes('PATCH') && companyWrites.includes('POST'), `expected one update and one insert, got ${companyWrites}`);
  } finally {
    intervals.forEach(clearInterval);
    globalThis.setInterval = prevSetInterval;
    globalThis.fetch = prevFetch;
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
});
