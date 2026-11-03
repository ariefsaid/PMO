/**
 * pmo-equipment.test.mjs — `pmo equipment usage|costing` (#1519, AC-EQU-018).
 * Runs against a fake Supabase served by node:http; database validation and roles are proved by pgTAP.
 * Mutation check: make setSettings ignore dryRun and the dry-run test must fail.
 *
 * Run: node --test scripts/pmo-equipment.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run, writeCredentials } from './pmo.mjs';
import { explainError, formatAllocations, readSettings, validateUsageList } from './lib/pmo-equipment.mjs';

const PROJECT = '11111111-1111-1111-1111-111111111111';
const ASSET = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
const SETTING_KEY = '33333333-3333-3333-3333-333333333333';
const SETTINGS = [
  { asset_id: ASSET, basis: 'hire_rate', work_rate: 50, rate_unit: 'hours', effective_from: '2025-01-01' },
  { asset_id: ASSET, basis: 'none', effective_from: '2025-02-01' },
];
const PREVIEW_ROWS = [
  { project_id: PROJECT, month: '2025-01-01', category: 'Equipment', basis: 'hire_rate', amount: 300, driver_total: 6, entry_count: 1 },
  { project_id: null, month: '2025-01-01', category: 'Equipment', basis: 'actual_cost', amount: 125.5, driver_total: 0, entry_count: 0 },
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

async function cli(argv, server, files = {}) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmo-equipment-'));
  try {
    writeCredentials({ PMO_CONFIG_DIR: configDir }, server.url, {
      client_id: 'cli-test',
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-id', email: 'cli-test@example.test' },
    });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(configDir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    const args = argv.map((argument) => (Object.hasOwn(files, argument) ? path.join(configDir, argument) : argument));
    let out = '';
    let err = '';
    const code = await run([...args, '--url', server.url], {
      env: { PMO_CONFIG_DIR: configDir, PMO_SUPABASE_KEY: 'test-key' },
      stdout: { write: (value) => (out += value) },
      stderr: { write: (value) => (err += value) },
      stdin: (async function* emptyInput() {})(),
    });
    let json = null;
    let error = null;
    try { json = JSON.parse(out); } catch { /* Human-readable output. */ }
    try { error = JSON.parse(err.trim().split('\n').pop()).error; } catch { /* No JSON error. */ }
    return { code, out, json, error };
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

test('AC-EQU-018 usage list posts list_equipment_usage_totals with the project and range', async () => {
  const rows = [{ project_id: PROJECT, month: '2025-01-01', work_units: 6, entry_count: 1 }];
  const server = await fake({ 'POST /rest/v1/rpc/list_equipment_usage_totals': [200, rows] });
  try {
    const result = await cli(['equipment', 'usage', 'list', '--project', PROJECT, '--from', '2025-01-01', '--to', '2025-01-31', '--json'], server);
    assert.equal(result.code, 0, JSON.stringify(result.error));
    assert.deepEqual(rpcCalls(server), ['list_equipment_usage_totals']);
    assert.deepEqual(server.requests[0].body, {
      p_project_id: PROJECT,
      p_asset_id: null,
      p_from: '2025-01-01',
      p_to: '2025-01-31',
    });
    assert.deepEqual(result.json, rows);
  } finally { await server.close(); }
});

test('AC-EQU-018 usage list refuses invalid ids and ranges before making a request', async () => {
  const server = await fake();
  try {
    const result = await cli(['equipment', 'usage', 'list', '--project', 'not-a-uuid', '--from', '2025-02-01', '--to', '2025-01-01'], server);
    assert.equal(result.code, 2);
    assert.equal(result.error.code, 'invalid_equipment_usage_query');
    assert.equal(result.error.details.length, 2);
    assert.deepEqual(server.requests, []);
  } finally { await server.close(); }
});

test('AC-EQU-018 costing files are capped at fifty settings before any preview', async () => {
  const server = await fake();
  try {
    const result = await cli(['equipment', 'costing', 'set', 'settings.json'], server, { 'settings.json': Array.from({ length: 51 }, () => ({})) });
    assert.equal(result.code, 2);
    assert.equal(result.error.code, 'invalid_equipment_costing_file');
    assert.deepEqual(server.requests, []);
  } finally { await server.close(); }
});

