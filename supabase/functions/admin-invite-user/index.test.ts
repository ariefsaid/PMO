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
  const result = await run({ insertError: '23514' });
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
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'AC-INV-005 an address that cannot be added gets one neutral outcome whatever the reason', fn: async () => {
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

// ── Shared-state harness: one fake auth + profiles store that every call hits (#2252). ──
interface Profile { id: string; org_id: string; role: string; email: string }
interface Store { users: Map<string, string>; profiles: Profile[]; invites: number; arrive?: () => Promise<void> }
const callers: Record<string, { id: string; operator: boolean; profile: Omit<Profile, 'id'> }> = {
  'Bearer admin-b': { id: 'admin-b', operator: false, profile: { org_id: 'org-b', role: 'Admin', email: 'admin@b.test' } },
  'Bearer operator': { id: 'operator', operator: true, profile: { org_id: 'org-ops', role: 'Engineer', email: 'op@ops.test' } },
};
const unescape = (pattern: string) => pattern.replace(/\\(.)/g, '$1').toLowerCase();
function storeFetch(store: Store): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init); const url = new URL(req.url); const path = url.pathname;
    const caller = callers[req.headers.get('authorization') ?? ''];
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
    if (path === '/auth/v1/user') return reply({ id: caller.id });
    if (path.endsWith('/rpc/is_operator')) return reply(caller.operator);
    if (path.endsWith('/rpc/operator_org_exists')) return reply(true);
    if (path.endsWith('/rpc/org_has_member_email')) {
      const b = await req.json() as { p_org_id: string; p_email: string };
      return reply(store.profiles.some((p) => p.org_id === b.p_org_id && p.email.toLowerCase() === b.p_email));
    }
    if (path.endsWith('/rpc/assert_seat_available')) return reply(null);
    if (path.endsWith('/rpc/rate_limit_hit')) return reply(true);
    if (path === '/rest/v1/profiles' && req.method === 'GET' && caller) return reply({ id: caller.id, ...caller.profile });
    if (path === '/rest/v1/profiles' && req.method === 'GET') {
      const email = unescape((url.searchParams.get('email') ?? '').replace(/^ilike\./, ''));
      const org = url.searchParams.get('org_id')?.replace(/^eq\./, '');
      return reply(store.profiles.filter((p) => p.email.toLowerCase() === email && (!org || p.org_id === org)));
    }
    if (path === '/auth/v1/invite') {
      const { email } = await req.json() as { email: string };
      store.invites++;
      await store.arrive?.();
      // An unconfirmed invitee is re-invited, not refused: the auth service returns the same user.
      const key = email.toLowerCase();
      if (!store.users.has(key)) store.users.set(key, crypto.randomUUID());
      return reply({ id: store.users.get(key), created_at: '2026-01-01T00:00:00Z', invited_at: '2026-01-01T00:00:01Z' });
    }
    if (path === '/rest/v1/profiles' && req.method === 'POST') {
      const row = await req.json() as Profile;
      if (store.profiles.some((p) => p.id === row.id)) return reply({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' }, 409);
      store.profiles.push(row);
      return reply(null, 201);
    }
    throw new Error(`unexpected ${req.method} ${path}`);
  }) as typeof fetch;
}
async function withStore<T>(store: Store, fn: () => Promise<T>): Promise<T> {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL'];
  const before = names.map((name) => Deno.env.get(name));
  for (const [i, value] of ['http://localhost:9999', 'anon', 'service', 'http://localhost:3000'].entries()) Deno.env.set(names[i], value);
  const oldFetch = globalThis.fetch; globalThis.fetch = storeFetch(store);
  try { return await fn(); }
  finally { globalThis.fetch = oldFetch; names.forEach((name, i) => before[i] === undefined ? Deno.env.delete(name) : Deno.env.set(name, before[i]!)); }
}
async function invite(caller: string, body: Record<string, unknown>) {
  const response = await handler(new Request('http://localhost/invite', { method: 'POST', headers: { Authorization: caller, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json(), retryAfter: response.headers.get('Retry-After') };
}
const newStore = (): Store => ({ users: new Map(), profiles: [], invites: 0 });

Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'AC-INV-006 a second identical invite succeeds as already invited, without a second email or profile', fn: async () => {
  const store = newStore();
  await withStore(store, async () => {
    const first = await invite('Bearer admin-b', { email: 'new@example.test', role: 'Engineer' });
    const again = await invite('Bearer admin-b', { email: ' New@Example.test ', role: 'Engineer' });
    const otherRole = await invite('Bearer admin-b', { email: 'new@example.test', role: 'Admin' });
    assert(first.status === 200 && first.body.ok === true, `first: ${first.status} ${JSON.stringify(first.body)}`);
    assert(again.status === 200 && JSON.stringify(again.body) === JSON.stringify({ ok: true, already_invited: true }), `repeat: ${again.status} ${JSON.stringify(again.body)}`);
    assert(otherRole.status === 409 && otherRole.body.error === 'DUPLICATE_EMAIL', `different role: ${otherRole.status} ${JSON.stringify(otherRole.body)}`);
  });
  assert(store.invites === 1, `one invite email: ${store.invites}`);
  assert(store.profiles.length === 1, `one profile: ${store.profiles.length}`);
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'AC-INV-007 the loser of two concurrent invites gets a retryable result and its retry succeeds', fn: async () => {
  const store = newStore();
  let release!: () => void; const bothArrived = new Promise<void>((r) => { release = r; });
  store.arrive = () => { if (store.invites === 2) release(); return bothArrived; };
  const body = { email: 'race@example.test', role: 'Engineer' };
  await withStore(store, async () => {
    const results = await Promise.all([invite('Bearer admin-b', body), invite('Bearer admin-b', body)]);
    const winner = results.find((r) => r.status === 200); const loser = results.find((r) => r.status !== 200);
    assert(winner && loser, `one winner, one loser: ${JSON.stringify(results)}`);
    assert(loser.status === 409 && loser.body.error === 'INVITE_RETRY' && loser.retryAfter === '1', `loser is retryable: ${loser.status} ${JSON.stringify(loser.body)} ${loser.retryAfter}`);
    store.arrive = undefined;
    const retry = await invite('Bearer admin-b', body);
    assert(retry.status === 200 && retry.body.ok === true, `retry succeeds: ${retry.status} ${JSON.stringify(retry.body)}`);
  });
  assert(store.users.size === 1, `one account: ${store.users.size}`);
  assert(store.profiles.length === 1 && store.profiles[0].org_id === 'org-b' && store.profiles[0].id === store.users.get('race@example.test'), `one complete profile: ${JSON.stringify(store.profiles)}`);
}});
Deno.test({ sanitizeOps: false, sanitizeResources: false, name: 'AC-INV-008 an Operator invites into the chosen organization, repeats idempotently and gets the same neutral outcome', fn: async () => {
  const store = newStore();
  store.profiles.push({ id: 'elsewhere', org_id: 'org-c', role: 'Engineer', email: 'taken@example.test' });
  await withStore(store, async () => {
    const issued = await invite('Bearer operator', { email: 'fresh@example.test', role: 'Engineer', p_org_id: 'org-a' });
    const again = await invite('Bearer operator', { email: 'fresh@example.test', role: 'Engineer', p_org_id: 'org-a' });
    const taken = await invite('Bearer operator', { email: 'taken@example.test', role: 'Engineer', p_org_id: 'org-a' });
    const takenForAdmin = await invite('Bearer admin-b', { email: 'taken@example.test', role: 'Engineer' });
    assert(issued.status === 200 && store.profiles.some((p) => p.email === 'fresh@example.test' && p.org_id === 'org-a'), `profile in the chosen org: ${JSON.stringify(store.profiles)}`);
    assert(again.status === 200 && again.body.already_invited === true, `repeat: ${again.status} ${JSON.stringify(again.body)}`);
    assert(taken.status === 409 && JSON.stringify(taken.body) === JSON.stringify({ error: 'INVITE_NOT_ADDABLE' }), `operator neutral: ${taken.status} ${JSON.stringify(taken.body)}`);
    assert(taken.status === takenForAdmin.status && JSON.stringify(taken.body) === JSON.stringify(takenForAdmin.body), 'operator and admin get the same outcome');
  });
  assert(store.invites === 1, `one invite email: ${store.invites}`);
}});
