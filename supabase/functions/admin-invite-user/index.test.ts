let handler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
Deno.serve = ((fn: typeof handler) => { handler = fn; }) as unknown as typeof Deno.serve;
await import('./index.ts');
Deno.serve = originalServe;

interface Scenario { existing?: boolean; insertError?: string; inviteError?: boolean; }
async function run(s: Scenario) {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL'];
  const before = names.map((name) => Deno.env.get(name));
  for (const [i, value] of ['http://localhost:9999', 'anon', 'service', 'http://localhost:3000'].entries()) Deno.env.set(names[i], value);
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init); const url = new URL(req.url); const path = url.pathname;
    calls.push(`${req.method} ${path}`);
    let data: unknown = null; let status = 200;
    if (path === '/auth/v1/user') data = { id: 'admin' };
    else if (path.endsWith('/rpc/is_operator')) data = false;
    else if (path.endsWith('/rpc/org_has_member_email')) data = false;
    else if (path.endsWith('/rpc/assert_seat_available')) data = null;
    else if (path.endsWith('/rpc/rate_limit_hit')) data = true;
    else if (path === '/rest/v1/profiles' && req.method === 'GET' && req.headers.get('authorization') === 'Bearer caller') data = { id: 'admin', org_id: 'org-b', role: 'Admin', email: 'admin@example.test' };
    else if (path === '/rest/v1/profiles' && req.method === 'GET') {
      if (url.searchParams.get('email') !== 'ilike.Person@Example.test') throw new Error('email lookup must use the trimmed address');
      data = s.existing ? [{ id: 'existing' }] : [];
    }
    else if (path === '/auth/v1/invite') { if (s.inviteError) { status = 422; data = { code: 'email_exists', msg: 'exists' }; } else data = { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-01-01T00:00:00Z', invited_at: '2026-01-01T00:00:01Z' }; }
    else if (path === '/rest/v1/profiles' && req.method === 'POST') { if (s.insertError) { status = 409; data = { code: s.insertError, message: 'failed' }; } else { status = 201; data = null; } }
    else if (path.startsWith('/auth/v1/admin/users/') && req.method === 'DELETE') data = {};
    else { console.error(`unexpected ${req.method} ${path}`); throw new Error(`unexpected ${req.method} ${path}`); }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const response = await handler(new Request('http://localhost/invite', { method: 'POST', headers: { Authorization: 'Bearer caller', 'content-type': 'application/json' }, body: JSON.stringify({ email: '  Person@Example.test  ', role: 'Engineer' }) }));
    return { status: response.status, body: await response.json(), calls };
  } finally { globalThis.fetch = oldFetch; names.forEach((name, i) => before[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, before[i]!)); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'An existing address is refused before issuance', fn: async () => {
  const existing = await run({ existing: true }); const confirmed = await run({ inviteError: true });
  assert(existing.status === confirmed.status && existing.body.error === confirmed.body.error, 'existing response must match confirmed response');
  assert(!existing.calls.includes('POST /auth/v1/invite'), 'existing address must not receive an invite');
  assert(!existing.calls.some((c) => c.startsWith('DELETE ')), 'existing account must remain');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'A failed profile write retains the pending account', fn: async () => {
  const result = await run({ insertError: '23505' });
  assert(result.status === 502 && result.body.error === 'PROFILE_CREATE_FAILED', 'profile failure response');
  assert(!result.calls.some((c) => c.startsWith('DELETE ')), 'pending account remains');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'A seat refusal retains its typed response and pending account', fn: async () => {
  const result = await run({ insertError: 'PL001' });
  assert(result.status === 409 && result.body.error === 'SEAT_LIMIT_REACHED', 'seat refusal response');
  assert(!result.calls.some((c) => c.startsWith('DELETE ')), 'pending account remains');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'A pending account without a profile can be adopted', fn: async () => {
  const result = await run({});
  assert(result.status === 200 && result.calls.includes('POST /rest/v1/profiles'), 'profile must be created');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'Two calls keep the account when the second profile write fails', fn: async () => {
  const first = await run({}); const second = await run({ insertError: '23505' });
  assert(first.status === 200 && second.status === 502, 'first succeeds and second fails');
  assert(!second.calls.some((c) => c.startsWith('DELETE ')), 'account remains');
}});
