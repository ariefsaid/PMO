/**
 * pmo-ops.test.mjs — `pmo budgets activate` and `pmo accounts map set` (#1270 B, AC-CLI-B1/B2).
 * Runs against a fake Supabase served by node:http; the database rules themselves are proved by pgTAP
 * (supabase/tests/budget_cli_ops_writes.test.sql, budget_second_activator.test.sql, budget_category_account_map_rls.test.sql).
 *
 * Run:  node --test scripts/pmo-ops.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run, writeCredentials } from './pmo.mjs';
import { ACTIVATION_ENABLED, ActivationRefused, activateBudget, validateSource } from './lib/pmo-budgets.mjs';
import { BUDGET_CATEGORIES, isDirectCostPostingAccount, planMapSet } from './lib/pmo-accounts.mjs';

const V = '11111111-2222-3333-4444-555555555555';
const SOURCE = { drive_id: 'd1', item_id: 'i1', web_url: 'https://example.sharepoint.com/sbp.xlsx', name: 'SBP.xlsx', kind: 'file' };

const acct = (account, extra = {}) => ({ account, accountName: account, accountNumber: null, parentAccount: 'Direct Costs - X', rootType: 'Expense', isGroup: false, disabled: false, ...extra });
const CHART = [
  acct('5110 - Salary'), acct('5120 - Allowance'), acct('5130 - Materials'),
  acct('6100 - Office', { parentAccount: 'Overheads - X' }),
  acct('5000 - Direct Costs', { isGroup: true }), acct('5199 - Old', { disabled: true }), acct('1100 - Cash', { rootType: 'Asset' }),
];

/** A fake that records calls; `h` answers route keys "METHOD /path" with [status, json] or a function(body). */
async function fake(h = {}, { role = 'Admin' } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, search: url.search, body: body ? JSON.parse(body) : undefined });
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(json === undefined ? '' : JSON.stringify(json)); };
    if (url.pathname === '/auth/v1/user') return send(200, { id: 'user-1', email: 'a@example.test' });
    if (url.pathname === '/rest/v1/profiles') return send(200, [{ full_name: 'A', role, status: 'active' }]);
    const key = `${req.method} ${url.pathname}`;
    const answer = h[key];
    if (answer === undefined) return send(404, { message: `unexpected ${key}` });
    const [status, json] = typeof answer === 'function' ? answer(body ? JSON.parse(body) : undefined) : answer;
    return send(status, json);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

const calls = (f) => f.requests.filter((q) => !['/auth/v1/user', '/rest/v1/profiles'].includes(q.path)).map((q) => `${q.method} ${q.path}`);

async function cli(argv, f, { stdin } = {}) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-ops-'));
  writeCredentials({ PMO_CONFIG_DIR: configDir }, f.url, {
    client_id: 'c', access_token: 'access-1', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'user-1', email: 'a@example.test' },
  });
  let out = ''; let err = '';
  const code = await run([...argv, '--url', f.url], {
    env: { PMO_CONFIG_DIR: configDir, PMO_SUPABASE_KEY: 'k' },
    stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) },
    stdin: stdin ?? (async function* () {})(),
  });
  fs.rmSync(configDir, { recursive: true, force: true });
  const parse = (t) => { try { return JSON.parse(t.trim().split('\n').pop()); } catch { return null; } };
  return { code, json: out ? JSON.parse(out) : null, error: parse(err)?.error };
}

// ── budgets activate ─────────────────────────────────────────────────────────────────────────────

// The CLI does not activate yet: the guard has no activate_budget_version tier (owner has not ruled on it), so the
// command refuses up front, before any request. The activation flow below stays tested as a library so enabling it
// is a guard-tier change plus flipping ACTIVATION_ENABLED, not a rewrite.
const ROUTES = { 'POST /rest/v1/rpc/budget_activation_mode': [200, 'allowed'] };

test('AC-CLI-B1: activation from the CLI is refused clearly and sends nothing (activate_budget_version has no guard tier)', async () => {
  assert.equal(ACTIVATION_ENABLED, false);
  const f = await fake(ROUTES);
  try {
    for (const argv of [['budgets', 'activate', V], ['budgets', 'activate', V, '--source', JSON.stringify(SOURCE)]]) {
      const r = await cli(argv, f);
      assert.equal(r.code, 2);
      assert.equal(r.error.code, 'activation_not_enabled');
      assert.match(r.error.message, /budget activation from the CLI is not enabled yet — activate in the app/);
    }
    assert.deepEqual(calls(f), []);
  } finally { await f.close(); }
});

