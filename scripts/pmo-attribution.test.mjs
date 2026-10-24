/**
 * pmo-attribution.test.mjs — `pmo attribution preview|set|end|list` (#1271, AC-CAT-015). Runs against a fake Supabase
 * served by node:http; the rules themselves (validation, ties, versions, roles) are proved by pgTAP
 * (supabase/tests/cost_attribution.test.sql).
 * Mutation check: make setRules ignore `dryRun` (save anyway) — the dry-run tests must go red.
 *
 * Run:  node --test scripts/pmo-attribution.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ATTRIBUTION_READ_RPCS, ATTRIBUTION_WRITE_RPCS, run, writeCredentials } from './pmo.mjs';
import { explainError, formatPreview } from './lib/pmo-attribution.mjs';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const KEY = '33333333-3333-3333-3333-333333333333';
const RULE = { name: 'Salary to anchor', account: 'Salary - RIS', effective_from: '2025-01-01', targets: [{ project_id: P1, percent: 100 }] };
const RULE2 = { name: 'Bonus split', account: 'Bonus - RIS', effective_from: '2025-01-01', targets: [{ project_id: P1, percent: 60 }, { project_id: P2, percent: 40 }] };
const PREVIEW = [
  { project_id: P1, month: '2025-01-01', category: 'Labor', amount: 1000, line_count: 2 },
  { project_id: P1, month: '2025-02-01', category: null, amount: 500.5, line_count: 1 },
];

async function fake(h = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({ method: req.method, path: url.pathname, search: url.search, body: parsed });
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    const answer = h[`${req.method} ${url.pathname}`];
    if (answer === undefined) return send(404, { message: `unexpected ${req.method} ${url.pathname}` });
    const [status, json] = typeof answer === 'function' ? answer(parsed) : answer;
    return send(status, json);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

const rpcCalls = (f) => f.requests.filter((q) => q.path.startsWith('/rest/v1/rpc/')).map((q) => q.path.slice('/rest/v1/rpc/'.length));

async function cli(argv, f, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-attr-'));
  writeCredentials({ PMO_CONFIG_DIR: dir }, f.url, {
    client_id: 'c', access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u', email: 'a@example.test' },
  });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  const args = argv.map((a) => (Object.hasOwn(files, a) ? path.join(dir, a) : a));
  let out = ''; let err = '';
  const code = await run([...args, '--url', f.url], {
    env: { PMO_CONFIG_DIR: dir, PMO_SUPABASE_KEY: 'k' },
    stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) },
    stdin: (async function* () {})(),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  let json = null; try { json = JSON.parse(out); } catch { /* text output */ }
  let error = null; try { error = JSON.parse(err.trim().split('\n').pop()).error; } catch { /* none */ }
  return { code, out, json, error };
}

const PREVIEW_ROUTE = { 'POST /rest/v1/rpc/preview_cost_attribution': [200, PREVIEW] };

