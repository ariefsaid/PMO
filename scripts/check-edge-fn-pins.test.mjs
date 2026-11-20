/**
 * Unit tests for scripts/check-edge-fn-pins.mjs (#2320).
 *
 * The script's network calls (npm/jsr latest version, the npm advisory feed) are exercised
 * through an injected `fetchImpl`, so these tests never touch the network. The last test
 * scans the REAL `supabase/functions` tree (filesystem only) to pin the invariant the report
 * depends on: every import in every edge-function `deno.json` is either a registry pin this
 * check understands or the repo's local `@/` alias — nothing is silently skipped.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyPin,
  collectPins,
  compareVersions,
  isBehind,
  parseImportSpecifier,
  readImportMaps,
  renderReport,
  RETRY_DELAYS_MS,
  runCheck,
} from './check-edge-fn-pins.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** No real sleeping in tests: record the backoff delays instead. */
function recordingWait() {
  const delays = [];
  const wait = async (ms) => {
    delays.push(ms);
  };
  wait.delays = delays;
  return wait;
}

/** A fake `fetch` that answers registry lookups from a map, recording every call.
 *  `flaky` maps a URL fragment to the number of attempts that fail before one succeeds. */
function fakeFetch({ npmLatest = {}, jsrLatest = {}, advisories = {}, fail = [], flaky = {} } = {}) {
  const calls = [];
  const remainingFlaky = { ...flaky };
  const impl = async (url, init) => {
    calls.push({ url, init });
    const blocked = fail.find((needle) => url.includes(needle));
    if (blocked) {
      throw new Error(`fetch failed: ${blocked}`);
    }
    const flakyNeedle = Object.keys(remainingFlaky).find((needle) => url.includes(needle));
    if (flakyNeedle && remainingFlaky[flakyNeedle] > 0) {
      remainingFlaky[flakyNeedle] -= 1;
      throw new Error(`fetch failed: ${flakyNeedle}`);
    }
    if (url === 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk') {
      const asked = JSON.parse(init.body);
      const answer = {};
      for (const name of Object.keys(asked)) {
        if (advisories[name]) answer[name] = advisories[name];
      }
      return { ok: true, status: 200, json: async () => answer };
    }
    const npmMatch = url.match(/^https:\/\/registry\.npmjs\.org\/(.+)\/latest$/);
    if (npmMatch) {
      const name = npmMatch[1];
      if (!(name in npmLatest)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ version: npmLatest[name] }) };
    }
    const jsrMatch = url.match(/^https:\/\/jsr\.io\/(.+)\/meta\.json$/);
    if (jsrMatch) {
      const name = jsrMatch[1];
      if (!(name in jsrLatest)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ latest: jsrLatest[name] }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  impl.calls = calls;
  return impl;
}

test('parseImportSpecifier reads an exact npm pin', () => {
  assert.deepEqual(parseImportSpecifier('npm:@supabase/supabase-js@2.110.0'), {
    kind: 'pin',
    registry: 'npm',
    name: '@supabase/supabase-js',
    spec: '2.110.0',
    subpath: '',
  });
  assert.deepEqual(parseImportSpecifier('npm:jose@6.2.3'), {
    kind: 'pin',
    registry: 'npm',
    name: 'jose',
    spec: '6.2.3',
    subpath: '',
  });
});

test('parseImportSpecifier keeps the subpath of a jsr pin separate from its version', () => {
  assert.deepEqual(parseImportSpecifier('jsr:@std/testing@1.0.0/bdd'), {
    kind: 'pin',
    registry: 'jsr',
    name: '@std/testing',
    spec: '1.0.0',
    subpath: '/bdd',
  });
});

test('parseImportSpecifier marks the local alias and unversioned/remote imports apart from a pin', () => {
  assert.deepEqual(parseImportSpecifier('../../../pmo-portal/'), { kind: 'local' });
  assert.deepEqual(parseImportSpecifier('npm:zod'), { kind: 'pin', registry: 'npm', name: 'zod', spec: null, subpath: '' });
  assert.equal(parseImportSpecifier('https://deno.land/x/foo@1/mod.ts').kind, 'unsupported');
  assert.equal(parseImportSpecifier('data:application/json,{}').kind, 'unsupported');
});