test('AC-CLI-B1: a bad version id or a bad --source is still a usage error before anything is sent', async () => {
  const f = await fake(ROUTES);
  try {
    const noId = await cli(['budgets', 'activate'], f);
    const badId = await cli(['budgets', 'activate', 'not-a-uuid'], f);
    const badSrc = await cli(['budgets', 'activate', V, '--source', JSON.stringify({ ...SOURCE, kind: 'sheet', extra: 1 })], f);
    const httpSrc = await cli(['budgets', 'activate', V, '--source', JSON.stringify({ ...SOURCE, web_url: 'http://x.test/a' })], f);
    const unknown = await cli(['budgets', 'archive', V], f);
    for (const r of [noId, badId, badSrc, httpSrc, unknown]) assert.equal(r.code, 2);
    assert.equal(badSrc.error.code, 'invalid_source');
    assert.match(JSON.stringify(badSrc.error.details), /unknown field 'extra'/);
    assert.match(JSON.stringify(badSrc.error.details), /kind must be/);
    assert.deepEqual(calls(f), []);
  } finally { await f.close(); }
});

/** A recording fake of the RPC seam activateBudget talks to. */
function rpcFake(answers) {
  const seen = [];
  return { seen, rpc: async (name, body) => { seen.push([name, body]); const a = answers[name]; if (a instanceof Error) throw a; return a; } };
}

test('AC-CLI-B1: activateBudget asks the activation rule, links the source while Draft, then activates through the app RPC', async () => {
  const api = rpcFake({ budget_activation_mode: 'allowed', link_budget_version_sharepoint_item: 'link-1', activate_budget_version: null });
  const out = await activateBudget(api, V, { source: SOURCE });
  assert.deepEqual(out, { version_id: V, activated: true, activation_mode: 'allowed', source_link_id: 'link-1' });
  assert.deepEqual(api.seen, [
    ['budget_activation_mode', { version_id: V }],
    ['link_budget_version_sharepoint_item', { p_version_id: V, p_item: SOURCE }],
    ['activate_budget_version', { version_id: V }],
  ]);
});

test('AC-CLI-B1: activateBudget without a source links nothing (sole operator)', async () => {
  const api = rpcFake({ budget_activation_mode: 'sole_operator', activate_budget_version: null });
  const out = await activateBudget(api, V);
  assert.equal(out.activation_mode, 'sole_operator');
  assert.equal(out.source_link_id, null);
  assert.deepEqual(api.seen.map(([n]) => n), ['budget_activation_mode', 'activate_budget_version']);
});

test('AC-CLI-B1: separation of duties, no drafter and not-visible answers are refused with the app wording before any write', async () => {
  const cases = [['blocked_editor', /someone else must activate it/], ['blocked_no_drafter', /Admin or Finance only/], ['blocked', /cannot activate this budget version/]];
  for (const [mode, re] of cases) {
    const api = rpcFake({ budget_activation_mode: mode });
    await assert.rejects(activateBudget(api, V, { source: SOURCE }), (e) => e instanceof ActivationRefused && e.mode === mode && re.test(e.message));
    assert.deepEqual(api.seen.map(([n]) => n), ['budget_activation_mode']);
  }
});

test('AC-CLI-B1: when activation refuses after the source was linked, the error carries the link id', async () => {
  const boom = new Error('only a Draft version can be activated');
  const api = rpcFake({ budget_activation_mode: 'allowed', link_budget_version_sharepoint_item: 'link-1', activate_budget_version: boom });
  await assert.rejects(activateBudget(api, V, { source: SOURCE }), (e) => e === boom && e.sourceLinkId === 'link-1');
});

test('AC-CLI-B1: a refusal by the link RPC is passed through and activation is never attempted', async () => {
  const denied = new Error('Cannot change evidence on this budget version.');
  const api = rpcFake({ budget_activation_mode: 'allowed', link_budget_version_sharepoint_item: denied });
  await assert.rejects(activateBudget(api, V, { source: SOURCE }), (e) => e === denied);
  assert.ok(!api.seen.some(([n]) => n === 'activate_budget_version'));
});

