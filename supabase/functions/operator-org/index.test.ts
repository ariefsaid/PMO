let handler: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Deno.serve = ((fn: typeof handler) => { handler = fn; }) as unknown as typeof Deno.serve;
await import('./index.ts');
Deno.serve = serve;

Deno.test({ name: 'AC-ONB-001: inactive operators cannot use either action or exercise the service key', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const oldFetch = globalThis.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const old = keys.map(k => Deno.env.get(k));
  ['http://localhost:9999', 'anon', 'service'].forEach((v, i) => Deno.env.set(keys[i], v));
  let service = false; let isOperator = false; let isActive = true;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.headers.get('apikey') === 'service') service = true;
    const data = req.url.endsWith('/auth/v1/user') ? { id: 'caller' } : req.url.endsWith('/rpc/is_operator') ? isOperator : isActive;
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
  }) as typeof fetch;
  try {
    for (const action of ['create', 'status']) for (const flags of [[false, true], [true, false]]) {
      [isOperator, isActive] = flags;
      const result = await handler(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer caller', 'content-type': 'application/json' }, body: JSON.stringify({ action }) }));
      if (result.status !== 403 || (await result.json()).error !== 'OPERATOR_ONLY') throw new Error('inactive operator must be refused');
    }
    if (service) throw new Error('service key must not be exercised');
  } finally {
    globalThis.fetch = oldFetch;
    keys.forEach((k, i) => old[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, old[i]!));
  }
}});