test('collectPins merges the same package across import maps and records every owner', () => {
  const pins = collectPins([
    { path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3', '@/': '../../../pmo-portal/' } },
    { path: '_shared/deno.json', imports: { jose: 'npm:jose@6.2.3' } },
  ]);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].registry, 'npm');
  assert.equal(pins[0].name, 'jose');
  assert.deepEqual(pins[0].specs, ['6.2.3']);
  assert.deepEqual(pins[0].owners, ['_shared', 'agent-chat']);
});

test('collectPins collapses subpath imports of one jsr package into one pin', () => {
  const pins = collectPins([
    {
      path: '_shared/deno.json',
      imports: {
        '@std/testing/bdd': 'jsr:@std/testing@1.0.0/bdd',
        '@std/testing/mock': 'jsr:@std/testing@1.0.0/mock',
      },
    },
  ]);
  assert.equal(pins.length, 1);
  assert.deepEqual(pins[0].specs, ['1.0.0']);
  assert.deepEqual(pins[0].subpaths, ['/bdd', '/mock']);
});

test('collectPins keeps drift visible: the same package pinned at two versions is one row with both specs', () => {
  const pins = collectPins([
    { path: 'a/deno.json', imports: { jose: 'npm:jose@6.2.3' } },
    { path: 'b/deno.json', imports: { jose: 'npm:jose@6.1.0' } },
  ]);
  assert.deepEqual(pins[0].specs, ['6.1.0', '6.2.3']);
});

test('collectPins surfaces an import this check cannot classify instead of dropping it', () => {
  const pins = collectPins([
    { path: 'a/deno.json', imports: { lodash: 'https://deno.land/x/lodash/mod.ts' } },
  ]);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].kind, 'unsupported');
  assert.deepEqual(pins[0].owners, ['a']);
});

test('compareVersions compares numerically, not lexically, and ranks a release above its prerelease', () => {
  assert.equal(compareVersions('4.6.7', '4.6.10'), -1);
  assert.equal(compareVersions('2.110.0', '2.119.2'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
});

test('isBehind is true only when the pin is older than latest', () => {
  assert.equal(isBehind('2.110.0', '2.119.2'), true);
  assert.equal(isBehind('4.6.7', '4.6.7'), false);
  assert.equal(isBehind('4.7.0', '4.6.7'), false);
});

test('classifyPin: a current, advisory-free pin is not blocking', () => {
  const row = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'zod', specs: ['4.6.7'], owners: ['agent-chat'] },
    latest: '4.6.7',
    advisories: [],
  });
  assert.equal(row.status, 'current');
  assert.equal(row.blocking, false);
});

test('classifyPin: a pin behind latest is reported but is not blocking', () => {
  const row = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'jose', specs: ['6.2.3'], owners: ['agent-chat'] },
    latest: '6.2.18',
    advisories: [],
  });
  assert.equal(row.status, 'behind');
  assert.equal(row.blocking, false);
});

test('classifyPin: a published advisory blocks even when the pin looks current', () => {
  const row = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'jose', specs: ['6.2.3'], owners: ['agent-chat'] },
    latest: '6.2.3',
    advisories: [
      { id: 'GHSA-test', url: 'https://github.com/advisories/GHSA-test', title: 'bad', severity: 'high' },
    ],
  });
  assert.equal(row.status, 'advisory');
  assert.equal(row.blocking, true);
});

test('classifyPin: a jsr pin is never called clean — no advisory feed covers it', () => {
  const row = classifyPin({
    pin: { kind: 'pin', registry: 'jsr', name: '@std/assert', specs: ['1.0.0'], owners: ['_shared'] },
    latest: '1.0.19',
    advisories: [],
  });
  assert.equal(row.status, 'behind');
  assert.equal(row.advisoryCoverage, 'none');
  assert.equal(row.blocking, false);
});