test('AC-CLI-B1: validateSource unit behaviour', () => {
  assert.deepEqual(validateSource(SOURCE), []);
  assert.ok(validateSource(null).length > 0);
  assert.ok(validateSource({ ...SOURCE, name: ' ' }).some((p) => /needs name/.test(p)));
});

// ── accounts map set ─────────────────────────────────────────────────────────────────────────────

const mapRoutes = (rows, extra = {}) => ({
  'GET /rest/v1/budget_category_account_map': [200, rows],
  'POST /functions/v1/external-items': [200, { accounts: CHART, source: 'mirror' }],
  ...extra,
});
const row = (id, category, erp_account, is_push_target) => ({ id, category, erp_account, is_push_target });

test('AC-CLI-B2: --dry-run validates and prints the plan but sends no write', async () => {
  const f = await fake(mapRoutes([]));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary', '5120 - Allowance', '--dry-run'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.equal(r.json.dry_run, true);
    assert.deepEqual(r.json.actions, [{ account: '5120 - Allowance', action: 'add' }, { account: '5110 - Salary', action: 'add_push' }]);
    assert.deepEqual(calls(f), ['GET /rest/v1/budget_category_account_map', 'POST /functions/v1/external-items']);
  } finally { await f.close(); }
});

test('AC-CLI-B2: a first mapping inserts count-only accounts then the push account flagged as the push target', async () => {
  const f = await fake(mapRoutes([], { 'POST /rest/v1/budget_category_account_map': (b) => [201, [{ id: `new-${b.erp_account}`, ...b }]] }));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary', '5120 - Allowance'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    const posts = f.requests.filter((q) => q.method === 'POST' && q.path === '/rest/v1/budget_category_account_map');
    assert.deepEqual(posts.map((q) => q.body), [
      { category: 'Labor', erp_account: '5120 - Allowance', is_push_target: false },
      { category: 'Labor', erp_account: '5110 - Salary', is_push_target: true },
    ]);
    assert.ok(!calls(f).some((c) => c.includes('set_budget_push_account')), 'no push move needed on a first mapping');
  } finally { await f.close(); }
});

test('AC-CLI-B2: replacing an existing push account adds the new row count-only, then moves the push flag with the RPC', async () => {
  let rpcBody;
  const f = await fake(mapRoutes([row('m1', 'Labor', '5110 - Salary', true)], {
    'POST /rest/v1/budget_category_account_map': (b) => [201, [{ id: 'm2', ...b }]],
    'POST /rest/v1/rpc/set_budget_push_account': (b) => { rpcBody = b; return [204]; },
  }));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5120 - Allowance'], f);
    assert.equal(r.code, 0, JSON.stringify(r.error));
    assert.deepEqual(f.requests.find((q) => q.method === 'POST' && q.path.endsWith('account_map')).body,
      { category: 'Labor', erp_account: '5120 - Allowance', is_push_target: false });
    assert.deepEqual(rpcBody, { p_map_id: 'm2' });
    assert.deepEqual(r.json.left_in_place, ['5110 - Salary']);
  } finally { await f.close(); }
});

test('AC-CLI-B2: an existing count-only account becomes the push account without a new row', async () => {
  const f = await fake(mapRoutes([row('m1', 'Labor', '5110 - Salary', true), row('m2', 'Labor', '5120 - Allowance', false)], {
    'POST /rest/v1/rpc/set_budget_push_account': [204],
  }));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5120 - Allowance'], f);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.actions, [{ account: '5120 - Allowance', action: 'make_push' }]);
    assert.deepEqual(calls(f).slice(2), ['POST /rest/v1/rpc/set_budget_push_account']);
    assert.deepEqual(f.requests.at(-1).body, { p_map_id: 'm2' });
  } finally { await f.close(); }
});

test('AC-CLI-B2: repeating an applied set changes nothing', async () => {
  const f = await fake(mapRoutes([row('m1', 'Labor', '5110 - Salary', true), row('m2', 'Labor', '5120 - Allowance', false)]));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary', '5120 - Allowance'], f);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json.actions.map((a) => a.action).sort(), ['keep', 'keep_push']);
    assert.deepEqual(calls(f), ['GET /rest/v1/budget_category_account_map', 'POST /functions/v1/external-items']);
  } finally { await f.close(); }
});