const valid = { action: 'create', name: 'Acme', admin_email: 'a@example.test', admin_full_name: 'Admin', default_currency: 'USD', default_locale: 'en', default_timezone: 'UTC', plan_id: 'standard' };
const org = '11111111-1111-4111-8111-111111111111';
interface Scenario { orgExists?: boolean; orgAdmin?: boolean; profile?: boolean; lookupError?: boolean; account?: 'pending' | 'active' | 'other'; orgError?: boolean; planError?: boolean; rateLimited?: boolean; status?: boolean; inviteExisting?: boolean; unknownPlan?: boolean; noPlan?: boolean; manyStages?: boolean; manyAdmins?: boolean; pagedAccount?: boolean; }
async function run(body: Record<string, unknown>, s: Scenario = {}) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SITE_URL'];
  const old = keys.map(k => Deno.env.get(k));
  ['http://localhost:9999', 'anon', 'service', 'https://example.test'].forEach((v, i) => Deno.env.set(keys[i], v));
  const oldFetch = globalThis.fetch; const calls: { path: string; method: string; key: string | null; body: string; query: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init); const url = new URL(req.url); const path = url.pathname;
    calls.push({ path, method: req.method, key: req.headers.get('authorization'), body: await req.text(), query: url.search });
    let value: unknown; let status = 200; let profileCount = 0;
    if (path === '/auth/v1/user') value = { id: 'caller' };
    else if (path.endsWith('/rpc/is_operator') || path.endsWith('/rpc/is_active_member')) value = true;
    else if (path.endsWith('/rpc/rate_limit_hit')) value = !s.rateLimited;
    else if (path === '/rest/v1/plans') value = s.unknownPlan ? [] : [{ id: 'standard' }];
    else if (path === '/rest/v1/organizations') value = (s.orgExists || s.status) ? [{ id: org, name: 'Acme', lifecycle_state: null }] : [];
    else if (s.status && path === '/rest/v1/profiles') {
      const rows = [
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', org_id: org, role: 'Admin', status: 'active' },
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', org_id: org, role: 'Member', status: 'active' },
        { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', org_id: org, role: 'Admin', status: 'disabled' },
        { id: 'other', org_id: '22222222-2222-4222-8222-222222222222', role: 'Admin', status: 'active' },
        ...(s.manyAdmins ? [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', org_id: org, role: 'Admin', status: 'active' }] : []),
      ];
      const filtered = rows.filter(row => ['org_id', 'role', 'status'].every(key => {
        const filter = url.searchParams.get(key);
        return !filter || filter === `eq.${row[key as keyof typeof row]}`;
      }));
      profileCount = filtered.length;
      const offset = Number(url.searchParams.get('offset') ?? 0);
      value = s.manyAdmins ? filtered.slice(offset, offset + 1) : filtered;
    }
    else if (s.status && path === '/rest/v1/org_plans') value = s.noPlan ? [] : url.searchParams.get('org_id') === `eq.${org}` ? [{ plan_id: 'standard' }] : [{ plan_id: 'private-other-plan' }];
    else if (s.status && path === '/rest/v1/pipeline_stage_config') value = url.searchParams.get('org_id') === `eq.${org}` ? [{ org_id: org }] : [{ org_id: 'other' }];
    else if (s.status && path === '/rest/v1/org_features') value = url.searchParams.get('org_id') === `eq.${org}` ? [{ feature_key: 'projects', enabled: true }] : [{ feature_key: 'private-other-feature', enabled: false }];
    else if (s.status && path.startsWith('/auth/v1/admin/users/')) value = { id: 'admin', last_sign_in_at: null };
    else if (path === '/rest/v1/profiles') {
      if (s.lookupError) { status = 500; value = { message: 'failure' }; }
      else {
        const rows = s.orgAdmin || s.profile ? [{ id: 'admin', org_id: org, role: 'Admin', email: 'a@example.test' }] : [];
        value = rows.filter(row => {
          const address = url.searchParams.get('email');
          return !address || address.toLowerCase() === `ilike.${row.email}`;
        });
      }
    }
    else if (path === '/auth/v1/admin/users' && s.pagedAccount) {
      const page = Number(url.searchParams.get('page'));
      value = { users: page === 1 ? [{ id: 'x', email: 'x@example.test' }, { id: 'y', email: 'y@example.test' }] : page === 2 ? [{ id: 'z', email: 'z@example.test' }, { id: 'admin', email: 'a@example.test', user_metadata: { invite_pending: true } }] : [] };
    }
    else if (path === '/auth/v1/admin/users') value = { users: s.account && url.searchParams.get('page') === '1' ? [{ id: 'admin', email: s.account === 'other' ? 'other@example.test' : 'a@example.test', last_sign_in_at: s.account === 'active' ? '2026-01-01' : null, user_metadata: { invite_pending: true } }] : [] };
    else if (path === '/auth/v1/invite') value = { id: 'admin', email: 'a@example.test', last_sign_in_at: s.inviteExisting ? '2026-01-01' : null, user_metadata: { invite_pending: true } };
    else if (path.endsWith('/rpc/operator_create_org')) { value = s.orgError ? { message: 'failure' } : org; status = s.orgError ? 500 : 200; }
    else if (path.endsWith('/rpc/operator_set_org_plan')) { value = s.planError ? { message: 'failure' } : null; status = s.planError ? 500 : 200; }
    else { console.error('unexpected request', path); throw new Error(`unexpected request ${path}`); }
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...(s.status && path === '/rest/v1/pipeline_stage_config' ? { 'content-range': s.manyStages ? '0-0/1001' : '0-0/1' } : {}), ...(s.status && path === '/rest/v1/profiles' ? { 'content-range': `0-0/${profileCount}` } : {}) } });
  }) as typeof fetch;
  try {
    const response = await handler(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer caller', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json(), calls };
  } finally { globalThis.fetch = oldFetch; keys.forEach((k, i) => old[i] === undefined ? Deno.env.delete(k) : Deno.env.set(k, old[i]!)); }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function test(name: string, fn: () => Promise<void>) { Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false }); }
