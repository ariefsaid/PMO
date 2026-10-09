/**
 * Unit tests for check-isolation-denominator.mjs (issue #612 item 1) — the standing guard that
 * fails the build when the isolation probe's denominator doesn't name a surface that exists.
 *
 * Only the PURE comparator (and entry formatter) are tested here — no Docker, no psql, no disk.
 * The live catalog/discovery orchestration is exercised by the CLI's normal run and its --self-test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compareDenominators, formatEntry, preserveTableExpectations, readDenominator, validateDenominator } from './check-isolation-denominator.mjs';

const fixture = () => ({
  tables: [
    { table: 'alpha', has_org: true, pk: 'id' },
    { table: 'beta', has_org: false, pk: 'uuid' },
    { table: 'gamma', has_org: true, pk: 'id' },
  ],
  rpcs: [],
  definer_functions: ['public.alpha()', 'public.beta(integer)'],
  edge_functions: ['agent-chat', 'health'],
  buckets: ['project-documents', 'procurement-files'],
});

test('AC-612-001: identical denominator passes despite array ordering', () => {
  const actual = fixture();
  const recorded = fixture();
  // Reverse every array independently so the comparison cannot depend on order.
  const reorder = (o) => ({
    tables: [...o.tables].reverse(),
    definer_functions: [...o.definer_functions].reverse(),
    edge_functions: [...o.edge_functions].reverse(),
    buckets: [...o.buckets].reverse(),
  });
  const findings = compareDenominators(actual, reorder(recorded));
  assert.deepEqual(findings, []);
});

test('AC-612-002: rejects a catalog table absent from the denominator', () => {
  const actual = fixture();
  actual.tables.push({ table: 'new_org_surface', has_org: true, pk: 'id' });
  const findings = compareDenominators(actual, fixture());
  const missing = findings.filter((f) => f.kind === 'missing' && f.category === 'tables');
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].entry, { table: 'new_org_surface', has_org: true, pk: 'id' });
  assert.match(missing[0].addLine, /new_org_surface/);
  assert.match(missing[0].addLine, /"has_org"\s*:\s*true/);
  assert.match(missing[0].addLine, /"pk"\s*:\s*"id"/);
});

test('AC-612-003: rejects a stale definer function in the denominator', () => {
  const recorded = fixture();
  recorded.definer_functions.push('public.no_longer_exists()');
  const findings = compareDenominators(fixture(), recorded);
  const stale = findings.filter((f) => f.kind === 'stale' && f.category === 'definer_functions');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].entry, 'public.no_longer_exists()');
});

test('tables that share a name but drift in has_org or pk are reported unlisted AND stale', () => {
  const actual = fixture();
  const recorded = fixture();
  // Same name, different classification — the probe's has_org/pk would be stale.
  recorded.tables[0] = { table: 'alpha', has_org: false, pk: 'uuid' };
  const findings = compareDenominators(actual, recorded);
  const missingAlpha = findings.filter((f) => f.kind === 'missing' && f.category === 'tables' && f.entry.table === 'alpha');
  const staleAlpha = findings.filter((f) => f.kind === 'stale' && f.category === 'tables' && f.entry.table === 'alpha');
  assert.equal(missingAlpha.length, 1);
  assert.deepEqual(missingAlpha[0].entry, { table: 'alpha', has_org: true, pk: 'id' });
  assert.equal(staleAlpha.length, 1);
  assert.deepEqual(staleAlpha[0].entry, { table: 'alpha', has_org: false, pk: 'uuid' });
});

test('missing edge function and bucket are each reported as missing', () => {
  const actual = fixture();
  actual.edge_functions.push('compose-view');
  actual.buckets.push('new-bucket');
  const findings = compareDenominators(actual, fixture());
  assert.ok(findings.some((f) => f.kind === 'missing' && f.category === 'edge_functions' && f.entry === 'compose-view'));
  assert.ok(findings.some((f) => f.kind === 'missing' && f.category === 'buckets' && f.entry === 'new-bucket'));
});

test('stale edge function and bucket are each reported as stale', () => {
  const recorded = fixture();
  recorded.edge_functions.push('retired-fn');
  recorded.buckets.push('retired-bucket');
  const findings = compareDenominators(fixture(), recorded);
  assert.ok(findings.some((f) => f.kind === 'stale' && f.category === 'edge_functions' && f.entry === 'retired-fn'));
  assert.ok(findings.some((f) => f.kind === 'stale' && f.category === 'buckets' && f.entry === 'retired-bucket'));
});

test('formatEntry renders a table object and a scalar on one line', () => {
  assert.equal(formatEntry('tables', { table: 'alpha', has_org: true, pk: 'id' }), JSON.stringify({ table: 'alpha', has_org: true, pk: 'id' }));
  // Scalars are JSON-encoded so an `add to`/`remove from` line is a valid manifest line.
  assert.equal(formatEntry('definer_functions', 'public.alpha()'), JSON.stringify('public.alpha()'));
});

test('formatEntry quotes scalar entries with JSON so they paste into the manifest exactly', () => {
  assert.equal(formatEntry('edge_functions', 'health'), '"health"');
  assert.equal(formatEntry('buckets', 'procurement-files'), '"procurement-files"');
});

// #965 — the probe's column-grant lists (e.g. 0134/0281 column-level SELECT grants) live in an
// optional per-table `columns` field. The formatter (diagnostics AND `--write` regeneration) must
// round-trip it, or one routine `--write` silently reverts the probe to `select=*` on those tables.
test('formatEntry preserves an optional columns field on a table entry', () => {
  const entry = { table: 'alpha', has_org: true, pk: 'id', columns: 'id,org_id' };
  const line = formatEntry('tables', entry);
  assert.deepEqual(JSON.parse(line), entry);
  // No columns field → the entry renders exactly as before (no empty "columns" key).
  assert.equal(formatEntry('tables', { table: 'alpha', has_org: true, pk: 'id' }), JSON.stringify({ table: 'alpha', has_org: true, pk: 'id' }));
});

test('preserveTableExpectations carries recorded column-grant lists onto freshly-read catalog entries', () => {
  const actual = [
    { table: 'alpha', has_org: true, pk: 'id' },
    { table: 'beta', has_org: false, pk: 'uuid' },
  ];
  const recorded = [
    { table: 'alpha', has_org: true, pk: 'id', columns: 'id,org_id' },
    { table: 'beta', has_org: false, pk: 'uuid' },
  ];
  const merged = preserveTableExpectations(actual, recorded);
  assert.deepEqual(merged, [
    { table: 'alpha', has_org: true, pk: 'id', columns: 'id,org_id' },
    { table: 'beta', has_org: false, pk: 'uuid' },
  ]);
  // Unknown/renamed tables in the manifest never leak onto the regenerated catalog.
  assert.equal(preserveTableExpectations(actual, [{ table: 'ghost', has_org: true, pk: 'id', columns: 'id' }]).find((t) => t.table === 'alpha')?.columns, undefined);
});

const validFixture = () => {
  const f = fixture();
  f.tables = f.tables.map(t => ({ ...t, columns: '*', b_read: 'none', by_id: t.has_org ? 'applicable' : 'n/a: no org_id' }));
  return f;
};

test('validateDenominator rejects a columns field that is not a non-empty string', () => {
  const bad = validFixture();
  bad.tables[0] = { table: 'alpha', has_org: true, pk: 'id', columns: '' };
  assert.throws(() => validateDenominator(bad), /columns/);
  bad.tables[0] = { table: 'alpha', has_org: true, pk: 'id', columns: 42 };
  assert.throws(() => validateDenominator(bad), /columns/);
  const good = validFixture();
  good.tables[0].columns = 'id,org_id';
  assert.doesNotThrow(() => validateDenominator(good));
});

test('probe expectations are mandatory, constrained and round-trip through regeneration', () => {
  const shipped = JSON.parse(fs.readFileSync(new URL('./isolation-probe-denominator.json', import.meta.url)));
  assert.doesNotThrow(() => validateDenominator(shipped));
  for (const field of ['columns', 'b_read', 'by_id']) {
    const bad = structuredClone(shipped);
    delete bad.tables[0][field];
    assert.throws(() => validateDenominator(bad), new RegExp(field));
  }
  for (const change of [{ b_read: 'whatever' }, { by_id: 'skip' }, { has_org: false, by_id: 'applicable' }]) {
    const bad = structuredClone(shipped);
    Object.assign(bad.tables[0], change);
    assert.throws(() => validateDenominator(bad));
  }
  assert.ok(shipped.rpcs.length > 0);
  for (const field of ['class', 'expect_denial', 'source']) {
    const bad = structuredClone(shipped);
    delete bad.rpcs[0][field];
    assert.throws(() => validateDenominator(bad), new RegExp(field));
  }
  const bad = structuredClone(shipped);
  bad.rpcs[0].expect_denial = [{ http: 401, sqlstate: '42501' }];
  assert.throws(() => validateDenominator(bad), /401/);
  const merged = preserveTableExpectations(shipped.tables.map(({ table, has_org, pk }) => ({ table, has_org, pk })), shipped.tables);
  assert.deepEqual(merged, shipped.tables);
  assert.deepEqual(JSON.parse(formatEntry('tables', shipped.tables[0])), shipped.tables[0]);
});

test('source citations and exact RPC probe coverage are verified without a database', () => {
  const shipped = JSON.parse(fs.readFileSync(new URL('./isolation-probe-denominator.json', import.meta.url)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denominator-source-'));
  const file = path.join(dir, 'manifest.json');
  const check = value => { fs.writeFileSync(file, JSON.stringify(value)); return () => readDenominator(file); };
  try {
    assert.doesNotThrow(check(shipped));
    const wrongSource = structuredClone(shipped);
    wrongSource.rpcs[0].source = ['supabase/migrations/0067_org_credit_balance.sql:1'];
    assert.throws(check(wrongSource), /source.*support/);
    const missing = structuredClone(shipped);
    missing.rpcs.pop();
    assert.throws(check(missing), /RPC.*coverage/);
    const extra = structuredClone(shipped);
    extra.rpcs.push({name:'auth_org_id',class:'inert',expect_denial:[],shape:'false',source:shipped.rpcs[0].source});
    assert.throws(check(extra), /RPC.*coverage/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('validateDenominator accepts a well-formed manifest with all five arrays', () => {
  const out = validateDenominator(validFixture());
  assert.equal(out.tables.length, 3);
  assert.deepEqual(out, validFixture());
});

test('validateDenominator rejects an unexpected root key (manifest is exactly four arrays)', () => {
  assert.throws(() => validateDenominator({ ...fixture(), unexpected: [] }), /unexpected root key/);
});

// Exercise the shipped shell entrypoints; only the HTTP transport is substituted.
function probeFixture(mode, { full = false, override, runner = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-behavior-'));
  try {
    const denominator = JSON.parse(fs.readFileSync(new URL('./isolation-probe-denominator.json', import.meta.url)));
    const rows = denominator.tables.filter(t => t.has_org).map(t => ({ table: t.table, pk: t.pk, id: randomUUID() }));
    fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
    const curl = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const url = args.find(a => a.includes('/auth/v1/') || a.includes('/rest/v1/')) || '';
let code = 200, body = [];
const mode = process.env.PROBE_TEST_MODE;
if (url.includes('/auth/v1/user')) { code = mode === 'invalid-token' ? 401 : 200; body = {id: process.env.PROBE_USER}; }
else if (args.some(a => a === 'apikey: service')) {
  if (url.includes('/profiles?') && url.includes('id=eq.' + process.env.PROBE_USER)) body = [{org_id: mode === 'wrong-org' ? process.env.A_ORG : process.env.B_ORG, status: 'active'}];
  else if (url.includes('/platform_operators?')) body = mode === 'operator' ? [{user_id:process.env.PROBE_USER}] : [];
  else body = [{org_id: process.env.A_ORG, email: mode === 'quoted-email' ? '"synthetic"' : 'synthetic'}];
} else if (url.includes('/rpc/')) {
  const fn = url.split('/rpc/')[1];
  const entry = JSON.parse(fs.readFileSync(process.env.PROBE_DENOM)).rpcs?.find(r => r.name === fn);
  const expected = entry?.expect_denial?.[0];
  if (expected) { code = expected.http; body = {code: expected.sqlstate}; }
  else body = fn === 'org_has_member_email' ? false : [];
  if (fn === 'org_credit_balance' && mode === 'unexpected-rpc') {code = 404; body = {code:'P0002'};}
  if (fn === 'org_credit_balance' && mode === 'run-401') {code = 401; body = {code:'42501'};}
  if (fn === 'org_credit_balance' && mode === 'unexpected-empty') {code = 200; body = null;}
  if (fn === 'operator_list_orgs' && mode === 'unexpected-shape-status') code = 201;
  if (fn === 'operator_list_orgs' && mode === 'subshell-leak') body = [{name:'synthetic'}];
  if (fn === 'operator_list_orgs' && mode === 'bad-shape') body = null;
  try { JSON.parse(args[args.indexOf('-d')+1]); } catch { code=400; body={code:'22023'}; }
} else if (args.includes('PATCH') && mode === 'patch-204') {code = 204; body = '';}
else if (url.includes('/clickup_webhook_inbox?') && mode === 'no-org-leak' && args.includes('Authorization: Bearer token')) body = [{synthetic:true}];
fs.writeFileSync(args[args.indexOf('-o')+1], typeof body === 'string' ? body : JSON.stringify(body));
process.stdout.write(String(code));
`;
    fs.writeFileSync(path.join(dir, 'curl'), curl, { mode: 0o755 });
    const env = { PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir, BASE: 'fixture', ANON: 'anon', SERVICE: 'service', JWT_B: 'token',
      A_ORG: randomUUID(), B_ORG: randomUUID(), PROBE_USER: randomUUID(), A_ROWS_JSON: path.join(dir, 'rows.json'),
      PROBE_A_DISPOSABLE: '1', STRICT: '1', PROBE_TEST_MODE: mode,
      PROBE_DENOM: path.resolve('scripts/isolation-probe-denominator.json') };
    if (!full && !runner) env.RPC_ONLY = '1';
    if (override !== undefined) {
      env.TABLES_JSON = override === '' ? '' : path.join(dir, 'tables.json');
      if (override !== '') fs.writeFileSync(env.TABLES_JSON, JSON.stringify(override === 'matching' ? denominator.tables : override));
    }
    if (runner) Object.assign(env, { SMOKE_EMAIL: 'synthetic', SMOKE_PASSWORD: 'synthetic' });
    return spawnSync('bash', [runner ? 'scripts/post-deploy-probes.sh' : 'scripts/isolation-probe.sh'], {env, encoding: 'utf8', timeout: 120000});
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
}

for (const mode of ['invalid-token', 'wrong-org']) test(`probe refuses ${mode} before probes`, () => {
  const r = probeFixture(mode);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /JWT_B.*(valid|org)/);
  assert.doesNotMatch(r.stdout + r.stderr, /rpc .*→/);
});
test('operator B is refused before probing non-operator expectations', () => {
  const r = probeFixture('operator');
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /verified non-operator/);
});
test('runner refuses invalid B before either smoke starts', () => {
  const r = probeFixture('invalid-token', {runner:true});
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /JWT_B.*valid/);
});
for (const runner of [false, true]) for (const override of ['', [], [{table:'profiles', pk:'id', has_org:true}]]) test(`override rejected (${runner ? 'runner' : 'standalone'}, ${JSON.stringify(override)})`, () => {
  const r = probeFixture('baseline', {override, runner});
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /TABLES_JSON/);
});
for (const mode of ['unexpected-rpc', 'run-401', 'bad-shape', 'unexpected-empty', 'unexpected-shape-status']) test(`${mode} is a probe error, never a denial`, () => {
  const r = probeFixture(mode);
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /probe_errors: [1-9]/);
});
test('service-read member fact is encoded as JSON, not interpolated', () => {
  const r = probeFixture('quoted-email');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('non-empty operator list is counted across command substitution', () => {
  const r = probeFixture('subshell-leak');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /leaks: 1\s/);
});
test('PATCH 204 is UNKNOWN and causes exit 4', () => {
  const r = probeFixture('patch-204', {full:true});
  assert.equal(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stderr, /PROBE-ERROR.*update.*204/);
});
test('no-org rows follow their declared none expectation', () => {
  const r = probeFixture('no-org-leak', {full:true});
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /LEAK.*clickup_webhook_inbox/);
});
test('full denominator, exact override and explicit no-org N/A pass strict mode', () => {
  const r = probeFixture('baseline', {full:true, override:'matching'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /N\/A.*clickup_webhook_inbox/);
  assert.match(r.stdout, /probe_errors: 0.*skipped: 0/);
});

test('validateDenominator rejects a table entry with an empty pk', () => {
  const bad = fixture();
  bad.tables[0] = { table: 'alpha', has_org: true, pk: '  ' };
  assert.throws(() => validateDenominator(bad), /pk/);
});