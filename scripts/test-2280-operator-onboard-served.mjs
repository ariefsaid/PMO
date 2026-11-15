/**
 * Local served proof that the platform Operator can add an organisation from the command line (#2280; the recorded
 * AC-ONB-014 run, #2257).
 *
 * `pmo org add` calls the operator-org function with the caller's own token, and the function then calls five RPCs on that
 * token (is_operator, is_active_member, operator_plan_catalogue, operator_org_plan, operator_create_org_with_setup, which
 * sets plan, features and starting state in the same transaction). A command-line sign-in carries client_id, so every one
 * of them meets api_client_request_guard(). The tokens here are real OAuth tokens from the local
 * Auth server (authorization code + PKCE, consent approved over HTTP); nothing is mocked, neither the guard nor the function.
 *
 *   1. Operator: a dry run writes nothing.
 *   2. Operator: a confirmed run creates the organisation with its Admin, plan, feature choice, stage configuration and state.
 *   3. Operator: a second run changes nothing (identical row counts for the new organisation).
 *   4. An organisation Admin who is not an Operator is refused at the first call and creates nothing.
 *   5. The Operator's token is refused by the guard for plan, feature and state changes on the new organisation and for other
 *      operator calls (suspend and close stay app-only).
 *
 * Run only against the local stack, under the DB and test locks, with functions served (SITE_URL for the invitation link
 * comes from the gitignored supabase/functions/.env.local):
 *   scripts/with-db-lock.sh scripts/with-test-lock.sh scripts/serve-functions.sh node scripts/test-2280-operator-onboard-served.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPkce, buildAuthorizeUrl, loopbackRedirectUris, writeCredentials } from './pmo.mjs';
import { withCaptureProofCleanup } from './lib/pmo-capture.mjs';

if (!process.env.PMO_DB_LOCK_HELD || !process.env.PMO_TEST_LOCK_HELD || !process.env.SUPABASE_FUNCTIONS_URL) throw new Error('Run under the DB lock, test lock, and served-functions wrapper');
const status = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
const values = Object.fromEntries(status.trim().split('\n').flatMap(line => {
  const match = /^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/.exec(line);
  return match ? [[match[1], match[2]]] : [];
}));
const api = new URL(values.API_URL);
if (!['127.0.0.1', 'localhost'].includes(api.hostname) ) throw new Error('Only the local stack is permitted');
const base = api.origin;
const anon = values.ANON_KEY;
const service = values.SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error('Local stack credentials unavailable');
// The local database container's own psql: the Mac needs no client installed, and only the local stack has this container.
function sql(statement) {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_pmo-portal', 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = String(error.stderr ?? '').split('\n').find(line => line.includes('ERROR:')) ?? String(error.message).slice(0, 200);
    throw new Error(`Synthetic database operation failed: ${detail}`, { cause: error });
  }
}
async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`Local request failed (${response.status})`);
  return body;
}

const unique = randomUUID();
const homeOrg = randomUUID();
const password = `${randomUUID()}Aa1!`;
const people = { operator: {}, admin: {} };
for (const [key, p] of Object.entries(people)) p.email = `onb2280-${key}-${unique}@example.test`;
const newName = `Onb2280 ${unique}`;
const newAdminEmail = `onb2280-new-admin-${unique}@example.test`;
const refusedName = `Onb2280 refused ${unique}`;
let oauthClientId;
let fixtureAttempted = false;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-onb2280-proof-'));

/** A real OAuth access token for one user: authorization code + PKCE, consent approved over HTTP. */
async function oauthToken(email) {
  const session = await request(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const { verifier, challenge } = createPkce();
  const redirectUri = loopbackRedirectUris()[0];
  const authorize = await fetch(buildAuthorizeUrl({ supabaseUrl: base, clientId: oauthClientId, redirectUri, challenge, state: randomUUID() }), { headers: { apikey: anon }, redirect: 'manual' });
  const authorizationId = new URL(authorize.headers.get('location') ?? '', base).searchParams.get('authorization_id');
  assert.ok(authorizationId, 'the authorize endpoint hands back an authorization_id');
  const userHeaders = { apikey: anon, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
  await request(`${base}/auth/v1/oauth/authorizations/${authorizationId}`, { headers: userHeaders });
  const consent = await request(`${base}/auth/v1/oauth/authorizations/${authorizationId}/consent`, { method: 'POST', headers: userHeaders, body: JSON.stringify({ action: 'approve' }) });
  const code = new URL(consent.redirect_url).searchParams.get('code');
  assert.ok(code, 'the approved consent returns an authorization code');
  const tokens = await request(`${base}/auth/v1/oauth/token`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: oauthClientId, code_verifier: verifier }) });
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.client_id, oauthClientId, 'the token carries client_id, as a command-line sign-in does');
  return tokens;
}
/** Run `pmo <args>` signed in with `tokens`, in a config directory of its own. */
function cli(tokens, args) {
  const dir = fs.mkdtempSync(path.join(root, 'cfg-'));
  writeCredentials({ PMO_CONFIG_DIR: dir }, base, { client_id: oauthClientId, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/pmo.mjs', ...args, '--url', base], { env: { ...process.env, PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: anon }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, text: `${stdout}\n${stderr}` }));
  });
}
const addArgs = (name, email, ...rest) => ['org', 'add', '--name', name, '--admin-email', email, '--admin-name', 'Onb2280 Admin', '--currency', 'IDR', '--locale', 'id', '--timezone', 'Asia/Jakarta', '--plan', 'starter', '--state', 'test', '--feature', 'crm=on', ...rest];
const orgTables = () => sql(`select string_agg(table_name, ',' order by table_name) from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
  where c.table_schema='public' and c.column_name='org_id' and t.table_type='BASE TABLE'`).split(',');