test('AC-ONB-002: required fields and invalid email are rejected before lookups', async () => {
  for (const [field, code] of [['name','ORG_NAME_REQUIRED'], ['admin_email','BAD_EMAIL'], ['admin_full_name','ADMIN_NAME_REQUIRED'], ['default_currency','CURRENCY_REQUIRED'], ['default_locale','LOCALE_REQUIRED'], ['default_timezone','TIMEZONE_REQUIRED'], ['plan_id','PLAN_REQUIRED']]) {
    const r = await run({ ...valid, [field]: '' }); check(r.status === 400 && r.body.error === code, code); check(!r.calls.some(c => c.path.endsWith('/rpc/rate_limit_hit') || c.path === '/auth/v1/invite'), 'no rate limit or invitation');
  }
  const r = await run({ ...valid, admin_email: 'a*b@example.test' }); check(r.body.error === 'BAD_EMAIL', 'wildcard refused');
});
test('AC-ONB-003: conflicting organization or existing profile is refused before invitation', async () => {
  for (const [s, code] of [[{orgExists: true}, 'ORG_NAME_TAKEN'], [{profile: true}, 'ADMIN_HAS_PROFILE']] as const) {
    const r = await run(valid, s); check(r.status === 409 && r.body.error === code, code); check(!r.calls.some(c => c.path === '/auth/v1/invite'), 'no invitation');
  }
});
test('AC-ONB-004: create invites then creates and assigns under the caller token', async () => {
  const r = await run(valid); check(r.status === 200 && r.body.org_id === org && r.body.created === true, 'created response');
  const invites = r.calls.filter(c => c.path === '/auth/v1/invite');
  check(invites.length === 1, 'one invitation');
  check(new URLSearchParams(invites[0].query).get('redirect_to') === 'https://example.test/update-password', 'server redirect');
  check(JSON.parse(invites[0].body).data.invite_pending === true, 'pending metadata');
  const create = r.calls.find(c => c.path.endsWith('/rpc/operator_create_org'));
  const plan = r.calls.find(c => c.path.endsWith('/rpc/operator_set_org_plan'));
  check(create && JSON.parse(create.body).p_admin_user_id === 'admin', 'invited account is first admin');
  check(plan && JSON.parse(plan.body).p_org_id === org && JSON.parse(plan.body).p_plan_id === 'standard', 'requested plan assigned');
  for (const name of ['operator_create_org','operator_set_org_plan']) check(r.calls.some(c => c.path.endsWith('/rpc/' + name) && c.key === 'Bearer caller'), name);
});
test('AC-ONB-005: failed create names its step and retains account', async () => {
  const r = await run(valid, { orgError: true }); check(r.status === 502 && r.body.step === 'create_org', 'failure response'); check(!r.calls.some(c => c.method === 'DELETE'), 'no deletion');
});
test('AC-ONB-006: same organization and admin is idempotent even without plan assignment', async () => {
  const r = await run(valid, { orgExists: true, orgAdmin: true }); check(r.status === 200 && r.body.created === false && r.body.org_id === org, 'existing organization'); check(!r.calls.some(c => c.path === '/auth/v1/invite' || c.path.endsWith('/rpc/operator_create_org') || c.path.endsWith('/rpc/operator_set_org_plan')), 'no writes');
});
test('pending profile-less account is reused', async () => { const r = await run(valid, { account: 'pending' }); check(r.status === 200 && r.body.org_id === org && r.body.created === true && !r.calls.some(c => c.path === '/auth/v1/invite') && r.calls.some(c => c.path.endsWith('/rpc/operator_create_org')), 'account reused'); });
test('signed-in profile-less account is refused', async () => { const r = await run(valid, { account: 'active' }); check(r.status === 409 && r.body.error === 'ADMIN_ACCOUNT_EXISTS', 'signed-in account refused'); });
test('rate limited create returns 429', async () => { const r = await run(valid, { rateLimited: true }); check(r.status === 429 && r.body.error === 'RATE_LIMITED', 'rate limit'); });

test('AC-ONB-007: status includes only the requested organization', async () => {
  const r = await run({ action: 'status', org_id: org }, { status: true });
  check(r.status === 200 && r.body.exists && r.body.name === 'Acme' && r.body.plan_id === 'standard', 'requested org');
  check(r.body.admins.pending === 1 && r.body.stage_config_count === 1 && r.body.features[0].key === 'projects', 'requested details');
  check(!JSON.stringify(r.body).includes('private-other'), 'no other organization data');
  const orgQuery = r.calls.find(c => c.path === '/rest/v1/organizations');
  check(orgQuery && new URLSearchParams(orgQuery.query).get('id') === `eq.${org}`, 'organization query scoped');
  for (const c of r.calls.filter(c => ['/rest/v1/profiles','/rest/v1/org_plans','/rest/v1/pipeline_stage_config','/rest/v1/org_features'].includes(c.path))) check(new URLSearchParams(c.query).get('org_id') === `eq.${org}`, 'each query is scoped');
});

