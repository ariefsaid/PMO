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
    const [status, json] = typeof answer === 'function' ? answer(parsed) : answer;
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
    for (const argv of [['tm', 'claim', 'assemble', '--project', PROJECT], ['tm', 'rates', 'set'], ['tm', 'wipe']]) {
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