/** Row count per organisation-owned table for one organisation, only the tables that hold rows. */
function snapshot(orgId) {
  const parts = orgTables().map(t => `select '${t}' as t, count(*) as n from public.${t} where org_id='${orgId}'`);
  return sql(`select string_agg(t || '=' || n, ',' order by t) from (${parts.join(' union all ')}) s where n > 0`);
}
const newOrgId = () => sql(`select id from organizations where name='${newName}'`);

await withCaptureProofCleanup(async () => {
  const adminHeaders = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' };
  const client = await request(`${base}/auth/v1/admin/oauth/clients`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({
    client_name: `onb2280-${unique}`, redirect_uris: loopbackRedirectUris(), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  oauthClientId = client.client_id;
  for (const p of Object.values(people)) {
    const user = await request(`${base}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email: p.email, password, email_confirm: true }) });
    p.id = user.id;
  }
  fixtureAttempted = true;
  sql(`begin;
    insert into organizations(id,name,default_currency) values ('${homeOrg}','Onb2280 home ${unique}','IDR');
    insert into profiles(id,org_id,full_name,email,role,status) values
      ('${people.operator.id}','${homeOrg}','Synthetic operator','${people.operator.email}','Admin','active'),
      ('${people.admin.id}','${homeOrg}','Synthetic admin','${people.admin.email}','Admin','active');
    insert into platform_operators(user_id) values ('${people.operator.id}');
    commit;`);
  const operator = await oauthToken(people.operator.email);
  const admin = await oauthToken(people.admin.email);

  // 1. Dry run writes nothing.
  const dry = await cli(operator, addArgs(newName, newAdminEmail));
  assert.equal(dry.code, 0, dry.text);
  assert.match(dry.text, /Dry run/);
  assert.equal(sql(`select count(*) from organizations where name='${newName}'`), '0', 'a dry run creates nothing');

  // 2. The confirmed run, AC-ONB-014.
  const first = await cli(operator, addArgs(newName, newAdminEmail, '--confirm'));
  assert.equal(first.code, 0, first.text);
  const orgId = newOrgId();
  assert.match(orgId, /^[0-9a-f-]{36}$/, 'the organisation exists');
  assert.match(first.text, new RegExp(`Organization: ${orgId}`));
  assert.match(first.text, /State: test/);
  assert.equal(sql(`select lifecycle_state from organizations where id='${orgId}'`), 'test');
  assert.equal(sql(`select plan_id from org_plans where org_id='${orgId}'`), 'starter', 'the explicit plan is assigned');
  assert.equal(sql(`select count(*) from profiles where org_id='${orgId}' and role='Admin' and email='${newAdminEmail}'`), '1', 'the first Admin exists');
  assert.ok(Number(sql(`select count(*) from pipeline_stage_config where org_id='${orgId}'`)) >= 1, 'stage configuration exists');
  assert.equal(sql(`select enabled from org_features where org_id='${orgId}' and feature_key='crm'`), 't', 'the requested feature choice is stored');

  // 3. A second run changes nothing.
  const before = snapshot(orgId);
  const second = await cli(operator, addArgs(newName, newAdminEmail, '--confirm'));
  assert.equal(second.code, 0, second.text);
  assert.match(second.text, /Organization already exists/);
  assert.equal(snapshot(orgId), before, 'a second run leaves every row count unchanged');
  assert.equal(sql(`select count(*) from organizations where name='${newName}'`), '1');

  // 4. An organisation Admin who is not an Operator is refused at the first call.
  const refused = await cli(admin, addArgs(refusedName, `onb2280-refused-${unique}@example.test`, '--confirm'));
  assert.notEqual(refused.code, 0, 'a non-Operator is refused');
  assert.match(refused.text, /OPERATOR_ONLY/);
  assert.equal(sql(`select count(*) from organizations where name='${refusedName}'`), '0', 'a refused run creates nothing');

  // 5. The Operator's command-line token cannot change the organisation it just added, nor reach other operator calls.
  for (const [name, body] of [
    ['operator_set_org_plan', { p_org_id: orgId, p_plan_id: 'enterprise' }],
    ['operator_toggle_feature', { p_org_id: orgId, p_key: 'crm', p_enabled: false }],
    ['operator_set_org_lifecycle_state', { p_org_id: orgId, p_lifecycle_state: 'live' }],
    ['operator_set_global_feature', { p_key: 'crm', p_enabled: true }],
    ['operator_list_orgs', {}],
  ]) {
    const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${operator.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    assert.equal(response.status, 403, `${name}: ${text}`);
    assert.match(text, /not available to OAuth API clients/, `${name} is refused by the guard`);
  }
  assert.equal(snapshot(orgId), before, 'the refused calls changed nothing');
  process.stdout.write(`Served operator onboarding proof passed; organisation ${orgId} added, second run unchanged, non-Operator refused.\n`);
}, async () => {
  await withCaptureProofCleanup(async () => {
    const ids = Object.values(people).map(p => p.id).filter(Boolean);
    const created = fixtureAttempted ? sql(`select string_agg(id::text, ',') from organizations where name in ('${newName}','${refusedName}')`) : '';
    const orgIds = [homeOrg, ...(created ? created.split(',') : [])];
    const orgList = orgIds.map(id => `'${id}'`).join(',');
    // The new Admin is an invited Auth account: found by profile when the run got that far, by address otherwise.
    const adminIds = fixtureAttempted ? sql(`select string_agg(id::text, ',') from (select id from profiles where org_id in (${orgList})
      union select id from auth.users where email like 'onb2280-%-${unique}@example.test') s`) : '';
    if (fixtureAttempted) {
      try {
        // Local stack only: replica mode skips the foreign keys so one pass can empty every organisation-owned table.
        sql(`begin; set local session_replication_role = replica;
          delete from platform_operators where user_id in (${ids.map(id => `'${id}'`).join(',')});
          do $$ declare item record; begin
            for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
              join pg_attribute a on a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped
              where n.nspname='public' and c.relkind in ('r','p') loop
              execute format('delete from public.%I where org_id::text = any($1)', item.relname) using array[${orgList}];
            end loop;
          end $$;
          delete from organizations where id in (${orgList}); commit;`);
      } catch (error) {
        throw new Error(`Synthetic fixture cleanup failed for organization ${homeOrg}`, { cause: error });
      }
    }
    for (const id of new Set([...ids, ...(adminIds ? adminIds.split(',') : [])])) await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, authorization: `Bearer ${service}` } });
    if (oauthClientId) await fetch(`${base}/auth/v1/admin/oauth/clients/${oauthClientId}`, { method: 'DELETE', headers: { apikey: service, authorization: `Bearer ${service}` } });
    assert.equal(sql(`select count(*) from organizations where id in (${orgList}) or name in ('${newName}','${refusedName}')`), '0');
    assert.equal(sql(`select count(*) from auth.users where email like 'onb2280-%-${unique}@example.test'`), '0');
    process.stdout.write('Synthetic fixture cleanup verified.\n');
  }, async () => {
    fs.rmSync(root, { recursive: true, force: true });
  });
});
