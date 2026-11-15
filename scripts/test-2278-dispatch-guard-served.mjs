/**
 * Local served proof for the dispatch-read tier of the API-client request guard (#2278).
 *
 * The commands that send through adapter-dispatch (`pmo purchases receive`, `pmo purchases pay-captured`, and `pmo load`
 * creating a company on an organization whose companies the ERP owns) make that function read the caller's authorization
 * on the caller's own token: domain_owned_by_tier, actor_authorization_state and, for purchases, pre_cutover_procurement.
 * A command-line sign-in carries client_id, so these reads meet api_client_request_guard().
 *
 * The token here is a real OAuth token from the local Auth server (authorization code + PKCE, approved over HTTP), so it
 * carries client_id exactly like `pmo login`. The script proves:
 *   1. the three reads, POSTed straight to PostgREST, pass the guard for an active Admin;
 *   2. an active Engineer passes the two member reads and is refused pre_cutover_procurement by the guard;
 *   3. each CLI command reaches adapter-dispatch and gets past the caller-token reads (no guard or authorization refusal;
 *      the synthetic ERP responder answers 405, so the commands end at the ERP, never before it).
 *
 * Run only against the local stack, under the DB and test locks, with functions served:
 *   EXTERNAL_CONNECT_ENABLED=true ERPNEXT_LOCAL_BENCH_ORIGINS=http://host.docker.internal:18081 \
 *   scripts/with-db-lock.sh scripts/with-test-lock.sh scripts/serve-functions.sh node scripts/test-2278-dispatch-guard-served.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createPkce, buildAuthorizeUrl, loopbackRedirectUris, writeCredentials } from './pmo.mjs';
import { withCaptureProofCleanup } from './lib/pmo-capture.mjs';

if (!process.env.PMO_DB_LOCK_HELD || !process.env.PMO_TEST_LOCK_HELD || !process.env.SUPABASE_FUNCTIONS_URL) throw new Error('Run under the DB lock, test lock, and served-functions wrapper');
if (process.env.EXTERNAL_CONNECT_ENABLED !== 'true') throw new Error('The local served runtime needs EXTERNAL_CONNECT_ENABLED=true before starting the wrapper');
const status = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
const values = Object.fromEntries(status.trim().split('\n').flatMap(line => {
  const match = /^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/.exec(line);
  return match ? [[match[1], match[2]]] : [];
}));
const api = new URL(values.API_URL);
const db = new URL(values.DB_URL);
if (!['127.0.0.1', 'localhost'].includes(api.hostname) || !['127.0.0.1', 'localhost'].includes(db.hostname)) throw new Error('Only the local stack is permitted');
const base = api.origin;
const anon = values.ANON_KEY;
const service = values.SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error('Local stack credentials unavailable');
const pgEnv = { ...process.env, PGHOST: db.hostname, PGPORT: db.port, PGUSER: decodeURIComponent(db.username), PGPASSWORD: decodeURIComponent(db.password), PGDATABASE: db.pathname.slice(1) };
function sql(statement) {
  try {
    return execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = String(error.stderr ?? '').split('\n').find(line => line.includes('ERROR:')) ?? 'unknown';
    // eslint-disable-next-line preserve-caught-error -- the raw error may carry the credential; only the redacted text is rethrown
    throw new Error(`Synthetic database operation failed: ${detail.replaceAll('synthetic-key:synthetic-secret', '[redacted]')}`);
  }
}
async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`Local request failed (${response.status})`);
  return body;
}

const org = randomUUID(), project = randomUUID(), vendor = randomUUID(), binding = randomUUID(), purchase = randomUUID();
const unique = randomUUID();
const secretName = `dispatch-guard-${unique}`;
const password = `${randomUUID()}Aa1!`;
const people = { admin: { role: 'Admin' }, engineer: { role: 'Engineer' } };
for (const [key, p] of Object.entries(people)) p.email = `dispatch-${key}-${unique}@example.test`;
let oauthClientId;
let fixtureAttempted = false;
let erpRequests = 0;
const testPort = Number(process.env.PMO_DISPATCH_TEST_PORT ?? '18081');
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid synthetic responder port');
if (!(process.env.ERPNEXT_LOCAL_BENCH_ORIGINS ?? '').split(',').includes(`http://host.docker.internal:${testPort}`)) throw new Error('Explicitly allow the synthetic local responder origin before starting the wrapper');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-dispatch-guard-proof-'));
// The synthetic ERP refuses everything: a command that reaches it has already passed the caller-token reads.
const server = http.createServer((req, res) => { erpRequests++; res.writeHead(405, { 'content-type': 'application/json' }).end('{}'); });

/** A real OAuth access token for one user: authorization code + PKCE, consent approved over HTTP. */
async function oauthToken(email) {
  const session = await request(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const { verifier, challenge } = createPkce();
  const redirectUri = loopbackRedirectUris()[0];
  const authorize = await fetch(buildAuthorizeUrl({ supabaseUrl: base, clientId: oauthClientId, redirectUri, challenge, state: randomUUID() }), { headers: { apikey: anon }, redirect: 'manual' });
  const authorizationId = new URL(authorize.headers.get('location') ?? '', base).searchParams.get('authorization_id');
  assert.ok(authorizationId, 'the authorize endpoint hands back an authorization_id');
  const userHeaders = { apikey: anon, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
  // The consent page reads the authorization first; that read is what ties it to the signed-in user.
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
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/pmo.mjs', ...args, '--url', base], { env: { ...process.env, PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: anon }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, text: `${stdout}\n${stderr}` }));
  });
}
const REFUSED_BEFORE_ERP = /not available to OAuth API clients|caller role not resolvable|does not own domain|not an active member|not authorized/i;
async function guardRead(token, name, body) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  return { ok: response.ok, guardRefused: response.status === 403 && /not available to OAuth API clients/.test(text) };
}

