/** Local served capture proof. Run only under serve-functions.sh and the DB/test locks. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { writeCredentials } from './pmo.mjs';
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
    throw new Error(`Synthetic database operation failed: ${detail.replaceAll('synthetic-key:synthetic-secret', '[redacted]')}`);
  }
}
async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`Local request failed (${response.status})`);
  return body;
}
const org = randomUUID(), project = randomUUID(), vendor = randomUUID(), binding = randomUUID(), snapshot = randomUUID(), generation = randomUUID(), refresh = randomUUID();
const unique = randomUUID();
const secretName = `capture-integration-${unique}`;
const email = `capture-${unique}@example.test`;
const password = `${randomUUID()}Aa1!`;
let userId;
let fixtureAttempted = false;
let settingsReads = 0;
let unexpectedRequests = 0;
const testPort = Number(process.env.PMO_CAPTURE_TEST_PORT ?? '18080');
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid synthetic responder port');
if (!(process.env.ERPNEXT_LOCAL_BENCH_ORIGINS ?? '').split(',').includes(`http://host.docker.internal:${testPort}`)) throw new Error('Explicitly allow the synthetic local responder origin before starting the wrapper');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-capture-proof-'));
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/api/resource/System%20Settings/System%20Settings') {
    unexpectedRequests++;
    res.writeHead(405).end();
    return;
  }
  settingsReads++;
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { currency_precision: '2' } }));
});
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/pmo.mjs', ...args, '--url', base], { env: { ...process.env, PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: anon }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      try { resolve({ code, body: JSON.parse(stdout), stderr }); }
      catch { reject(new Error(`CLI returned invalid output (exit ${code})`)); }
    });
  });
}
await withCaptureProofCleanup(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(testPort, '0.0.0.0', resolve); });
  const user = await request(`${base}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.match(user.id, /^[0-9a-f-]{36}$/i);
  userId = user.id;
  const tokens = await request(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  writeCredentials({ PMO_CONFIG_DIR: dir }, base, { client_id: 'capture-integration', access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in });
  fixtureAttempted = true;
  sql(`begin;
    insert into organizations(id,name,default_currency) values ('${org}','Capture integration','IDR');
    insert into profiles(id,org_id,full_name,email,role,status) values ('${userId}','${org}','Synthetic admin','${email}','Admin','active');
    insert into projects(id,org_id,name,status) values ('${project}','${org}','Synthetic project','Ongoing Project');
    insert into companies(id,org_id,name,type) values ('${vendor}','${org}','Synthetic vendor','Vendor');
    insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('${org}','companies','${vendor}','erpnext','Supplier:SUP-1');
    select vault.create_secret('synthetic-key:synthetic-secret','${secretName}');
    insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status)
      values ('${binding}','${org}','erpnext','http://host.docker.internal:${testPort}','${secretName}',jsonb_build_object('company','Example','project_map',jsonb_build_object('${project}','PROJECT')),now(),'active');
    select upsert_erp_purchase_documents('${org}', '[{"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","supplier_name":"Synthetic vendor","currency":"IDR","grand_total":100,"net_total":100,"erp_status":"To Bill","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"},{"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","supplier_name":"Synthetic vendor","currency":"IDR","grand_total":100,"net_total":100,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","purchase_orders":["ORDER-1"],"erp_modified":"2026-02-01"}]'::jsonb);
    insert into budget_category_account_map(org_id,category,erp_account) values ('${org}','Materials','Cost');
    insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values ('${org}','Example','Cost','Cost','Expense','Profit and Loss',false,'IDR',1,2,'${refresh}');
    insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values ('${org}','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100,0,false,'2026-02-01');
    insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at) values ('${org}','${binding}','purchases',now()),('${org}','${binding}','ledger',now());
    insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
      values ('${org}','Example','${snapshot}','${generation}','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output');
    insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context) values ('${org}','Example','${snapshot}','${generation}','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
    commit;`);
  const rpcHeaders = { apikey: anon, authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' };
  const sourcePage = await request(`${base}/rest/v1/rpc/purchase_capture_source_page`, { method: 'POST', headers: rpcHeaders, body: JSON.stringify({ p_project_id: project, p_limit: 500 }) });
  const ledgerPage = await request(`${base}/rest/v1/rpc/purchase_capture_ledger_page`, { method: 'POST', headers: rpcHeaders, body: JSON.stringify({ p_project_id: project, p_limit: 500 }) });
  assert.equal(sourcePage.sources.length, 2);
  assert.equal(ledgerPage.lines.length, 1);
  assert.equal(sourcePage.revision, ledgerPage.revision);
  const allPreview = await cli(['purchases', 'capture', '--all', '--dry-run']);
  assert.equal(allPreview.code, 0);
  assert.equal(allPreview.body.complete, true);
  const preview = await cli(['purchases', 'capture', '--project', project, '--dry-run']);
  assert.equal(preview.code, 0);
  assert.equal(preview.body.complete, true);
  assert.equal(preview.body.proposals.length, 2);
  assert.equal(preview.body.reports[0].ledgerMinor, '10000');
  const revision = preview.body.revision;
  assert.ok(revision);
  const requestId = randomUUID();
  const applyArgs = ['purchases', 'capture', '--project', project, '--apply', '--revision', revision, '--request', requestId];
  const applied = await cli(applyArgs);
  assert.equal(applied.code, 0);
  assert.equal(applied.body.complete, true);
  const repeated = await cli(applyArgs);
  assert.equal(repeated.code, 0);
  assert.equal(sql(`select count(*) from erp_purchase_captures where org_id='${org}'`), '1');
  const report = await cli(['purchases', 'capture-report', '--project', project]);
  assert.equal(report.code, 0);
  assert.equal(report.body.reports[0].representedMinor, '10000');
  assert.equal(report.body.reports[0].remainderMinor, '0');
  const allReport = await cli(['purchases', 'capture-report', '--all']);
  assert.equal(allReport.code, 0);
  assert.equal(allReport.body.reports[0].representedMinor, '10000');
  assert.equal(settingsReads, 12);
  assert.equal(unexpectedRequests, 0);
  process.stdout.write('Served capture preview, apply, retry and report passed; settings GETs: 12; ERP writes: 0.\n');
}, async () => {
  await withCaptureProofCleanup(async () => {
    if (fixtureAttempted) {
      const tables = ['erp_capture_batches', 'erp_purchase_captures', 'procurement_erp_links', 'procurement_doc_counters', 'procurements', 'external_refs', 'erp_purchase_documents', 'erp_capture_feed_witnesses', 'erp_financial_statement_published_context', 'erp_financial_statement_snapshot', 'erp_gl_entry_mirror', 'erp_account_mirror', 'budget_category_account_map', 'external_org_bindings', 'companies', 'projects', 'audit_events', 'profiles'];
      try {
        sql(`begin; ${tables.map(table => `delete from public.${table} where org_id='${org}';`).join('\n')} delete from auth.users where id='${userId}'; delete from vault.secrets where name='${secretName}'; delete from organizations where id='${org}'; delete from public.record_changes where org_id='${org}';
          do $$ declare item record; remains boolean; begin
            for item in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
              join pg_attribute a on a.attrelid=c.oid and a.attname='org_id' and not a.attisdropped
              where n.nspname='public' and c.relkind in ('r','p') loop
              execute format('select exists(select 1 from %I.%I where org_id::text=%L)',item.nspname,item.relname,'${org}') into remains;
              if remains then raise exception 'fixture rows remain in %', item.relname; end if;
            end loop;
          end $$; commit;`);
      } catch (error) {
        throw new Error(`Synthetic fixture cleanup failed for organization ${org} and user ${userId}`, { cause: error });
      }
      const counts = [...tables, 'record_changes'].map(table => `(select count(*) from public.${table} where org_id='${org}')`).join(' + ');
      assert.equal(sql(`select ${counts}`), '0');
      assert.equal(sql(`select count(*) from organizations where id='${org}'`), '0');
      assert.equal(sql(`select count(*) from auth.users where id='${userId}'`), '0');
      assert.equal(sql(`select count(*) from vault.secrets where name='${secretName}'`), '0');
      process.stdout.write('Synthetic fixture cleanup verified.\n');
    } else if (userId) {
      const response = await fetch(`${base}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: service, authorization: `Bearer ${service}` } });
      if (!response.ok) throw new Error('Synthetic user cleanup failed');
      assert.equal(sql(`select count(*) from auth.users where id='${userId}'`), '0');
      assert.equal(sql(`select count(*) from organizations where id='${org}'`), '0');
      assert.equal(sql(`select count(*) from vault.secrets where name='${secretName}'`), '0');
      assert.equal(sql(`select count(*) from public.record_changes where org_id='${org}'`), '0');
    }
  }, async () => {
    await withCaptureProofCleanup(
      () => server.listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve(),
      () => fs.rmSync(dir, { recursive: true, force: true }),
    );
  });
});