test('AC-EQU-018 costing settings accept one object or an array and reject empty or malformed files', () => {
  assert.deepEqual(readSettings(SETTINGS[0]), [SETTINGS[0]]);
  assert.deepEqual(readSettings(SETTINGS), SETTINGS);
  assert.throws(() => readSettings([]), (error) => error.problems.includes('the file has no settings'));
  assert.throws(() => readSettings([SETTINGS[0], null]), (error) => error.problems.includes('setting 2 is not a JSON object'));
});

test('AC-EQU-018 usage list accepts an asset and refuses ranges over two years', () => {
  assert.deepEqual(validateUsageList({ asset: ASSET.toUpperCase(), from: '2024-01-01', to: '2025-12-31' }), {
    p_project_id: null,
    p_asset_id: ASSET,
    p_from: '2024-01-01',
    p_to: '2025-12-31',
  });
  assert.throws(() => validateUsageList({ project: PROJECT, from: '2024-01-01', to: '2026-01-02' }),
    (error) => error.problems.includes('the date range may not exceed two years'));
  assert.throws(() => validateUsageList({ project: PROJECT, asset: ASSET, from: '2025-01-01', to: '2025-01-31' }),
    (error) => error.problems.includes('name exactly one of --project or --asset'));
});

test('AC-EQU-018 costing errors explain every documented database code and pass unknown errors through', () => {
  for (const [error, expected] of [
    [{ code: '42501', message: 'not authorized' }, /active Admin or Finance/],
    [{ code: '22023', message: 'invalid setting' }, /setting is not valid: invalid setting/],
    [{ code: 'P0002', message: 'setting not found' }, /^Not found: setting not found/],
    [{ code: '23505', message: 'conflict' }, /conflicts with another rule that matches the same costs.*: conflict/],
    [{ code: '40001', message: 'stale version' }, /changed since you loaded it.*: stale version/],
  ]) {
    assert.match(explainError(error), expected);
  }
  assert.equal(explainError({ code: 'XX000', message: 'database unavailable' }), 'database unavailable');
});

test('AC-EQU-018 allocation formatting handles usage-only and empty results', () => {
  assert.match(formatAllocations([{ project_id: PROJECT, project_name: 'Project One', month: '2025-01-01', unit: 'hours', work_units: 6, standby_units: 0 }]),
    /2025-01 · Project One · usage only \(6 hours\)/);
  assert.equal(formatAllocations([]), '(no equipment allocations in this window)\n');
});

test('AC-EQU-018 costing preview prints a project/month line and flags unallocated pools', async () => {
  const server = await fake({ 'POST /rest/v1/rpc/preview_equipment_costing': [200, PREVIEW_ROWS] });
  try {
    const result = await cli(['equipment', 'costing', 'preview', 'settings.json'], server, { 'settings.json': SETTINGS[0] });
    assert.equal(result.code, 0, JSON.stringify(result.error));
    assert.deepEqual(rpcCalls(server), ['preview_equipment_costing']);
    assert.deepEqual(server.requests[0].body, { p_setting: SETTINGS[0] });
    assert.match(result.out, new RegExp(`2025-01 · ${PROJECT} · hire_rate · 300\\.00`));
    assert.match(result.out, /unallocated:\s+125\.50/);
  } finally { await server.close(); }
});

test('AC-EQU-018 costing set --dry-run previews settings and never saves', async () => {
  const server = await fake({
    'POST /rest/v1/rpc/preview_equipment_costing': [200, PREVIEW_ROWS],
    'POST /rest/v1/rpc/save_equipment_costing': [200, { setting_key: SETTING_KEY, version: 1, changed: true }],
  });
  try {
    const result = await cli(['equipment', 'costing', 'set', 'settings.json', '--dry-run'], server, { 'settings.json': SETTINGS });
    assert.equal(result.code, 0, JSON.stringify(result.error));
    assert.deepEqual(rpcCalls(server), ['preview_equipment_costing', 'preview_equipment_costing']);
    assert.deepEqual(server.requests.map((request) => request.body), SETTINGS.map((setting) => ({ p_setting: setting })));
    assert.equal(result.json.dry_run, true);
    assert.deepEqual(result.json.results.map((row) => row.action), ['would_save', 'would_save']);
  } finally { await server.close(); }
});

