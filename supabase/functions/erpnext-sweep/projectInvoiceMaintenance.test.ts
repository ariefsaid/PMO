let served: ((request: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (handler: (request: Request) => Promise<Response>) => unknown }).serve = (handler) => {
  served = handler;
  return { finished: Promise.resolve() };
};
await import('./index.ts');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';

Deno.test('AC-PFIN-004 unauthorized maintenance requests are refused before any database read', async () => {
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    ERPNEXT_SWEEP_SECRET: 'synthetic-sweep-secret', SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  } as Record<string, string>)[key];
  globalThis.fetch = (async () => { fetchCount++; return new Response('{}'); }) as typeof fetch;
  try {
    const response = await served!(new Request('https://edge.example.test/erpnext-sweep', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'repair-invoice-projects' }),
    }));
    assert(response.status === 401, `browser request is unauthorized; got ${response.status}`);
    assert(fetchCount === 0, 'unauthorized request does not read Supabase');
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalGet;
  }
});

Deno.test('AC-PFIN-004 invalid non-empty maintenance modes return 400 without entering the sweep cycle', async () => {
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    ERPNEXT_SWEEP_SECRET: 'synthetic-sweep-secret', SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  } as Record<string, string>)[key];
  globalThis.fetch = (async () => { fetchCount++; return new Response('{}'); }) as typeof fetch;
  try {
    const response = await served!(new Request('https://edge.example.test/erpnext-sweep', {
      method: 'POST', headers: { authorization: 'Bearer synthetic-sweep-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'unknown-maintenance-mode' }),
    }));
    assert(response.status === 400, `unknown maintenance mode is rejected; got ${response.status}`);
    assert(fetchCount === 0, 'invalid maintenance request does not query the database');
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalGet;
  }
});

Deno.test('AC-PFIN-004 authorized maintenance request runs one explicit repair batch and returns its cursor result', async () => {
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    ERPNEXT_SWEEP_SECRET: 'synthetic-sweep-secret', SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  } as Record<string, string>)[key];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    paths.push(url.pathname);
    const body = url.pathname.endsWith('/external_org_bindings')
      ? [{ org_id: ORG, site_url: 'https://erp.example.test', secret_ref: 'synthetic', config: {}, activated_at: '2026-10-01', version_major: 15 }]
      : url.pathname.endsWith('/external_domain_ownership')
        ? [{ org_id: ORG, domain: 'revenue' }]
        : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const response = await served!(new Request('https://edge.example.test/erpnext-sweep', {
      method: 'POST', headers: { authorization: 'Bearer synthetic-sweep-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'repair-invoice-projects', org_id: ORG, after_id: null }),
    }));
    const result = await response.json();
    assert(response.status === 200 && result.ok === true && result.scanned === 0 && result.done === true,
      `maintenance returns one successful empty batch: ${JSON.stringify(result)}`);
    assert(paths.filter((path) => path.endsWith('/sales_invoices')).length === 1, 'one candidate batch is read');
    assert(!paths.some((path) => path.endsWith('/external_command_outbox')), 'maintenance does not run the normal money sweep');
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalGet;
  }
});

Deno.test('the pg_cron tick body `{}` (erpnext_sweep_tick sends it) runs the normal sweep, never a 400', async () => {
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    ERPNEXT_SWEEP_SECRET: 'synthetic-sweep-secret', SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  } as Record<string, string>)[key];
  globalThis.fetch = (async (input) => {
    paths.push(new URL(String(input instanceof Request ? input.url : input)).pathname);
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const response = await served!(new Request('https://edge.example.test/erpnext-sweep', {
      method: 'POST', headers: { authorization: 'Bearer synthetic-sweep-secret', 'content-type': 'application/json' },
      body: '{}',
    }));
    assert(response.status === 200, `the cron tick is a normal sweep; got ${response.status}`);
    assert(paths.some((p) => p.endsWith('/external_org_bindings')), 'the normal sweep reads the org bindings');
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalGet;
  }
});
