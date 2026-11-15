/**
 * pmo-tm.test.mjs — `pmo tm rates|claim` (#1514, AC-TM-017). Runs against a fake Supabase served by node:http; the
 * database decides pricing, roles and the sign-off rules (supabase/tests/tm_*.test.sql).
 * Mutation check: let `claim preview` call `assemble_tm_claim` (a writer) — the read-only test must go red.
 *
 * Run:  node --test scripts/pmo-tm.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run, writeCredentials } from './pmo.mjs';
import { MAX_CLAIM_RANGE_DAYS, TM_READ_RPCS, explainError, formatAssignees, formatClaims, formatPreview, formatRateCard, validateClaimList, validatePreview, validateRatesList } from './lib/pmo-tm.mjs';
import { TM_WRITE_RPCS, explainWriteError, rateRowProblems, planRates } from './lib/pmo-tm-write.mjs';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const LINE_KEY = '33333333-3333-3333-3333-333333333333';
const CLAIM = '44444444-4444-4444-4444-444444444444';
const ENGINEER = '55555555-5555-5555-5555-555555555555';

const PREVIEW_ROWS = [
  {
    line_key: LINE_KEY, rate_version: 1, kind: 'labour', basis: 'work', label: 'Site engineer', unit: 'hour', rate: 50000,
    user_id: null, units: 120, amount: 6000000, source_count: 15, unrated_reason: null,
  },
  {
    line_key: null, rate_version: null, kind: null, basis: 'work', label: '(unassigned)', unit: 'hour', rate: null,
    user_id: ENGINEER, units: 8, amount: null, source_count: 1, unrated_reason: 'no rate line is assigned to this person',
  },
];

const CLAIMS = [
  {
    id: CLAIM, work_order_id: null, period_from: '2026-01-01', period_to: '2026-01-31', status: 'SignedOff',
    currency: 'IDR', gross_amount: 6000000, prepared_by: null, signoff_prepared_by: null, confirmed_by: null,
    confirm_basis: null, document_id: null, note: null, created_at: '2026-02-01T02:03:04.000Z',
    lines: [{ line_key: LINE_KEY, rate_version: 1, kind: 'labour', basis: 'work', label: 'Site engineer', unit: 'hour', units: 120, rate: 50000, amount: 6000000 }],
  },
];

const RATES = [
  {
    project_id: PROJECT, line_key: LINE_KEY, version: 1, is_current: false, kind: 'labour', label: 'Site engineer',
    unit: 'hour', rate: 45000, effective_from: '2025-01-01', effective_to: '2025-12-31', applies_to: null,
  },
  {
    project_id: PROJECT, line_key: LINE_KEY, version: 2, is_current: true, kind: 'labour', label: 'Site engineer',
    unit: 'hour', rate: 50000, effective_from: '2026-01-01', effective_to: null, applies_to: null,
  },
];
const ASSIGNEES = [
  { project_id: PROJECT, line_key: LINE_KEY, user_id: ENGINEER, effective_from: '2026-01-01', effective_to: null },
];

const FINANCE_A = '66666666-6666-6666-6666-666666666666';
const OTHER = '77777777-7777-7777-7777-777777777777';
const DOCUMENT = '88888888-8888-8888-8888-888888888888';
const SOURCE = '99999999-9999-9999-9999-999999999999';
const NEW_CLAIM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DRAFT = { ...CLAIMS[0], status: 'Draft', prepared_by: FINANCE_A, signoff_prepared_by: FINANCE_A, document_id: DOCUMENT };
const SOURCES = [{
  id: SOURCE, entry_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', entry_date: '2026-01-05', person_id: ENGINEER, person_name: 'Siti Engineer',
  asset_id: null, asset_name: null, basis: 'work', units: 8, unit: 'hour', line_label: 'Site engineer', is_selected: true,
  person_unit_total: 8, total_count: 1, signoff_is_current: true,
}];
const DOC = { id: DOCUMENT, project_id: PROJECT, title: 'January hours', revision: 'A', status: 'Issued', file_path: 'org/p/d/jan.pdf' };
const RATE_ROW = { project_id: PROJECT, kind: 'labour', label: 'Surveyor', unit: 'hour', rate: 60000, currency: 'IDR', effective_from: '2026-01-01' };
const ASSIGN_ROW = { project_id: PROJECT, line_key: LINE_KEY, user_id: OTHER, effective_from: '2027-01-01' };

/** The signed-in user (readMe) plus the profile reads a command makes (names, member status). */
function signedIn(role, { id = FINANCE_A, status = 'active', people = [] } = {}) {
  return {
    'GET /auth/v1/user': [200, { id, email: 'a@example.test' }],
    'GET /rest/v1/profiles': (_body, url) => (url.searchParams.get('select') === 'full_name,role,status'
      ? [200, [{ full_name: 'Signed In', role, status }]]
      : [200, people]),
  };
}
/** Every read a write command's plan makes, answered with the fixtures above. */
const READS = () => ({
  ...signedIn('Finance', { people: [{ id: ENGINEER, full_name: 'Siti Engineer', status: 'active' }, { id: OTHER, full_name: 'Other Person', status: 'active' }] }),
  'GET /rest/v1/projects': [200, [{ id: PROJECT, currency: 'IDR' }]],
  'GET /rest/v1/contract_rate_lines': [200, RATES],
  'GET /rest/v1/contract_rate_assignees': [200, ASSIGNEES],
  'GET /rest/v1/project_documents': [200, [DOC]],
  'POST /rest/v1/rpc/preview_tm_claim': [200, PREVIEW_ROWS],
  'POST /rest/v1/rpc/list_tm_claims': [200, [DRAFT]],
  'POST /rest/v1/rpc/list_tm_claim_source_details': [200, SOURCES],
});