await withCaptureProofCleanup(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(testPort, '0.0.0.0', resolve); });
  const adminHeaders = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' };
  const client = await request(`${base}/auth/v1/admin/oauth/clients`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({
    client_name: `dispatch-guard-${unique}`, redirect_uris: loopbackRedirectUris(), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  oauthClientId = client.client_id;
  for (const p of Object.values(people)) {
    const user = await request(`${base}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email: p.email, password, email_confirm: true }) });
    p.id = user.id;
  }
  fixtureAttempted = true;
  sql(`begin;
    insert into organizations(id,name,default_currency) values ('${org}','Dispatch guard proof','IDR');
    insert into profiles(id,org_id,full_name,email,role,status) values
      ('${people.admin.id}','${org}','Synthetic admin','${people.admin.email}','Admin','active'),
      ('${people.engineer.id}','${org}','Synthetic engineer','${people.engineer.email}','Engineer','active');
    insert into projects(id,org_id,name,status) values ('${project}','${org}','Synthetic project','Ongoing Project');
    insert into companies(id,org_id,name,type) values ('${vendor}','${org}','Synthetic vendor','Vendor');
    insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('${org}','companies','${vendor}','erpnext','Supplier:SUP-1');
    select vault.create_secret('synthetic-key:synthetic-secret','${secretName}');
    insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status)
      values ('${binding}','${org}','erpnext','http://host.docker.internal:${testPort}','${secretName}',jsonb_build_object('company','Example','project_map',jsonb_build_object('${project}','PROJECT')),now(),'active');
    insert into external_domain_ownership(org_id,domain,external_tier) values ('${org}','procurement','erpnext'),('${org}','companies','erpnext');
    insert into procurements(id,org_id,project_id,vendor_id,title,requested_by_id) values ('${purchase}','${org}','${project}','${vendor}','Synthetic purchase','${people.admin.id}');
    select upsert_erp_purchase_documents('${org}', '[{"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","supplier_name":"Synthetic vendor","currency":"IDR","grand_total":100,"net_total":100,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"}]'::jsonb);
    commit;`);
  const invoiceDocument = sql(`select id from erp_purchase_documents where org_id='${org}' and erp_name='INVOICE-1'`);

  // 1–2. The three reads straight to PostgREST, per role, with client_id-carrying tokens.
  const admin = await oauthToken(people.admin.email);
  const engineer = await oauthToken(people.engineer.email);
  for (const [who, tokens, cutover] of [['Admin', admin, true], ['Engineer', engineer, false]]) {
    const userId = who === 'Admin' ? people.admin.id : people.engineer.id;
    assert.equal((await guardRead(tokens.access_token, 'domain_owned_by_tier', { p_org_id: org, p_domain: 'procurement', p_tier: 'erpnext' })).ok, true, `${who}: domain_owned_by_tier passes the guard`);
    assert.equal((await guardRead(tokens.access_token, 'actor_authorization_state', { p_org_id: org, p_user_id: userId })).ok, true, `${who}: actor_authorization_state passes the guard`);
    const pre = await guardRead(tokens.access_token, 'pre_cutover_procurement', { p_procurement_id: purchase });
    assert.equal(pre.ok, cutover, `${who}: pre_cutover_procurement ${cutover ? 'passes' : 'is refused by'} the guard`);
    assert.equal(pre.guardRefused, !cutover, `${who}: a refusal comes from the guard itself`);
  }

  // 3. The CLI commands, signed in as the Admin, reach adapter-dispatch past the caller-token reads.
  writeCredentials({ PMO_CONFIG_DIR: dir }, base, { client_id: oauthClientId, access_token: admin.access_token, refresh_token: admin.refresh_token, expires_at: Math.floor(Date.now() / 1000) + admin.expires_in });
  const receive = await cli(['purchases', 'receive', purchase, '--status', 'Complete', '--date', '2026-02-02', '--intent', randomUUID()]);
  assert.doesNotMatch(receive.text, REFUSED_BEFORE_ERP, 'pmo purchases receive gets past the caller-token reads');
  const pay = await cli(['purchases', 'pay-captured', purchase, '--invoice-document', invoiceDocument, '--amount', '100', '--date', '2026-02-02', '--intent', randomUUID(), '--confirm']);
  assert.doesNotMatch(pay.text, REFUSED_BEFORE_ERP, 'pmo purchases pay-captured gets past the caller-token reads');
  const load = path.join(dir, 'load.json');
  fs.writeFileSync(load, JSON.stringify({ companies: [{ name: `Synthetic customer ${unique}`, type: 'Customer' }] }));
  const company = await cli(['load', load]);
  assert.doesNotMatch(company.text, REFUSED_BEFORE_ERP, 'pmo load external company create gets past the caller-token reads');
  assert.ok(erpRequests > 0, 'at least one command reached the synthetic ERP');
  process.stdout.write(`Served dispatch-read guard proof passed; synthetic ERP requests: ${erpRequests}.\n`);
}, async () => {
  await withCaptureProofCleanup(async () => {
    const ids = Object.values(people).map(p => p.id).filter(Boolean);
    if (fixtureAttempted) {
      const tables = ['external_command_outbox', 'procurement_receipts', 'procurement_doc_counters', 'procurements', 'erp_purchase_documents', 'external_domain_ownership', 'external_refs', 'external_org_bindings', 'companies', 'projects', 'audit_events', 'profiles', 'record_changes'];
      try {
        sql(`begin; ${tables.map(table => `delete from public.${table} where org_id='${org}';`).join('\n')}
          delete from auth.users where id in (${ids.map(id => `'${id}'`).join(',')}); delete from vault.secrets where name='${secretName}'; delete from organizations where id='${org}';
          do $$ declare item record; remains boolean; begin
            for item in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
              join pg_attribute a on a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped
              where n.nspname='public' and c.relkind in ('r','p') loop
              execute format('select exists(select 1 from %I.%I where org_id::text=%L)',item.nspname,item.relname,'${org}') into remains;
              if remains then raise exception 'fixture rows remain in %', item.relname; end if;
            end loop;
          end $$; commit;`);
      } catch (error) {
        throw new Error(`Synthetic fixture cleanup failed for organization ${org}`, { cause: error });
      }
    } else {
      for (const id of ids) await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: service, authorization: `Bearer ${service}` } });
    }
    if (oauthClientId) await fetch(`${base}/auth/v1/admin/oauth/clients/${oauthClientId}`, { method: 'DELETE', headers: { apikey: service, authorization: `Bearer ${service}` } });
    assert.equal(sql(`select count(*) from organizations where id='${org}'`), '0');
    assert.equal(sql(`select count(*) from vault.secrets where name='${secretName}'`), '0');
    process.stdout.write('Synthetic fixture cleanup verified.\n');
  }, async () => {
    await withCaptureProofCleanup(
      () => server.listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve(),
      () => fs.rmSync(dir, { recursive: true, force: true }),
    );
  });
});
