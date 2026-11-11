// AC-ENA-SWEEP-AUTH — erpnext-sweep/index.ts: the dedicated-secret trust boundary. The shipped handler
// is captured through Deno.serve (the same way projectInvoiceMaintenance.test.ts does) and called with
// the cron tick's own empty body: a missing or wrong bearer is refused with the typed 401 before any
// network or database call.
let served: ((request: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (handler: (request: Request) => Promise<Response>) => unknown }).serve = (handler) => {
  served = handler;
  return { finished: Promise.resolve() };
};
await import('./index.ts');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function tick(authorization: string | null): Promise<{ status: number; body: { error?: string }; fetchCount: number }> {
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    ERPNEXT_SWEEP_SECRET: 'synthetic-sweep-secret', SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  } as Record<string, string>)[key];
  globalThis.fetch = (async () => { fetchCount++; return new Response('{}'); }) as typeof fetch;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization !== null) headers.authorization = authorization;
    const response = await served!(new Request('https://edge.example.test/erpnext-sweep', {
      method: 'POST', headers, body: JSON.stringify({}),
    }));
    return { status: response.status, body: await response.json() as { error?: string }, fetchCount };
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalGet;
  }
}

Deno.test('AC-ENA-SWEEP-AUTH: an absent Authorization bearer is a typed 401 and reaches nothing', async () => {
  const result = await tick(null);
  assert(result.status === 401, `expected 401, got ${result.status}`);
  assert(result.body.error === 'UNAUTHORIZED', `expected UNAUTHORIZED, got ${result.body.error}`);
  assert(result.fetchCount === 0, 'an unauthenticated tick made a network call');
});

Deno.test('AC-ENA-SWEEP-AUTH: an invalid bearer (a leaked wrong secret) is a typed 401 and reaches nothing', async () => {
  const result = await tick('Bearer definitely-not-the-sweep-secret');
  assert(result.status === 401, `expected 401, got ${result.status}`);
  assert(result.body.error === 'UNAUTHORIZED', `expected UNAUTHORIZED, got ${result.body.error}`);
  assert(result.fetchCount === 0, 'a wrong-secret tick made a network call');
});