test('classifyPin: drift, an unresolvable latest, and a non-exact spec all block', () => {
  const drift = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'jose', specs: ['6.1.0', '6.2.3'], owners: ['a', 'b'] },
    latest: '6.2.18',
    advisories: [],
  });
  assert.equal(drift.status, 'drift');
  assert.equal(drift.blocking, true);

  const unverified = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'jose', specs: ['6.2.3'], owners: ['a'] },
    latest: null,
    latestError: 'HTTP 503 from registry',
    advisories: [],
  });
  assert.equal(unverified.status, 'unverified');
  assert.equal(unverified.blocking, true);

  const range = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'jose', specs: ['^6.2.3'], owners: ['a'] },
    latest: '6.2.18',
    advisories: [],
  });
  assert.equal(range.status, 'range');
  assert.equal(range.blocking, true);
});

test('runCheck reports every pin with latest and advisory status, and passes a clean tree', async () => {
  const fetchImpl = fakeFetch({
    npmLatest: { jose: '6.2.18', zod: '4.6.7' },
    jsrLatest: { '@std/assert': '1.0.0' },
  });
  const result = await runCheck({
    files: [
      { path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.18', zod: 'npm:zod@4.6.7' } },
      { path: '_shared/deno.json', imports: { '@std/assert': 'jsr:@std/assert@1.0.0' } },
    ],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r) => r.name).sort(), ['@std/assert', 'jose', 'zod']);
  assert.match(result.report, /jose/);
  assert.match(result.report, /6\.2\.18/);
  assert.match(result.report, /not covered/);
});

test('runCheck fails on an advisory and names it in the report', async () => {
  const fetchImpl = fakeFetch({
    npmLatest: { jose: '6.2.3' },
    advisories: {
      jose: [
        {
          id: 1106913,
          url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          title: 'Test advisory',
          severity: 'high',
          vulnerable_versions: '<6.2.4',
        },
      ],
    },
  });
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.report, /GHSA-aaaa-bbbb-cccc/);
  assert.match(result.report, /FAILED/);
});

test('runCheck passes a behind pin with a visible warning (outdated is a report, not a gate)', async () => {
  const fetchImpl = fakeFetch({ npmLatest: { jose: '6.2.18' } });
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].status, 'behind');
  assert.match(result.report, /behind/);
});

test('runCheck never reports a pass when a registry lookup fails', async () => {
  const fetchImpl = fakeFetch({ npmLatest: { jose: '6.2.18' }, fail: ['registry.npmjs.org/jose/latest'] });
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].status, 'unverified');
  assert.match(result.report, /could not verify/i);
});

test('runCheck never reports a pass when the npm advisory feed itself is unreachable', async () => {
  const fetchImpl = fakeFetch({ npmLatest: { jose: '6.2.3' }, fail: ['advisories/bulk'] });
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].status, 'unverified');
});

test('runCheck retries a failed registry lookup and succeeds on a later attempt', async () => {
  const fetchImpl = fakeFetch({
    npmLatest: { jose: '6.2.18' },
    flaky: { 'registry.npmjs.org/jose/latest': 2 },
  });
  const wait = recordingWait();
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait,
  });
  assert.equal(result.ok, true, result.report);
  assert.equal(result.rows[0].status, 'behind');
  assert.equal(result.rows[0].latest, '6.2.18');
  // Two failures means two backoff waits, and no third: the lookup succeeded.
  assert.deepEqual(wait.delays, RETRY_DELAYS_MS.slice(0, 2));
  const attempts = fetchImpl.calls.filter((c) => c.url.includes('/jose/latest'));
  assert.equal(attempts.length, 3);
});

test('runCheck retries the advisory feed too, so one blip does not fail the release', async () => {
  const fetchImpl = fakeFetch({
    npmLatest: { jose: '6.2.18' },
    flaky: { 'advisories/bulk': 1 },
  });
  const wait = recordingWait();
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait,
  });
  assert.equal(result.ok, true, result.report);
  assert.deepEqual(wait.delays, RETRY_DELAYS_MS.slice(0, 1));
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes('advisories/bulk')).length, 2);
});

