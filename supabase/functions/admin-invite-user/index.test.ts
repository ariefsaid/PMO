let handler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
Deno.serve = ((fn: typeof handler) => { handler = fn; }) as unknown as typeof Deno.serve;
await import('./index.ts');
Deno.serve = originalServe;

interface Scenario { existing?: boolean; insertError?: string; inviteError?: boolean; lookupError?: boolean; email?: string; pOrgId?: string; inviteErrorCode?: string; inviteErrorStatus?: number; }
async function run(s: Scenario) {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL'];
  const before = names.map((name) => Deno.env.get(name));
  for (const [i, value] of ['http://localhost:9999', 'anon', 'service', 'http://localhost:3000'].entries()) Deno.env.set(names[i], value);
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  let lookupQuery: string | undefined;
  let insertBody: Record<string, unknown> | undefined;
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
      lookupQuery = url.search;
      if (!s.email && url.searchParams.get('email') !== 'ilike.Person@Example.test') throw new Error('email lookup must use the trimmed address');
      if (s.lookupError) { status = 500; data = { code: 'LOOKUP_FAILED', message: 'failed' }; }
      else data = s.existing ? [{ id: 'existing' }] : [];
    }
    else if (path === '/auth/v1/invite') { if (s.inviteError) { status = s.inviteErrorStatus ?? 422; data = { code: s.inviteErrorCode ?? 'email_exists', msg: 'exists' }; } else data = { id: '11111111-1111-4111-8111-111111111111', created_at: '2026-01-01T00:00:00Z', invited_at: '2026-01-01T00:00:01Z' }; }
    else if (path === '/rest/v1/profiles' && req.method === 'POST') { insertBody = JSON.parse(await req.text()) as Record<string, unknown>; if (s.insertError) { status = 409; data = { code: s.insertError, message: 'failed' }; } else { status = 201; data = null; } }
    else if (path.startsWith('/auth/v1/admin/users/') && req.method === 'DELETE') data = {};
    else { console.error(`unexpected ${req.method} ${path}`); throw new Error(`unexpected ${req.method} ${path}`); }
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
  }) as typeof fetch;
  try {
    const response = await handler(new Request('http://localhost/invite', { method: 'POST', headers: { Authorization: 'Bearer caller', 'content-type': 'application/json' }, body: JSON.stringify({ email: s.email ?? '  Person@Example.test  ', role: 'Engineer', p_org_id: s.pOrgId }) }));
    return { status: response.status, body: await response.json(), calls, lookupQuery, insertBody };
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

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'Addresses with an asterisk receive the malformed address response', fn: async () => {
  const result = await run({ email: 'a*b@example.test' });
  assert(result.status === 400 && result.body.error === 'BAD_EMAIL', 'malformed address response');
  assert(result.lookupQuery === undefined && !result.calls.includes('POST /auth/v1/invite'), 'no lookup or invite');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'Literal address characters are escaped in the lookup', fn: async () => {
  const result = await run({ email: 'a_b%c@example.test' });
  assert(result.lookupQuery === '?select=id&email=ilike.a%5C_b%5C%25c%40example.test&limit=1', `lookup query: ${result.lookupQuery}`);
  assert(result.status === 200 && result.calls.includes('POST /auth/v1/invite'), 'invite proceeds');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'A lookup failure returns the issuance refusal', fn: async () => {
  const result = await run({ lookupError: true });
  assert(result.status === 502 && result.body.error === 'INVITE_ISSUE_FAILED', 'lookup failure response');
  assert(!result.calls.includes('POST /auth/v1/invite'), 'no invite');
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'An address that cannot be added gets one neutral outcome whatever the reason', fn: async () => {
  const inAnotherOrg = await run({ existing: true });
  const accountExists = await run({ inviteError: true });
  const userExists = await run({ inviteError: true, inviteErrorCode: 'user_already_exists' });
  for (const r of [inAnotherOrg, accountExists, userExists]) {
    assert(r.status === 409, `neutral status: ${r.status}`);
    assert(JSON.stringify(r.body) === JSON.stringify({ error: 'INVITE_NOT_ADDABLE' }), `neutral body: ${JSON.stringify(r.body)}`);
    assert(!r.calls.includes('POST /rest/v1/profiles'), 'no profile is written');
  }
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'An invite service failure stays an issuance failure, not the neutral outcome', fn: async () => {
  const result = await run({ inviteError: true, inviteErrorCode: 'unexpected_failure', inviteErrorStatus: 500 });
  assert(result.status === 502 && result.body.error === 'INVITE_ISSUE_FAILED', `issuance failure: ${result.status} ${JSON.stringify(result.body)}`);
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'The profile is written into the inviter organization, never a requested one', fn: async () => {
  const result = await run({ pOrgId: 'org-a' });
  assert(result.status === 200, `invite succeeds: ${result.status}`);
  assert(result.insertBody?.org_id === 'org-b', `profile org: ${String(result.insertBody?.org_id)}`);
  assert(!result.calls.some((c) => c.endsWith('/rpc/operator_org_exists')), 'requested org is not consulted for an admin');
}});