test('AC-CAT-015 the CLI tiers match the database guard (latest migration defining api_client_request_guard)', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'migrations');
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).pop();
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const list = (name) => [...sql.match(new RegExp(`(?<![a-z_])${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(list('cost_attribution_write_rpcs'), [...ATTRIBUTION_WRITE_RPCS].sort());
  assert.deepEqual(list('cost_attribution_read_rpcs'), [...ATTRIBUTION_READ_RPCS].sort());
});

test('AC-CAT-015 preview sends each rule to preview_cost_attribution and prints a table with project names', async () => {
  const f = await fake({ ...PREVIEW_ROUTE, 'GET /rest/v1/projects': [200, [{ id: P1, name: 'Anchor' }]] });
  try {
    const r = await cli(['attribution', 'preview', 'rules.json'], f, { 'rules.json': [RULE, RULE2] });
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['preview_cost_attribution', 'preview_cost_attribution']);
    const bodies = f.requests.filter((q) => q.path.endsWith('/preview_cost_attribution')).map((q) => q.body);
    assert.deepEqual(bodies, [{ p_rule: RULE }, { p_rule: RULE2 }]);
    assert.match(r.out, /Rule 1: Salary to anchor/);
    assert.match(r.out, /Anchor\s+2025-01\s+Labor\s+1000\.00\s+2/);
    assert.match(r.out, /not mapped to a budget category/);
    assert.match(r.out, /Total 1500\.50/);
    assert.match(f.requests.find((q) => q.path === '/rest/v1/projects').search, /id=in\./);
  } finally { await f.close(); }
});

test('AC-CAT-015 preview --json returns the rows as JSON', async () => {
  const f = await fake(PREVIEW_ROUTE);
  try {
    const r = await cli(['attribution', 'preview', 'rule.json', '--json'], f, { 'rule.json': RULE });
    assert.equal(r.code, 0);
    assert.deepEqual(r.json, { previews: [{ index: 1, name: 'Salary to anchor', rows: PREVIEW }] });
  } finally { await f.close(); }
});

test('AC-CAT-015 set previews then saves each rule, in order', async () => {
  let n = 0;
  const f = await fake({ ...PREVIEW_ROUTE, 'POST /rest/v1/rpc/save_cost_attribution_rule': () => [200, { rule_key: KEY, version: 1, id: `id-${++n}`, changed: true }] });
  try {
    const r = await cli(['attribution', 'set', 'rules.json'], f, { 'rules.json': [RULE, RULE2] });
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['preview_cost_attribution', 'preview_cost_attribution', 'save_cost_attribution_rule', 'save_cost_attribution_rule']);
    assert.deepEqual(f.requests.filter((q) => q.path.endsWith('/save_cost_attribution_rule')).map((q) => q.body), [{ p_rule: RULE }, { p_rule: RULE2 }]);
    assert.equal(r.json.dry_run, false);
    assert.deepEqual(r.json.results.map((x) => [x.name, x.id, x.total]), [['Salary to anchor', 'id-1', '1500.50'], ['Bonus split', 'id-2', '1500.50']]);
  } finally { await f.close(); }
});

test('AC-CAT-015 set --dry-run previews and never calls save', async () => {
  const f = await fake({ ...PREVIEW_ROUTE, 'POST /rest/v1/rpc/save_cost_attribution_rule': [200, { changed: true }] });
  try {
    const r = await cli(['attribution', 'set', 'rules.json', '--dry-run'], f, { 'rules.json': [RULE, RULE2] });
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(rpcCalls(f), ['preview_cost_attribution', 'preview_cost_attribution']);
    assert.equal(r.json.dry_run, true);
    assert.deepEqual(r.json.results.map((x) => x.action), ['would_save', 'would_save']);
  } finally { await f.close(); }
});

test('AC-CAT-015 set --dry-run of an edit checks expected_version against the list and never saves', async () => {
  const f = await fake({ ...PREVIEW_ROUTE, 'POST /rest/v1/rpc/list_cost_attribution_rules': [200, [{ rule_key: KEY, version: 2 }]],
    'POST /rest/v1/rpc/save_cost_attribution_rule': [200, { changed: true }] });
  try {
    const stale = await cli(['attribution', 'set', 'r.json', '--dry-run'], f, { 'r.json': { ...RULE, rule_key: KEY, expected_version: 1 } });
    assert.equal(stale.code, 1);
    assert.equal(stale.error.code, '40001');
    assert.match(stale.error.message, /^Rule 1: The rule changed since you loaded it.*current version is 2/);
    const ok = await cli(['attribution', 'set', 'r.json', '--dry-run'], f, { 'r.json': { ...RULE, rule_key: KEY, expected_version: 2 } });
    assert.equal(ok.code, 0, JSON.stringify(ok.error));
    assert.equal(rpcCalls(f).includes('save_cost_attribution_rule'), false);
  } finally { await f.close(); }
});

test('AC-CAT-015 a refused preview stops set before any save, with a clear message', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/preview_cost_attribution': [409, { code: '23505', message: 'conflicts with rule "Salary to anchor": same specificity, overlapping dates and matches' }],
    'POST /rest/v1/rpc/save_cost_attribution_rule': [200, {}] });
  try {
    const r = await cli(['attribution', 'set', 'r.json'], f, { 'r.json': RULE });
    assert.equal(r.code, 1);
    assert.equal(r.error.code, '23505');
    assert.match(r.error.message, /^Rule 1: This rule ties another rule.*Narrow it.*conflicts with rule "Salary to anchor"/);
    assert.deepEqual(rpcCalls(f), ['preview_cost_attribution']);
  } finally { await f.close(); }
});

test('AC-CAT-015 a failed save reports which rules were already saved', async () => {
  let n = 0;
  const f = await fake({ ...PREVIEW_ROUTE, 'POST /rest/v1/rpc/save_cost_attribution_rule': () => (++n === 1
    ? [200, { rule_key: KEY, version: 1, id: 'id-1', changed: true }] : [400, { code: '22023', message: 'target percentages total 90, not 100' }]) });
  try {
    const r = await cli(['attribution', 'set', 'rules.json'], f, { 'rules.json': [RULE, RULE2] });
    assert.equal(r.code, 1);
    assert.match(r.error.message, /^Rule 2: The rule is not valid: target percentages total 90/);
    assert.deepEqual(r.error.details.applied.map((a) => a.id), ['id-1']);
  } finally { await f.close(); }
});

test('AC-CAT-015 end sends the rule key, date and expected version', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/end_cost_attribution_rule': [200, { rule_key: KEY, version: 3, id: 'x', changed: true }] });
  try {
    const r = await cli(['attribution', 'end', KEY.toUpperCase(), '--to', '2025-02-28', '--version', '2'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(f.requests.find((q) => q.path.endsWith('/end_cost_attribution_rule')).body,
      { p_rule_key: KEY, p_effective_to: '2025-02-28', p_expected_version: 2 });
    assert.equal(r.json.version, 3);
  } finally { await f.close(); }
});

test('AC-CAT-015 end with bad arguments sends nothing (exit 2)', async () => {
  const f = await fake({});
  try {
    const r = await cli(['attribution', 'end', 'not-a-key', '--to', '28/02/2025'], f);
    assert.equal(r.code, 2);
    assert.equal(r.error.code, 'invalid_attribution');
    assert.equal(r.error.details.length, 3);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('AC-CAT-015 list sends p_include_history, false by default and true with --history', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/list_cost_attribution_rules': [200, [{ rule_key: KEY, version: 1 }]] });
  try {
    assert.equal((await cli(['attribution', 'list'], f)).code, 0);
    assert.equal((await cli(['attribution', 'list', '--history'], f)).code, 0);
    assert.deepEqual(f.requests.map((q) => q.body), [{ p_include_history: false }, { p_include_history: true }]);
  } finally { await f.close(); }
});

test('AC-CAT-015 a refused role gets a plain message', async () => {
  const f = await fake({ 'POST /rest/v1/rpc/list_cost_attribution_rules': [403, { code: '42501', message: 'not authorized' }] });
  try {
    const r = await cli(['attribution', 'list'], f);
    assert.equal(r.code, 1);
    assert.match(r.error.message, /active Admin or Finance member/);
  } finally { await f.close(); }
});

test('AC-CAT-015 file problems refuse before sending (exit 2)', async () => {
  const f = await fake({});
  try {
    const empty = await cli(['attribution', 'preview', 'e.json'], f, { 'e.json': [] });
    assert.equal(empty.code, 2);
    const notObj = await cli(['attribution', 'set', 'n.json'], f, { 'n.json': [RULE, 'x'] });
    assert.equal(notObj.code, 2);
    assert.match(notObj.error.details[0], /rule 2 is not a JSON object/);
    const missing = await cli(['attribution', 'set'], f);
    assert.equal(missing.code, 2);
    const unknown = await cli(['attribution', 'wipe'], f);
    assert.equal(unknown.code, 2);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('AC-CAT-015 explainError maps every documented code and passes others through', () => {
  for (const [code, re] of [['22023', /not valid: bad/], ['P0002', /^Not found: bad/], ['23505', /ties another rule/], ['40001', /changed since you loaded/], ['42501', /Admin or Finance/]]) {
    assert.match(explainError({ code, message: 'bad' }), re);
  }
  assert.equal(explainError({ code: 'XX000', message: 'boom' }), 'boom');
});

test('AC-CAT-015 formatPreview says when a rule matches nothing', () => {
  assert.match(formatPreview([{ index: 1, name: 'R', rows: [] }]), /no ledger lines match/);
});