async function fake(handlers = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, 'http://localhost');
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({ method: req.method, path: url.pathname, search: url.search, body: parsed });
    const send = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    const answer = handlers[`${req.method} ${url.pathname}`];
    if (answer === undefined) return send(404, { message: `unexpected ${req.method} ${url.pathname}` });
    if (answer === 'drop') return req.socket.destroy();
    const [status, json] = typeof answer === 'function' ? answer(parsed, url) : answer;
    return send(status, json);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const rpcCalls = (server) => server.requests
  .filter((request) => request.path.startsWith('/rest/v1/rpc/'))
  .map((request) => request.path.slice('/rest/v1/rpc/'.length));
/** Every RPC a request reached that is not one of the three admitted reads: i.e. every write that arrived. */
const writesSent = (server) => rpcCalls(server).filter((name) => !TM_READ_RPCS.includes(name));
function jsonFile(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-tm-file-'));
  const file = path.join(dir, 'rows.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

async function cli(argv, server) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-tm-'));
  writeCredentials({ PMO_CONFIG_DIR: dir }, server.url, {
    client_id: 'c', access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u', email: 'a@example.test' },
  });
  let out = ''; let err = '';
  const code = await run([...argv, '--url', server.url], {
    env: { PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: 'k' },
    stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) },
    stdin: (async function* () {})(),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  let json = null; try { json = JSON.parse(out); } catch { /* text output */ }
  let error = null; try { error = JSON.parse(err.trim().split('\n').pop()).error; } catch { /* none */ }
  return { code, out, json, error };
}

/** One list from the LATEST migration that defines public.api_client_request_guard() — the shipped tiers, not ours. */
function guardList(name) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).pop();
  assert.ok(latest, 'a migration defines public.api_client_request_guard()');
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const match = sql.match(new RegExp(`(?<![a-z_])${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`));
  assert.ok(match, `${latest} declares ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

test('AC-TM-017 the CLI reads are exactly the database T&M read tier (latest api_client_request_guard)', () => {
  assert.deepEqual([...TM_READ_RPCS].sort(), guardList('tm_read_rpcs'));
  assert.deepEqual([...TM_READ_RPCS].sort(), ['list_tm_claim_source_details', 'list_tm_claims', 'preview_tm_claim']);
});

test('AC-TM-017 standby basis is visible in preview and frozen claim output', () => {
  const standby = { label: 'Excavator', basis: 'standby', unit: 'hour', units: 6, rate: 200000, amount: 1200000, source_count: 1 };
  assert.match(formatPreview({ lines: [standby], total: '1200000.00' }), /Excavator \(standby\)/);
  assert.match(formatClaims([{ ...CLAIMS[0], lines: [standby] }]), /Excavator \(standby\)/);
  const unbilled = formatPreview({ lines: [], unrated: [{ ...standby, rate: null, amount: null, user_id: null, unrated_reason: 'no_standby_rate' }] });
  assert.match(unbilled, /Excavator \(standby\).*no_standby_rate/);
  const crane = formatPreview({ lines: [], unrated: [{ ...standby, label: null, basis: 'work', unit: null, rate: null, amount: null, user_id: null, asset_name: 'Crane A', unrated_reason: 'no_rate' }] });
  assert.match(crane, /Crane A.*no_rate/, 'an unrated equipment source names its machine');
  assert.doesNotMatch(unbilled, /no person/);
});

test('AC-TM-017 equipment rate-card output identifies the asset and optional standby price', () => {
  const output = formatRateCard({ rates: [{
    project_id: PROJECT, line_key: 'equipment-line', version: 1, is_current: true, kind: 'equipment',
    asset_id: 'asset-2', label: 'Excavator', unit: 'hour', rate: 800000, standby_rate: 200000, effective_from: '2026-01-01',
  }] });
  assert.match(output, /Excavator · equipment · hour · 800000\.00 · asset asset-2 · standby 200000\.00/);
});

test('AC-TM-017 tm claim preview sends preview_tm_claim with the project and window', async () => {
  // No profile row for the engineer: an id the directory read cannot resolve keeps its raw value.
  const f = await fake({
    'POST /rest/v1/rpc/preview_tm_claim': [200, PREVIEW_ROWS],
    'GET /rest/v1/profiles': [200, []],
  });
  try {
    const r = await cli(['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-01-01', '--to', '2026-01-31'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['preview_tm_claim']);
    assert.deepEqual(f.requests[0].body, { p_project: PROJECT, p_from: '2026-01-01', p_to: '2026-01-31' });
    assert.match(r.out, /Site engineer\s+hour\s+120\.00\s+50000\.00\s+6000000\.00/);
    assert.match(r.out, /Total 6000000\.00/);
    assert.match(r.out, /Unrated \(listed, not billed\)/);
    assert.match(r.out, /unassigned/);
    assert.match(r.out, /no rate line is assigned to this person/);
    assert.match(r.out, new RegExp(ENGINEER));
    assert.ok(r.out.indexOf('Unrated') < r.out.indexOf('Total'), 'the total follows the unrated block, as the runbook says');
  } finally { await f.close(); }
});

test('AC-TM-017 a preview where every hour is unrated still prints Total 0.00', async () => {
  const f = await fake({
    'POST /rest/v1/rpc/preview_tm_claim': [200, [PREVIEW_ROWS[1]]],
    'GET /rest/v1/profiles': [200, []],
  });
  try {
    const r = await cli(['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-01-01', '--to', '2026-01-31'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.match(r.out, /Unrated \(listed, not billed\)/);
    assert.match(r.out, /Total 0\.00/, 'nothing is billable reads as a total of zero, not as a preview that stopped early');
  } finally { await f.close(); }
});

test('AC-TM-017 the preview names the unrated person with one read for the ids it prints', async () => {
  const f = await fake({
    'POST /rest/v1/rpc/preview_tm_claim': [200, PREVIEW_ROWS],
    'GET /rest/v1/profiles': [200, [{ id: ENGINEER, full_name: 'Siti Engineer' }]],
  });
  try {
    const r = await cli(['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-01-01', '--to', '2026-01-31'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    const reads = f.requests.filter((q) => q.path === '/rest/v1/profiles');
    assert.equal(reads.length, 1, 'one read for the whole preview');
    assert.equal(reads[0].method, 'GET');
    const search = new URLSearchParams(reads[0].search);
    assert.equal(search.get('select'), 'id,full_name');
    assert.equal(search.get('id'), `in.(${ENGINEER})`);
    assert.match(r.out, /Siti Engineer/);
    assert.equal(r.out.includes(ENGINEER), false, 'the id gives way to the name when the name resolves');
  } finally { await f.close(); }
});

test('AC-TM-017 tm claim preview --json returns the priced lines, the unrated rows and the total', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/preview_tm_claim': [200, PREVIEW_ROWS] });
  try {
    const r = await cli(['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-01-01', '--to', '2026-01-31', '--json'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { lines: [PREVIEW_ROWS[0]], unrated: [PREVIEW_ROWS[1]], total: '6000000.00' });
    assert.deepEqual(f.requests.map((q) => q.path), ['/rest/v1/rpc/preview_tm_claim'], 'the rows are the database\'s: --json reads no names');
  } finally { await f.close(); }
});

test('AC-TM-017 tm claim preview is read-only: it never calls a writer', async () => {
  const writers = guardList('tm_write_rpcs');
  assert.ok(writers.length > 0, 'the guard declares the T&M writers');
  const f = await fake({
    'POST /rest/v1/rpc/preview_tm_claim': [200, PREVIEW_ROWS],
    'GET /rest/v1/profiles': [200, []],
  });
  try {
    const r = await cli(['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-01-01', '--to', '2026-01-31'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['preview_tm_claim']);
    assert.deepEqual(f.requests.filter((q) => q.method !== 'GET').map((q) => q.path), ['/rest/v1/rpc/preview_tm_claim'], 'the only POST is the read RPC');
    for (const request of f.requests) {
      assert.ok(['GET', 'POST'].includes(request.method), `${request.method} is not a read`);
      for (const writer of writers) assert.equal(request.path.includes(writer), false, `${writer} is a writer`);
    }
  } finally { await f.close(); }
});

test('AC-TM-017 tm claim list sends list_tm_claims with the project and prints frozen claim lines', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/list_tm_claims': [200, CLAIMS] });
  try {
    const r = await cli(['tm', 'claim', 'list', '--project', PROJECT], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['list_tm_claims']);
    assert.deepEqual(f.requests[0].body, { p_project: PROJECT });
    assert.match(r.out, new RegExp(CLAIM));
    assert.match(r.out, /2026-01-01 → 2026-01-31/);
    assert.match(r.out, /SignedOff/);
    assert.match(r.out, /IDR 6000000\.00/);
    assert.match(r.out, /Site engineer\s+120\.00\s+hour\s+×\s+50000\.00\s+=\s+6000000\.00/);
  } finally { await f.close(); }
});

test('AC-TM-017 tm claim list --json returns the {claims} wrapper, as the runbook documents', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/list_tm_claims': [200, CLAIMS] });
  try {
    const r = await cli(['tm', 'claim', 'list', '--project', PROJECT, '--json'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { claims: CLAIMS });
  } finally { await f.close(); }
});

test('AC-TM-017 tm rates list --project reads the rate card with a bounded, ordered GET', async () => {
  const f = await fake({ 'GET /rest/v1/contract_rate_lines': [200, RATES] });
  try {
    const r = await cli(['tm', 'rates', 'list', '--project', PROJECT], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(f.requests.map((q) => [q.method, q.path]), [['GET', '/rest/v1/contract_rate_lines']]);
    const search = new URLSearchParams(f.requests[0].search);
    assert.equal(search.get('project_id'), `eq.${PROJECT}`);
    assert.equal(search.get('select'), 'project_id,line_key,version,is_current,kind,asset_id,label,unit,rate,standby_rate,effective_from,effective_to,applies_to');
    assert.match(search.get('order'), /label|project_id/);
    assert.equal(search.get('limit'), '1000');
    assert.match(r.out, /Site engineer/);
    assert.match(r.out, /50000\.00/);
    assert.match(r.out, /2026-01-01/);
    assert.match(r.out, /ended 2025-12-31/);
    assert.match(r.out, /2 rate lines/);
  } finally { await f.close(); }
});

test('AC-TM-017 tm rates list without --project reads the whole visible card', async () => {
  const f = await fake({ 'GET /rest/v1/contract_rate_lines': [200, RATES] });
  try {
    const r = await cli(['tm', 'rates', 'list', '--json'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(new URLSearchParams(f.requests[0].search).get('project_id'), null);
    assert.deepEqual(r.json, { rates: RATES, assignees: [] });
  } finally { await f.close(); }
});

test('AC-TM-017 tm rates list --assignees reads who holds each line, and no writer is ever called', async () => {
  const writers = guardList('tm_write_rpcs');
  const f = await fake({
    'GET /rest/v1/contract_rate_lines': [200, RATES],
    'GET /rest/v1/contract_rate_assignees': [200, ASSIGNEES],
    'GET /rest/v1/profiles': [200, []],
  });
  try {
    const r = await cli(['tm', 'rates', 'list', '--project', PROJECT, '--assignees'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(f.requests.slice(0, 2).map((q) => q.path), ['/rest/v1/contract_rate_lines', '/rest/v1/contract_rate_assignees']);
    assert.equal(new URLSearchParams(f.requests[1].search).get('project_id'), `eq.${PROJECT}`);
    assert.match(r.out, new RegExp(ENGINEER));
    assert.equal(r.out.match(new RegExp(ENGINEER, 'g')).length, 1, 'the holder prints once, on the newest version');
    assert.match(formatAssignees(ASSIGNEES), new RegExp(`^  ${ENGINEER}`));
    for (const request of f.requests) for (const writer of writers) assert.equal(request.path.includes(writer), false);
  } finally { await f.close(); }
});

test('AC-TM-017 tm rates list --assignees prints the holder by name, one read for the ids it prints', async () => {
  const f = await fake({
    'GET /rest/v1/contract_rate_lines': [200, RATES],
    'GET /rest/v1/contract_rate_assignees': [200, ASSIGNEES],
    'GET /rest/v1/profiles': [200, [{ id: ENGINEER, full_name: 'Siti Engineer' }]],
  });
  try {
    const r = await cli(['tm', 'rates', 'list', '--project', PROJECT, '--assignees'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    const reads = f.requests.filter((q) => q.path === '/rest/v1/profiles');
    assert.equal(reads.length, 1);
    assert.equal(new URLSearchParams(reads[0].search).get('id'), `in.(${ENGINEER})`);
    assert.match(r.out, new RegExp('Siti Engineer\\s+from 2026-01-01'));
    assert.equal(r.out.includes(ENGINEER), false, 'the id gives way to the name when the name resolves');
    assert.match(formatAssignees(ASSIGNEES, new Map([[ENGINEER, 'Siti Engineer']])), /^ {2}Siti Engineer {2}from 2026-01-01$/);
  } finally { await f.close(); }
});

test('AC-TM-017 a refused rate read exits non-zero with the server\'s message', async () => {
  const f = await fake({
    'GET /rest/v1/contract_rate_lines': [403, { code: '42501', message: 'GET /contract_rate_lines is not available to OAuth API clients' }],
  });
  try {
    const r = await cli(['tm', 'rates', 'list'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, '42501');
    assert.match(r.error.message, /Not allowed: /);
    assert.match(r.error.message, /not available to OAuth API clients/);
  } finally { await f.close(); }
});

test('AC-TM-017 a project with no claims says so', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/list_tm_claims': [200, []] });
  try {
    const r = await cli(['tm', 'claim', 'list', '--project', PROJECT], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.match(r.out, /no time-and-materials claims for this project/);
  } finally { await f.close(); }
});

test('AC-TM-017 a server refusal exits non-zero with the database\'s own message', async () => {
  const f = await fake({
    'POST /rest/v1/rpc/preview_tm_claim': [403, { code: '42501', message: 'not authorized to read time-and-materials claims for this project' }],
  });
  try {
    const r = await cli(['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-01-01', '--to', '2026-01-31'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, '42501');
    assert.match(r.error.message, /^Not allowed: /);
    assert.match(r.error.message, /not authorized to read time-and-materials claims/);
  } finally { await f.close(); }
});

test('AC-TM-017 a bad query is refused before any request (exit 2)', async () => {
  const f = await fake({});
  try {
    const cases = [
      ['tm', 'claim', 'preview', '--from', '2026-01-01', '--to', '2026-01-31'],
      ['tm', 'claim', 'preview', '--project', 'not-a-uuid', '--from', '2026-01-01', '--to', '2026-01-31'],
      ['tm', 'claim', 'preview', '--project', PROJECT, '--from', '01/01/2026', '--to', '2026-01-31'],
      ['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2026-02-01', '--to', '2026-01-31'],
      ['tm', 'claim', 'preview', '--project', PROJECT, '--from', '2024-01-01', '--to', '2026-01-02'],
      ['tm', 'claim', 'list'],
      ['tm', 'claim', 'list', '--project', 'z2222222-2222-2222-2222-222222222222'],
      ['tm', 'rates', 'list', '--project', 'z2222222-2222-2222-2222-222222222222'],
    ];
    for (const argv of cases) {
      const r = await cli(argv, f);
      assert.equal(r.code, 2, `${argv.join(' ')} → ${r.out}${JSON.stringify(r.error)}`);
      assert.equal(r.error.code, 'invalid_tm_query', `${argv.join(' ')} → ${JSON.stringify(r.error)}`);
      assert.ok(r.error.details.length >= 1);
    }
    for (const argv of [['tm', 'wipe'], ['tm', 'rates', 'delete'], ['tm', 'claim', 'approve']]) {
      const r = await cli(argv, f);
      assert.equal(r.code, 2, `${argv.join(' ')} → ${r.out}${JSON.stringify(r.error)}`);
      assert.match(r.error.message, /Unknown tm command/);
    }
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('AC-TM-017 validatePreview bounds the window and names every problem', () => {
  assert.deepEqual(validatePreview({ project: PROJECT.toUpperCase(), from: '2026-01-01', to: '2026-01-31' }),
    { p_project: PROJECT, p_from: '2026-01-01', p_to: '2026-01-31' });
  assert.deepEqual(validateClaimList({ project: PROJECT }), { p_project: PROJECT });
  assert.equal(MAX_CLAIM_RANGE_DAYS, 731);
  const many = (() => { try { validatePreview({ project: 'x', from: '2025-02-30', to: 'nope' }); } catch (e) { return e.problems; } })();
  assert.equal(many.length, 3);
});

test('AC-TM-017 validateRatesList takes an optional project and refuses a malformed one', () => {
  assert.deepEqual(validateRatesList({ project: PROJECT.toUpperCase() }), { project_id: PROJECT });
  assert.deepEqual(validateRatesList({}), { project_id: null });
  assert.deepEqual(validateRatesList({ project: '  ' }), { project_id: null });
  assert.throws(() => validateRatesList({ project: 'anchor' }), /--project must be a project id/);
});

test('AC-TM-017 explainError maps every documented code and passes others through', () => {
  for (const [code, re] of [
    ['42501', /Not allowed: .*Admin, Finance, Executive or the project's Project Manager/],
    ['22023', /not valid: a valid date range is required/],
    ['P0002', /^Not found: project not found/],
  ]) assert.match(explainError({ code, message: code === '42501' ? 'x' : code === '22023' ? 'a valid date range is required' : 'project not found' }), re);
  assert.equal(explainError({ code: 'XX000', message: 'boom' }), 'boom');
});

test('AC-TM-017 formatPreview and formatClaims say when there is nothing to show', () => {
  assert.match(formatPreview([]), /no approved sources to price in this window/);
  assert.match(formatClaims([]), /no time-and-materials claims for this project/);
});

test('AC-TM-017 formatPreview totals an unpriced window and falls back to the id it cannot name', () => {
  const only = { lines: [], unrated: [PREVIEW_ROWS[1]], total: '0.00' };
  const named = formatPreview(only, new Map([[ENGINEER, 'Siti Engineer']]));
  assert.match(named, /Siti Engineer\s+no rate line is assigned to this person/);
  assert.match(named, /Total 0\.00/);
  assert.match(formatPreview(only), new RegExp(`^Unrated \\(listed, not billed\\):\\n  .*${ENGINEER}`, 'm'));
});

test('AC-CTM-016 the CLI T&M writer list is exactly the database tm_write_rpcs tier (latest api_client_request_guard)', () => {
  assert.deepEqual([...TM_WRITE_RPCS].sort(), guardList('tm_write_rpcs'));
});

test('AC-CTM-010 explainWriteError gives each refusal code a headline and keeps the server\'s words', () => {
  for (const [code, head] of [
    ['42501', /^Not allowed \(role or separation of duties\): server says no$/],
    ['22023', /^Invalid input: server says no$/],
    ['23505', /^Conflicts with an existing record: server says no$/],
    ['23514', /^Does not match the project or its document: server says no$/],
    ['40001', /^Changed since it was read: re-read with `pmo tm rates list` and run again: server says no$/],
    ['55000', /^Not ready to proceed: server says no$/],
    ['P0001', /^Refused in the claim's current state: server says no$/],
    ['P0002', /^Not found: server says no$/],
  ]) assert.match(explainWriteError({ code, message: 'server says no' }), head);
  assert.equal(explainWriteError({ code: 'XX000', message: 'boom' }), 'boom');
});

test('AC-CTM-004 rateRowProblems refuses a malformed rate line and names each problem', () => {
  assert.deepEqual(rateRowProblems(RATE_ROW), []);
  assert.deepEqual(rateRowProblems({ ...RATE_ROW, line_key: LINE_KEY, expected_version: 2 }), []);
  for (const [row, re] of [
    [{ ...RATE_ROW, rate: 1.234 }, /at most 2 decimals/],
    [{ ...RATE_ROW, rate: -1 }, /zero or more/],
    [{ ...RATE_ROW, rate: '60000' }, /rate must be a number/],
    [{ ...RATE_ROW, currency: 'idr' }, /three-letter code/],
    [{ ...RATE_ROW, org_id: PROJECT }, /"org_id" is not a rate-line field/],
    [{ ...RATE_ROW, label: '  ' }, /label is required/],
    [{ ...RATE_ROW, unit: 'week' }, /unit must be hour or day/],
    [{ ...RATE_ROW, effective_from: '2026-02-30' }, /effective_from must be a date/],
    [{ ...RATE_ROW, effective_to: '2025-12-31' }, /on or after effective_from/],
    [{ ...RATE_ROW, line_key: LINE_KEY }, /both line_key and expected_version/],
    [{ ...RATE_ROW, standby_rate: 10 }, /only for equipment lines/],
    [{ ...RATE_ROW, kind: 'equipment' }, /asset_id \(uuid\) is required/],
    [{ ...RATE_ROW, sales_item_code: 'a\nb' }, /no control characters/],
  ]) assert.match(rateRowProblems(row).join('; '), re, JSON.stringify(row));
  assert.deepEqual(rateRowProblems('x'), ['each rate line must be a JSON object']);
});

const stubApi = ({ card = RATES, currency = 'IDR', rpc } = {}) => ({
  get: async (table) => (table === 'contract_rate_lines' ? card : table === 'projects' ? [{ id: PROJECT, currency }] : []),
  rpc: rpc ?? (async (name) => { throw new Error(`unexpected rpc ${name}`); }),
});

test('AC-CTM-004 planRates classifies each row: create, new version, unchanged or refused', async () => {
  const current = RATES[1];
  const edit = { project_id: PROJECT, line_key: LINE_KEY, expected_version: 2, kind: 'labour', label: 'Site engineer', unit: 'hour', currency: 'IDR' };
  const plan = await planRates(stubApi(), [
    RATE_ROW,
    { ...edit, rate: 55000, effective_from: '2026-07-01' },
    { ...edit, rate: current.rate, effective_from: current.effective_from },
    { ...edit, expected_version: 1, rate: 55000, effective_from: '2026-07-01' },
    { ...RATE_ROW, label: 'site ENGINEER ' },
    { ...RATE_ROW, currency: 'USD', label: 'Driver' },
    { ...edit, line_key: OTHER, rate: 1, effective_from: '2026-07-01' },
  ]);
  assert.deepEqual(plan.map((row) => row.action), ['create', 'new version', 'unchanged', 'refused', 'refused', 'refused', 'refused']);
  assert.match(plan[0].line_key, UUID_RE);
  assert.match(plan[3].problems.join(), /version 2, the file expects 1/);
  assert.match(plan[4].problems.join(), /already has a current labour line labelled "site ENGINEER"/);
  assert.match(plan[5].problems.join(), /not the project's currency \(IDR\)/);
  assert.match(plan[6].problems.join(), /no current rate line has this line_key/);
});

test('AC-CTM-004 two new labour lines with the same label in one file: the second is refused', async () => {
  const plan = await planRates(stubApi(), [RATE_ROW, { ...RATE_ROW, label: 'surveyor' }]);
  assert.deepEqual(plan.map((row) => row.action), ['create', 'refused']);
});

test('NFR-CTM-003 a card read that hits the bound is refused, never planned from', async () => {
  const card = Array.from({ length: 1001 }, (_, i) => ({ ...RATES[1], line_key: `${i}`, label: `L${i}` }));
  await assert.rejects(planRates(stubApi({ card }), [RATE_ROW]), /more than 1000 current rate lines/);
});

test('AC-CTM-004 a rates file with a refused row sends nothing, with or without --apply', async () => {
  const f = await fake(READS());
  try {
    const file = jsonFile([RATE_ROW, { ...RATE_ROW, label: 'A', currency: 'USD' }, { ...RATE_ROW, label: 'B', rate: 1.234 }, { ...RATE_ROW, label: 'C', rate: -1 }, { ...RATE_ROW, label: 'site engineer' }]);
    for (const extra of [[], ['--apply']]) {
      const r = await cli(['tm', 'rates', 'set', file, ...extra], f);
      assert.equal(r.code, 2, r.out);
      assert.deepEqual(r.json.rows.map((row) => row.action), ['create', 'refused', 'refused', 'refused', 'refused']);
      assert.match(r.json.note, /Nothing was sent: 4 row\(s\) refused/);
    }
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-005 a created line prints its minted line_key; rerunning the file refuses it as a duplicate label without a write', async () => {
  const card = [...RATES];
  const f = await fake({
    ...READS(),
    'GET /rest/v1/contract_rate_lines': () => [200, card],
    'POST /rest/v1/rpc/save_contract_rate_line': (body) => {
      for (const line of body.p_line) card.push({ ...line, version: 1, is_current: true });
      return [200, body.p_line.map((line) => ({ id: line.line_key, line_key: line.line_key, version: 1, changed: true }))];
    },
  });
  try {
    const file = jsonFile([RATE_ROW]);
    const first = await cli(['tm', 'rates', 'set', file, '--apply'], f);
    assert.equal(first.code, 0, JSON.stringify(first.error));
    assert.match(first.json.saved[0].line_key, UUID_RE);
    assert.equal(first.json.current[0].label, 'Surveyor');
    const second = await cli(['tm', 'rates', 'set', file, '--apply'], f);
    assert.equal(second.code, 2);
    assert.match(second.json.rows[0].problems.join(), /already has a current labour line labelled "Surveyor"/);
    assert.deepEqual(writesSent(f), ['save_contract_rate_line'], 'one write, from the first run only');
  } finally { await f.close(); }
});

test('AC-CTM-006 a three-row file is one call; the server refusing it is reported, exit 1', async () => {
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/save_contract_rate_line': [409, { code: '23505', message: 'a new rate version cannot rewrite an already applied effective window' }],
  });
  try {
    const r = await cli(['tm', 'rates', 'set', jsonFile([RATE_ROW, { ...RATE_ROW, label: 'Driver' }, { ...RATE_ROW, label: 'Welder' }]), '--apply'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, '23505');
    assert.equal(r.error.message, 'Conflicts with an existing record: a new rate version cannot rewrite an already applied effective window');
    const saves = f.requests.filter((q) => q.path === '/rest/v1/rpc/save_contract_rate_line');
    assert.equal(saves.length, 1);
    assert.equal(saves[0].body.p_line.length, 3);
  } finally { await f.close(); }
});

test('AC-CTM-007 assign set: an identical row is skipped, an overlap is refused in the server\'s words, a new row is created', async () => {
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/set_contract_rate_assignee': (body) => (body.p_user === ENGINEER
      ? [409, { code: '23505', message: 'person already has a labour line over those dates' }]
      : [200, 'cccccccc-cccc-cccc-cccc-cccccccccccc']),
  });
  try {
    const rows = [
      { project_id: PROJECT, line_key: LINE_KEY, user_id: ENGINEER, effective_from: '2026-01-01' },
      { project_id: PROJECT, line_key: LINE_KEY, user_id: ENGINEER, effective_from: '2026-06-01', effective_to: '2026-06-30' },
      { project_id: PROJECT, line_key: LINE_KEY, user_id: OTHER, effective_from: '2026-01-01' },
    ];
    const preview = await cli(['tm', 'assign', 'set', jsonFile(rows)], f);
    assert.equal(preview.code, 0, JSON.stringify(preview.error));
    assert.deepEqual(preview.json.rows.map((row) => row.action), ['skip', 'create', 'create']);
    assert.match(preview.json.rows[1].warnings.join(), /overlaps this person's assignment from 2026-01-01/);
    assert.deepEqual(writesSent(f), []);
    const r = await cli(['tm', 'assign', 'set', jsonFile(rows), '--apply'], f);
    assert.equal(r.code, 1);
    assert.deepEqual(r.json.rows.map((row) => row.action), ['skip', 'refused', 'created']);
    assert.equal(r.json.rows[1].problems[0], 'Conflicts with an existing record: person already has a labour line over those dates');
    assert.equal(r.json.rows[2].assignment_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
    const sent = f.requests.filter((q) => q.path === '/rest/v1/rpc/set_contract_rate_assignee').map((q) => q.body);
    assert.deepEqual(sent, [
      { p_project: PROJECT, p_line_key: LINE_KEY, p_user: ENGINEER, p_from: '2026-06-01', p_to: '2026-06-30' },
      { p_project: PROJECT, p_line_key: LINE_KEY, p_user: OTHER, p_from: '2026-01-01', p_to: null },
    ]);
  } finally { await f.close(); }
});

test('AC-CTM-007 a malformed assignment row is refused locally and never sent', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'assign', 'set', jsonFile([{ ...ASSIGN_ROW, user_id: 'nobody' }]), '--apply'], f);
    assert.equal(r.code, 1);
    assert.match(r.json.rows[0].problems.join(), /user_id must be a person id/);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-008 an overlapping Draft claim for the same project and work order is reported already_assembled; no writer is called', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'claim', 'assemble', '--project', PROJECT, '--from', '2026-01-10', '--to', '2026-01-20', '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.status, 'already_assembled');
    assert.equal(r.json.claim.id, CLAIM);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-009 an assembled total that differs from the preview prints both with a warning', async () => {
  let listed = 0;
  const f = await fake({
    ...READS(),
    'POST /rest/v1/rpc/list_tm_claims': () => (listed++ === 0
      ? [200, []]
      : [200, [{ ...DRAFT, id: NEW_CLAIM, period_from: '2026-02-01', period_to: '2026-02-28', gross_amount: 6400000 }]]),
    'POST /rest/v1/rpc/assemble_tm_claim': [200, NEW_CLAIM],
  });
  try {
    const r = await cli(['tm', 'claim', 'assemble', '--project', PROJECT, '--from', '2026-02-01', '--to', '2026-02-28', '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.claim_id, NEW_CLAIM);
    assert.deepEqual(r.json.warning.total_changed, { preview: '6000000.00', assembled: '6400000.00' });
    assert.deepEqual(f.requests.find((q) => q.path === '/rest/v1/rpc/assemble_tm_claim').body, { p_project: PROJECT, p_from: '2026-02-01', p_to: '2026-02-28' });
  } finally { await f.close(); }
});

test('FR-CTM-023 claim sources lists each source, whether it is still in the claim, and whether the sign-off is current', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'claim', 'sources', CLAIM], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['list_tm_claim_source_details']);
    assert.deepEqual(f.requests.find((q) => q.path.includes('/rpc/')).body, { p_claim: CLAIM });
    assert.equal(r.json.signoff_is_current, true);
    assert.deepEqual(r.json.sources, [{ source_id: SOURCE, date: '2026-01-05', who: 'Siti Engineer', units: 8, unit: 'hour', line: 'Site engineer', basis: 'work', in_claim: true }]);
  } finally { await f.close(); }
});

test('FR-CTM-024 claim deselect removes each named source once, skips one already out, then prints the new total', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/deselect_tm_source': [200, null] });
  try {
    const gone = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const r = await cli(['tm', 'claim', 'deselect', CLAIM, SOURCE, gone, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json.sources.map((s) => s.action), ['deselect', 'skip']);
    assert.deepEqual(f.requests.filter((q) => q.path === '/rest/v1/rpc/deselect_tm_source').map((q) => q.body), [{ p_claim: CLAIM, p_source: SOURCE }]);
    assert.equal(r.json.claim.gross_amount, 6000000);
  } finally { await f.close(); }
});

test('D3 a claim command refuses a claim that is not on the named project, before any write', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/list_tm_claims': [200, []] });
  try {
    const r = await cli(['tm', 'claim', 'deselect', CLAIM, SOURCE, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 2);
    assert.match(r.error.details.join(), /no claim .* on project/);
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('AC-CTM-014 withdrawing a claim that is already withdrawn reports already_withdrawn and sends nothing', async () => {
  const f = await fake({ ...READS(), 'POST /rest/v1/rpc/list_tm_claims': [200, [{ ...DRAFT, status: 'Withdrawn' }]] });
  try {
    const r = await cli(['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT, '--apply'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(r.json, { status: 'already_withdrawn', claim_id: CLAIM });
    assert.deepEqual(writesSent(f), []);
  } finally { await f.close(); }
});

test('FR-CTM-025 the withdraw preview shows the status and what it releases', async () => {
  const f = await fake(READS());
  try {
    const r = await cli(['tm', 'claim', 'withdraw', CLAIM, '--project', PROJECT], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.claim.status, 'Draft');
    assert.match(r.json.releases, /^1 source\(s\) become claimable again/);
  } finally { await f.close(); }
});