test('runCheck gives up after three retries, names the lookup that failed, and fails closed', async () => {
  const fetchImpl = fakeFetch({
    npmLatest: { jose: '6.2.18' },
    fail: ['registry.npmjs.org/jose/latest'],
  });
  const wait = recordingWait();
  const result = await runCheck({
    files: [{ path: 'agent-chat/deno.json', imports: { jose: 'npm:jose@6.2.3' } }],
    fetchImpl,
    wait,
  });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].status, 'unverified');
  // Initial attempt + three retries, with the recorded backoff between them.
  assert.deepEqual(wait.delays, RETRY_DELAYS_MS);
  assert.equal(fetchImpl.calls.filter((c) => c.url.includes('/jose/latest')).length, 4);
  assert.match(result.report, /registry\.npmjs\.org\/jose\/latest/);
  assert.match(result.report, /after 4 attempts/);
  assert.match(result.report, /FAILED/);
});

test('runCheck blocks on drift between import maps (pins must move together)', async () => {
  const fetchImpl = fakeFetch({ npmLatest: { jose: '6.2.18' } });
  const result = await runCheck({
    files: [
      { path: 'a/deno.json', imports: { jose: 'npm:jose@6.2.3' } },
      { path: 'b/deno.json', imports: { jose: 'npm:jose@6.1.0' } },
    ],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.report, /drift/i);
});

test('runCheck blocks on an import map entry it cannot classify', async () => {
  const fetchImpl = fakeFetch();
  const result = await runCheck({
    files: [{ path: 'a/deno.json', imports: { lodash: 'https://deno.land/x/lodash/mod.ts' } }],
    fetchImpl,
    wait: async () => {},
  });
  assert.equal(result.ok, false);
  assert.match(result.report, /https:\/\/deno\.land/);
});

test('renderReport states how many pins it could not verify and never omits a row', () => {
  const rows = [
    {
      kind: 'pin',
      registry: 'npm',
      name: 'jose',
      specs: ['6.2.3'],
      subpaths: [],
      owners: ['agent-chat'],
      latest: '6.2.18',
      status: 'behind',
      advisories: [],
      advisoryCoverage: 'npm registry advisory feed',
      blocking: false,
      detail: 'behind latest',
    },
  ];
  const report = renderReport({ rows, files: 1, scannedRoot: 'supabase/functions' });
  assert.match(report, /jose/);
  assert.match(report, /agent-chat/);
});

test('renderReport never says "advisory: none" for a pin whose advisories were not looked up', () => {
  const row = classifyPin({
    pin: { kind: 'pin', registry: 'npm', name: 'jose', specs: ['^6.2.3'], owners: ['a'] },
    latest: '6.2.18',
    advisories: [],
  });
  const report = renderReport({ rows: [row], files: 1 });
  assert.match(report, /advisory: not checked/);
  assert.doesNotMatch(report, /advisory: none/);
});

test('the REAL edge-function tree has no import this check cannot classify', () => {
  const files = readImportMaps(path.join(REPO, 'supabase', 'functions'));
  assert.ok(files.length >= 25, `expected every function import map, found ${files.length}`);
  assert.ok(
    files.some((f) => f.path === '_shared/deno.json'),
    'the shared import map must be scanned',
  );

  const pins = collectPins(files);
  const unsupported = pins.filter((p) => p.kind === 'unsupported');
  assert.deepEqual(
    unsupported.map((p) => `${p.name} -> ${p.value}`),
    [],
    'an unclassifiable import would be silently skipped by the report',
  );
  // Every real pin is exact — a range would make the advisory lookup describe a spec, not a version.
  for (const pin of pins) {
    for (const spec of pin.specs) {
      assert.match(spec, /^\d+\.\d+\.\d+$/, `${pin.name} is pinned at a non-exact spec: ${spec}`);
    }
  }
  assert.ok(
    pins.some((p) => p.registry === 'npm' && p.name === '@supabase/supabase-js'),
    'the supabase-js pin must be reported',
  );
});

test('readImportMaps skips no deno.json on disk', () => {
  const root = path.join(REPO, 'supabase', 'functions');
  const onDisk = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name === 'deno.json') onDisk.push(path.relative(root, path.join(dir, entry.name)));
    }
  };
  walk(root);
  const scanned = readImportMaps(root).map((f) => f.path);
  assert.deepEqual(scanned.sort(), onDisk.sort());
});