test('AC-CLI-B2: the screen rules refuse bad accounts before any write, naming every problem', async () => {
  const f = await fake(mapRoutes([row('m9', 'Materials', '5130 - Materials', true)]));
  try {
    const cases = [
      [['Labor', '5130 - Materials'], /5130 - Materials is already mapped to Materials\./],
      [['Labor', '6100 - Office'], /not a direct-cost account/],
      [['Labor', '5110 - Salary', '6100 - Office'], null], // overhead allowed as count-only (as on the screen)
      [['Labor', '5000 - Direct Costs'], /not an enabled Expense ledger account/],
      [['Labor', '5199 - Old'], /not an enabled Expense ledger account/],
      [['Labor', '1100 - Cash'], /not an enabled Expense ledger account/],
      [['Labor', 'No such account'], /not an enabled Expense ledger account/],
      [['Labor', '5110 - Salary', '5110 - Salary'], /listed twice/],
      [['Labor', '  '], /An ERP account is required/],
      [['Wages', '5110 - Salary'], /not a budget category/],
    ];
    for (const [args, re] of cases) {
      const r = await cli(['accounts', 'map', 'set', ...args, '--dry-run'], f);
      if (re === null) { assert.equal(r.code, 0, JSON.stringify(r.error)); continue; }
      assert.equal(r.code, 2, args.join('|'));
      assert.equal(r.error.code, 'invalid_account_map');
      assert.match(JSON.stringify(r.error.details), re);
    }
    assert.ok(!calls(f).some((c) => c.startsWith('POST /rest/v1/')), 'no write was sent');
  } finally { await f.close(); }
});

test('AC-CLI-B2: only an active Admin may run it; others are refused before any call but the profile read', async () => {
  for (const role of ['Finance', 'Project Manager', 'Executive']) {
    const f = await fake(mapRoutes([]), { role });
    try {
      const r = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary'], f);
      assert.equal(r.code, 2, role);
      assert.match(r.error.message, /active Admin/);
      assert.deepEqual(calls(f), []);
    } finally { await f.close(); }
  }
});

test('AC-CLI-B2: the database refusing a write is reported with what already landed', async () => {
  const f = await fake(mapRoutes([], { 'POST /rest/v1/budget_category_account_map': (b) =>
    b.is_push_target ? [403, { code: '42501', message: 'row-level security' }] : [201, [{ id: 'x', ...b }]] }));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary', '5120 - Allowance'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, '42501');
    assert.deepEqual(r.error.details.applied, ['5120 - Allowance']);
  } finally { await f.close(); }
});

test('AC-CLI-B2: an unavailable ERP chart stops the command, nothing changes', async () => {
  const f = await fake(mapRoutes([], { 'POST /functions/v1/external-items': [200, { nope: true }] }));
  try {
    const r = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary'], f);
    assert.equal(r.code, 1);
    assert.equal(r.error.code, 'chart_unavailable');
    const down = await fake(mapRoutes([], { 'POST /functions/v1/external-items': [422, { error: 'config-rejected', message: 'ERPNext binding is not active' }] }));
    try {
      const d = await cli(['accounts', 'map', 'set', 'Labor', '5110 - Salary'], down);
      assert.equal(d.code, 1);
      assert.match(d.error.message, /not active/);
      assert.ok(!calls(down).some((c) => c.startsWith('POST /rest/v1/')));
    } finally { await down.close(); }
  } finally { await f.close(); }
});

test('AC-CLI-B2: usage errors', async () => {
  const f = await fake(mapRoutes([]));
  try {
    for (const argv of [['accounts'], ['accounts', 'map', 'get'], ['accounts', 'map', 'set'], ['accounts', 'map', 'set', 'Labor']]) {
      assert.equal((await cli(argv, f)).code, 2, argv.join(' '));
    }
    assert.deepEqual(calls(f), []);
  } finally { await f.close(); }
});

test('AC-CLI-B2: planMapSet and the direct-cost rule', () => {
  assert.ok(isDirectCostPostingAccount(acct('a', { parentAccount: null, accountNumber: '5100' })));
  assert.ok(isDirectCostPostingAccount(acct('a', { parentAccount: 'Cost of Goods Sold - X' })));
  assert.ok(!isDirectCostPostingAccount(acct('a', { parentAccount: 'Overheads', accountNumber: '5200' })));
  assert.ok(!isDirectCostPostingAccount(acct('a', { rootType: 'Income' })));
  assert.equal(BUDGET_CATEGORIES.length, 10);
  assert.throws(() => planMapSet({ category: 'Labor', accounts: [], rows: [], catalogue: CHART }), /at least one/);
});