test('AC-EQU-018 costing set saves settings in order and stops at the first refusal with the database reason', async () => {
  let saves = 0;
  const server = await fake({
    'POST /rest/v1/rpc/preview_equipment_costing': [200, PREVIEW_ROWS],
    'POST /rest/v1/rpc/save_equipment_costing': () => (++saves === 1
      ? [200, { setting_key: SETTING_KEY, version: 1, id: 'saved', changed: true }]
      : [409, { code: '23505', message: 'conflicts with an equipment costing setting' }]),
  });
  try {
    const result = await cli(['equipment', 'costing', 'set', 'settings.json'], server, { 'settings.json': SETTINGS });
    assert.equal(result.code, 1);
    assert.equal(result.error.code, '23505');
    assert.match(result.error.message, /conflicts with an equipment costing setting/);
    assert.deepEqual(rpcCalls(server), [
      'preview_equipment_costing', 'preview_equipment_costing',
      'save_equipment_costing', 'save_equipment_costing',
    ]);
    assert.equal(saves, 2);
    assert.deepEqual(result.error.details.applied.map((row) => row.id), ['saved']);
  } finally { await server.close(); }
});

test('AC-EQU-018 costing list --history passes p_include_history', async () => {
  const rows = [{ setting_key: SETTING_KEY, version: 1, is_current: false }];
  const server = await fake({ 'POST /rest/v1/rpc/list_equipment_costing': [200, rows] });
  try {
    const result = await cli(['equipment', 'costing', 'list', '--history'], server);
    assert.equal(result.code, 0, JSON.stringify(result.error));
    assert.deepEqual(rpcCalls(server), ['list_equipment_costing']);
    assert.deepEqual(server.requests[0].body, { p_include_history: true });
    assert.deepEqual(result.json, rows);
  } finally { await server.close(); }
});

test('AC-EQU-018 the CLI tiers match the migration guard arrays', async () => {
  const { EQUIPMENT_READ_RPCS, EQUIPMENT_USAGE_RPCS, EQUIPMENT_WRITE_RPCS } = await import('./lib/pmo-equipment.mjs');
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
  const migrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const migration = migrations.map((file) => ({
    file,
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
  })).filter(({ sql }) => /equipment_write_rpcs\s+constant\s+text\[\]/.test(sql)).at(-1);
  assert.ok(migration, 'an equipment API-client guard migration declares equipment_write_rpcs');
  const readGuardArray = (name) => {
    const match = migration.sql.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`));
    assert.ok(match, `${migration.file} declares ${name}`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort();
  };
  assert.deepEqual([...EQUIPMENT_WRITE_RPCS].sort(), readGuardArray('equipment_write_rpcs'));
  assert.deepEqual([...EQUIPMENT_READ_RPCS].sort(), readGuardArray('equipment_read_rpcs'));
  assert.deepEqual([...EQUIPMENT_USAGE_RPCS].sort(), readGuardArray('equipment_usage_rpcs'));
});

test('AC-EQU-018 a 42501 explains who may manage equipment costing', async () => {
  const server = await fake({
    'POST /rest/v1/rpc/preview_equipment_costing': [403, { code: '42501', message: 'not authorized' }],
  });
  try {
    const result = await cli(['equipment', 'costing', 'preview', 'setting.json'], server, { 'setting.json': SETTINGS[0] });
    assert.equal(result.code, 1);
    assert.equal(result.error.code, '42501');
    assert.match(result.error.message, /active Admin or Finance member/);
    assert.deepEqual(rpcCalls(server), ['preview_equipment_costing']);
  } finally { await server.close(); }
});