test('lookup failures refuse issuance and plan failures retain the account', async () => {
  const lookup = await run(valid, { lookupError: true }); check(lookup.status === 502 && lookup.body.error === 'LOOKUP_FAILED' && !lookup.calls.some(c => c.path === '/auth/v1/invite'), 'lookup failure');
  const plan = await run(valid, { planError: true }); check(plan.status === 502 && plan.body.error === 'PLAN_ASSIGN_FAILED' && plan.body.org_id === org && plan.body.step === 'assign_plan', 'plan failure');
  for (const r of [lookup, plan]) check(!r.calls.some(c => c.method === 'DELETE'), 'no account deleted');
});

test('a previously signed-in account returned by invite is not adopted', async () => { const r = await run(valid, { inviteExisting: true }); check(r.status === 409 && r.body.error === 'ADMIN_ACCOUNT_EXISTS' && !r.calls.some(c => c.path.endsWith('/rpc/operator_create_org')), 'signed-in account must not be adopted'); });

test('unknown plan and invalid status id fail before any issuance', async () => {
  const plan = await run(valid, { unknownPlan: true }); check(plan.status === 400 && plan.body.error === 'UNKNOWN_PLAN' && !plan.calls.some(c => c.path === '/auth/v1/invite'), 'unknown plan');
  const id = await run({ action: 'status', org_id: 'invalid' }); check(id.status === 400 && id.body.error === 'BAD_ORG_ID', 'bad id');
  const noPlan = await run({ action: 'status', org_id: org }, { status: true, noPlan: true }); check(noPlan.status === 200 && noPlan.body.plan_id === null, 'no fallback plan');
});
test('client refusals are silent and server failures log only a code', async () => {
  const original = console.error; const logs: string[] = [];
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    const response = await handler(new Request('http://localhost', { method: 'POST' }));
    check(response.status === 401 && logs.length === 0, 'unauthorized refusal is not logged');
    const failure = await run(valid, { lookupError: true });
    check(failure.status === 502 && logs.some(line => line.includes('LOOKUP_FAILED')), 'server failure logged');
    check(logs.every(line => !line.includes('a@example.test') && !line.includes('caller')), 'logs contain no address or token');
  } finally { console.error = original; }
});

test('account lookup does not reuse a different address', async () => { const r = await run(valid, { account: 'other' }); check(r.status === 200 && r.calls.some(c => c.path === '/auth/v1/invite'), 'other address is never selected'); });

test('status counts every stage even beyond the API row limit', async () => { const r = await run({ action: 'status', org_id: org }, { status: true, manyStages: true }); check(r.status === 200 && r.body.stage_config_count === 1001, 'exact count'); });

test('status counts every admin across API pages', async () => { const r = await run({ action: 'status', org_id: org }, { status: true, manyAdmins: true }); check(r.status === 200 && r.body.admins.pending === 2, 'all admins counted'); });

test('wildcard organization name is rejected before service access', async () => {
  const r = await run({ ...valid, name: 'Acme*' });
  check(r.status === 400 && r.body.error === 'BAD_ORG_NAME', 'wildcard name refused');
  check(!r.calls.some(c => c.key === 'Bearer service' || c.path === '/auth/v1/invite'), 'no service request');
});
test('account scan continues past short pages', async () => {
  const r = await run(valid, { pagedAccount: true });
  check(r.status === 200 && !r.calls.some(c => c.path === '/auth/v1/invite'), 'later pending account reused');
});
test('different address is not the existing organization admin', async () => {
  const r = await run({ ...valid, admin_email: 'different@example.test' }, { orgExists: true, orgAdmin: true });
  check(r.status === 409 && r.body.error === 'ORG_NAME_TAKEN', 'different admin is refused');
});
