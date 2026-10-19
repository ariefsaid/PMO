import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  canonicalTestIdentity,
  createPlan,
  inventoryDigest,
  normalizePlaywrightList,
  normalizeVitestList,
  projectSafeSummary,
  readUnitShardReports,
  validateUnitShardEvidence,
  validatePartition,
  validateResults,
} from './browser-test-sharding.mjs';

const REVISION = 'a'.repeat(40);
const OTHER_REVISION = 'b'.repeat(40);
const SCRIPT = new URL('./browser-test-sharding.mjs', import.meta.url);
const CONFIG_DIGEST = 'c'.repeat(64);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ROOT = path.join(REPO_ROOT, 'pmo-portal');
const PLAYWRIGHT_CLI = path.join(APP_ROOT, 'node_modules/@playwright/test/cli.js');
const PLAYWRIGHT_FIXTURE_CONFIG = path.join(APP_ROOT, 'test/fixtures/browser-sharding/playwright.config.ts');
const VITEST_CLI = path.join(APP_ROOT, 'node_modules/vitest/vitest.mjs');
const UNIT_SHARD_REPORTER = path.join(APP_ROOT, 'test/unitShardReporter.ts');

function caseEntry(project, file, titlePath, repeatIndex = 0) {
  return { project, file, titlePath, repeatIndex };
}

function inv(tests, options = {}) {
  return {
    schemaVersion: 1,
    revision: options.revision ?? REVISION,
    configDigest: options.configDigest ?? CONFIG_DIGEST,
    mode: options.mode ?? 'ordinary',
    invocation: options.invocation ?? 'fixture-invocation',
    tests: tests.map((entry) => ({ ...entry, titlePath: [...entry.titlePath] })),
  };
}

function playwrightReport({ project = 'chromium', file = 'e2e/AC-BSH-001.spec.ts', titlePath = ['partition', 'works'], repeatIndices = [0], extraConfig = {} } = {}) {
  let nested = {
    title: titlePath.at(-2) ?? '',
    file,
    specs: [{
      title: titlePath.at(-1),
      tests: repeatIndices.map((repeatEachIndex) => ({ projectName: project, repeatEachIndex })),
    }],
  };
  for (let index = titlePath.length - 3; index >= 0; index -= 1) {
    nested = { title: titlePath[index], suites: [nested] };
  }
  return {
    config: {
      version: '1.61.0',
      retries: 0,
      timeout: 30000,
      fullyParallel: false,
      workers: 2,
      projects: [{ name: project, repeatEach: repeatIndices.length }],
      ...extraConfig,
    },
    suites: [{ title: project, suites: [nested] }],
    errors: [],
  };
}

function chromiumTests(names) {
  return names.map((name) => caseEntry('chromium', 'e2e/AC-BSH-001.spec.ts', ['partition', name]));
}

function validPartition() {
  const setup = [caseEntry('setup', 'e2e/auth.setup.ts', ['authenticate'])];
  const full = inv([...setup, ...chromiumTests(['A', 'B', 'C', 'D'])], { invocation: 'chromium-full' });
  const selected = [
    inv([...setup, ...chromiumTests(['A', 'B'])], { invocation: 'chromium-1' }),
    inv([...setup, ...chromiumTests(['C', 'D'])], { invocation: 'chromium-2' }),
  ];
  const tail = {
    serial: inv([...setup, caseEntry('serial', 'e2e/serial/AC-BSH-001.spec.ts', ['serial', 'one'])], { invocation: 'serial' }),
    consent: inv([...setup, caseEntry('consent', 'e2e/AC-CON-003.spec.ts', ['consent', 'one'])], { invocation: 'consent' }),
  };
  const served = inv([...setup, ...chromiumTests(['served-only'])], { mode: 'served', invocation: 'served-smoke' });
  return { full, selected, tail, served };
}

function validManifest() {
  const partition = validPartition();
  return {
    schemaVersion: 1,
    revision: REVISION,
    runId: 'run-39172841168',
    attempt: 2,
    expectedJobs: ['browser-plan', 'browser-chromium', 'browser-tail'],
    partition,
    invocations: [
      { id: 'chromium-1', lane: 'chromium', jobId: 'browser-chromium', mode: 'ordinary', shard: { index: 1, total: 2 }, inventory: partition.selected[0] },
      { id: 'chromium-2', lane: 'chromium', jobId: 'browser-chromium', mode: 'ordinary', shard: { index: 2, total: 2 }, inventory: partition.selected[1] },
      { id: 'serial', lane: 'serial', jobId: 'browser-tail', mode: 'ordinary', shard: null, inventory: partition.tail.serial },
      { id: 'consent', lane: 'consent', jobId: 'browser-tail', mode: 'ordinary', shard: null, inventory: partition.tail.consent },
      { id: 'served-smoke', lane: 'served', jobId: 'browser-tail', mode: 'served', shard: null, inventory: partition.served },
    ],
  };
}

function artifactsFor(plan, overrides = {}) {
  return plan.invocations.map((invocation) => ({
    schemaVersion: 1,
    invocationId: invocation.id,
    jobId: invocation.jobId,
    revision: plan.revision,
    runId: plan.runId,
    attempt: plan.attempt,
    inventoryDigest: invocation.inventoryDigest,
    processOutcome: 'success',
    collectionOutcome: 'complete',
    results: invocation.inventory.tests.map((entry) => ({ ...entry, status: 'passed' })),
    ...overrides[invocation.id],
  }));
}

function jobsFor(plan, overrides = {}) {
  return plan.expectedJobs.map((id) => ({ id, outcome: overrides[id] ?? 'success' }));
}

function codes(result) {
  return result.issues.map((issue) => issue.code);
}

function unitRows(entries) {
  return entries.map(({ project = 'node', file, fullTitle }) => ({
    name: fullTitle,
    file: path.join('/repo', file),
    projectName: project,
  }));
}

function unitInventory(entries, { invocation, shard = null, revision = REVISION } = {}) {
  return normalizeVitestList({
    report: unitRows(entries),
    root: '/repo',
    revision,
    invocation,
    shard,
  });
}

function unitArtifact(inventory, extraTests = []) {
  return {
    schemaVersion: 1,
    shard: inventory.shard,
    collectionOutcome: 'complete',
    runOutcome: 'passed',
    tests: [
      ...inventory.tests.map((entry) => ({ ...entry, titlePath: [entry.fullTitle], mode: 'run', status: 'passed' })),
      ...extraTests,
    ],
  };
}

function validUnitShardEvidence() {
  const entries = [
    { file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'suite > same title' },
    { file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'suite > parameterized 2' },
    { file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'suite > parameterized 3' },
    { file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'suite > node case' },
    { project: 'jsdom', file: 'pmo-portal/test/view cases.test.ts', fullTitle: 'suite > same title' },
    { project: 'jsdom', file: 'pmo-portal/test/view cases.test.ts', fullTitle: 'suite > view case 2' },
    { project: 'jsdom', file: 'pmo-portal/test/view cases.test.ts', fullTitle: 'suite > view case 3' },
    { project: 'jsdom', file: 'pmo-portal/test/view cases.test.ts', fullTitle: 'suite > view case 4' },
  ];
  const full = unitInventory(entries, { invocation: 'unit-full' });
  const shards = [];
  const reports = [];
  for (let index = 1; index <= 4; index += 1) {
    const tests = entries.slice((index - 1) * 2, index * 2);
    const inventory = unitInventory(tests, { invocation: `unit-${index}`, shard: { index, total: 4 } });
    shards.push(inventory);
    reports.push(unitArtifact(inventory));
  }
  return { full, shards, reports };
}

test('AC-BSH-004 proves native Playwright full and shard --list inventories have the same logical config', () => {
  const selectedConfig = {
    sha256: createHash('sha256').update(readFileSync(PLAYWRIGHT_FIXTURE_CONFIG)).digest('hex'),
    lockedPlaywrightVersion: JSON.parse(readFileSync(path.join(APP_ROOT, 'package-lock.json'), 'utf8')).packages['node_modules/@playwright/test'].version,
  };
  const collect = (invocation, shard) => {
    const args = [
      PLAYWRIGHT_CLI,
      'test',
      '--config',
      PLAYWRIGHT_FIXTURE_CONFIG,
      '--list',
      '--reporter=json',
      ...(shard ? [`--shard=${shard}`] : []),
    ];
    const result = spawnSync(process.execPath, args, { cwd: APP_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal((result.stdout + result.stderr).includes('SHARDING_FIXTURE_BODY_SENTINEL'), false);
    return normalizePlaywrightList({
      report: result.stdout,
      mode: 'ordinary',
      revision: REVISION,
      invocation,
      selectedConfig,
    });
  };
  const full = collect('fixture-full', null);
  const first = collect('fixture-shard-1', '1/2');
  const second = collect('fixture-shard-2', '2/2');
  const fullIds = full.tests.map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry }));
  const selectedIds = [...first.tests, ...second.tests].map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry }));

  assert.equal(new Set([...first.tests, ...second.tests].map((entry) => canonicalTestIdentity({ mode: 'ordinary', ...entry }))).size, selectedIds.length);
  assert.deepEqual([...selectedIds].sort(), [...fullIds].sort());
  assert.equal(full.configDigest, first.configDigest);
  assert.equal(full.configDigest, second.configDigest);
  assert.equal(full.configProvenance.projects[0].retries, 0);
  assert.equal(full.configProvenance.projects[0].timeout, 5000);
  assert.deepEqual(full.configProvenance.selectedConfig, { availability: 'available', ...selectedConfig });
  assert.deepEqual(full.configProvenance.projects[0].use, { availability: 'unavailable' });
  assert.equal(full.configProvenance.projects[0].metadata.availability, 'available');
  assert.deepEqual(full.configProvenance.projects[0].metadata.emulation, {
    browserName: 'chromium',
    viewport: { width: 800, height: 600 },
  });
  assert.deepEqual(full.invocationMetadata.nativeShard, null);
  assert.deepEqual(first.invocationMetadata.nativeShard, { index: 1, total: 2 });
  assert.deepEqual(second.invocationMetadata.nativeShard, { index: 2, total: 2 });
  assert.notEqual(full.invocationMetadata.argvDigest, first.invocationMetadata.argvDigest);

  const firstSerial = first.tests.some((entry) => entry.titlePath.at(-1) === 'serial-first');
  const secondSerial = second.tests.some((entry) => entry.titlePath.at(-1) === 'serial-first');
  assert.notEqual(firstSerial, secondSerial, 'serial dependency group must be assigned to exactly one shard');
  const owningShard = firstSerial ? first : second;
  assert.equal(owningShard.tests.some((entry) => entry.titlePath.at(-1) === 'serial-second'), true);
});

test('AC-BSH-001 normalizes Playwright JSON with project, relative file, title path, repeat index, revision, and config digest', () => {
  const report = playwrightReport({ repeatIndices: [0, 1] });
  const inventory = normalizePlaywrightList({ report, mode: 'ordinary', revision: REVISION, invocation: 'chromium-full' });

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.revision, REVISION);
  assert.match(inventory.configDigest, /^[a-f0-9]{64}$/);
  assert.equal(inventory.mode, 'ordinary');
  assert.equal(inventory.invocation, 'chromium-full');
  assert.notEqual(inventory.configDigest, normalizePlaywrightList({
    report: { ...report, config: { ...report.config, workers: 4 } },
    mode: 'ordinary', revision: REVISION, invocation: 'chromium-full',
  }).configDigest);
  assert.notEqual(inventory.configDigest, normalizePlaywrightList({
    report,
    mode: 'ordinary', revision: REVISION, invocation: 'chromium-full',
    selectedConfig: { sha256: 'e'.repeat(64), lockedPlaywrightVersion: '1.61.0' },
  }).configDigest);
  assert.deepEqual(inventory.tests, [
    caseEntry('chromium', 'e2e/AC-BSH-001.spec.ts', ['partition', 'works'], 0),
    caseEntry('chromium', 'e2e/AC-BSH-001.spec.ts', ['partition', 'works'], 1),
  ]);
  assert.equal(canonicalTestIdentity({ mode: 'ordinary', ...inventory.tests[0] }), JSON.stringify(['ordinary', 'chromium', 'e2e/AC-BSH-001.spec.ts', ['partition', 'works'], 0]));
});

test('Task 2 normalizes only Vitest list fields and rejects ambiguous flattened names', () => {
  const report = [
    ...unitRows([
      { file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'data > value 2' },
      { file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'data > value 3' },
      { project: 'jsdom', file: 'pmo-portal/test/view cases.test.ts', fullTitle: 'renders list' },
    ]),
  ];
  const inventory = normalizeVitestList({
    report,
    root: '/repo',
    revision: REVISION,
    invocation: 'unit-full',
    shard: null,
  });

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.runner, 'vitest');
  assert.equal(inventory.revision, REVISION);
  assert.deepEqual(inventory.tests, [
    { project: 'jsdom', file: 'pmo-portal/test/view cases.test.ts', fullTitle: 'renders list', repeatIndex: 0 },
    { project: 'node', file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'data > value 2', repeatIndex: 0 },
    { project: 'node', file: 'pmo-portal/test/unit cases.test.ts', fullTitle: 'data > value 3', repeatIndex: 0 },
  ]);
  assert.throws(
    () => normalizeVitestList({
      report: [
        { name: 'same > title', file: '/repo/pmo-portal/test/unit cases.test.ts', projectName: 'node' },
        { name: 'same > title', file: '/repo/pmo-portal/test/unit cases.test.ts', projectName: 'node' },
      ],
      root: '/repo',
      revision: REVISION,
      invocation: 'unit-ambiguous',
      shard: null,
    }),
    (error) => error.issues?.some((entry) => entry.code === 'AMBIGUOUS_TEST_MAPPING'),
  );
});

test('Task 2 canonicalizes one backslash separator and digest order by codepoint', () => {
  const inventory = normalizeVitestList({
    report: [
      { name: 'case a', file: '/repo/pmo-portal/test/unit\\cases.test.ts', projectName: 'node' },
      { name: 'Case A', file: '/repo/pmo-portal/test/unit\\cases.test.ts', projectName: 'node' },
    ],
    root: '/repo',
    revision: REVISION,
    invocation: 'unit-codepoint-order',
    shard: null,
  });

  // On POSIX, backslash is a filename character; this controls separator canonicalization without asserting Windows path API behavior.
  assert.deepEqual(inventory.tests.map((entry) => entry.file), [
    'pmo-portal/test/unit/cases.test.ts',
    'pmo-portal/test/unit/cases.test.ts',
  ]);
  assert.deepEqual(inventory.tests.map((entry) => entry.fullTitle), ['Case A', 'case a']);
});

test('AC-BSH-006 proves four Vitest inventories and reports form a complete active-test partition', () => {
  const fixture = validUnitShardEvidence();
  const skipped = {
    ...fixture.reports[0].tests[0],
    fullTitle: 'suite > declared skip',
    titlePath: ['suite', 'declared skip'],
    mode: 'skip',
    status: 'skipped',
  };
  const todo = { ...skipped, fullTitle: 'suite > todo declaration', titlePath: ['suite', 'todo declaration'], mode: 'todo' };
  fixture.reports[0].tests.push(skipped, todo);

  assert.deepEqual(validateUnitShardEvidence(fixture), { ok: true, issues: [] });
  assert.equal(fixture.reports[0].tests.some((entry) => entry.mode === 'skip' && entry.status === 'skipped'), true);
  assert.equal(fixture.reports[0].tests.some((entry) => entry.mode === 'todo' && entry.status === 'skipped'), true);

  const missing = validateUnitShardEvidence({ ...fixture, reports: fixture.reports.slice(0, 3) });
  assert.equal(missing.ok, false);
  assert.ok(codes(missing).includes('MISSING_UNIT_SHARD_REPORT'));
});

test('Task 2 fails closed when one of the four Vitest shard artifact files is absent', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unit shard reports '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = validUnitShardEvidence();
  for (const [index, artifact] of fixture.reports.slice(0, 3).entries()) {
    await writeFile(path.join(dir, `unit-shard-${index + 1}-of-4.json`), JSON.stringify(artifact));
  }

  await assert.rejects(
    readUnitShardReports(dir),
    (error) => error.issues?.some((entry) => entry.code === 'MISSING_UNIT_SHARD_REPORT'),
  );
  await writeFile(path.join(dir, 'unit-shard-4-of-4.json'), JSON.stringify(fixture.reports[3]));
  assert.equal((await readUnitShardReports(dir)).length, 4);
});

test('Task 2 collects active Vitest JSON and proves the typed reporter retains skips and todos', async (t) => {
  const dir = await mkdtemp(path.join(APP_ROOT, 'test/.unit-shard-reporter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'alpha project'), { recursive: true });
  await mkdir(path.join(dir, 'beta'), { recursive: true });
  await writeFile(path.join(dir, 'alpha project/alpha cases.test.ts'), `
    import { describe, test, expect } from 'vitest';
    describe('data set', () => {
      test.each([{ value: 2 }, { value: 3 }])('parameterized $value', ({ value }) => expect(value).toBeGreaterThan(0));
      test('Case A', () => expect(true).toBe(true));
      test('case a', () => expect(true).toBe(true));
      test.skip('declared skip', () => { throw new Error('skip body ran'); });
      test.todo('todo declaration');
      test('dynamic skip', ({ skip }) => skip());
    });
  `);
  await writeFile(path.join(dir, 'beta/beta cases.test.ts'), `
    import { test, expect } from 'vitest';
    test('shared display title', () => expect(true).toBe(true));
  `);
  await writeFile(path.join(dir, 'alpha project/alpha extra.test.ts'), `
    import { test, expect } from 'vitest';
    test('extra alpha active', () => expect(true).toBe(true));
  `);
  await writeFile(path.join(dir, 'beta/beta extra.test.ts'), `
    import { test, expect } from 'vitest';
    test('extra beta active', () => expect(true).toBe(true));
  `);
  const relative = path.relative(APP_ROOT, dir).replaceAll('\\', '/');
  const config = path.join(dir, 'vitest.fixture.config.ts');
  await writeFile(config, `
    import { defineConfig } from 'vitest/config';
    export default defineConfig({
      root: ${JSON.stringify(APP_ROOT)},
      test: { projects: [
        { extends: true, test: { name: 'node', environment: 'node', include: [${JSON.stringify(`${relative}/alpha project/*.test.ts`)}] } },
        { extends: true, test: { name: 'jsdom', environment: 'node', include: [${JSON.stringify(`${relative}/beta/*.test.ts`)}] } },
      ] },
    });
  `);

  const list = (invocation, shard) => {
    const args = [VITEST_CLI, 'list', '--config', config, '--json'];
    if (shard) args.push(`--shard=${shard.index}/${shard.total}`);
    const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes('skip body ran'), false);
    try {
      return normalizeVitestList({
        report: result.stdout,
        root: APP_ROOT,
        revision: REVISION,
        invocation,
        shard,
      });
    } catch (error) {
      throw new Error(`${invocation}: ${JSON.stringify(error.issues ?? [])}`, { cause: error });
    }
  };
  const active = list('unit-full', null);
  const activeShards = Array.from({ length: 4 }, (_, offset) => list(`unit-shard-${offset + 1}`, { index: offset + 1, total: 4 }));
  assert.equal(active.tests.length, 8);
  assert.equal(active.tests.some((entry) => entry.fullTitle.includes('parameterized 2')), true);
  assert.equal(active.tests.some((entry) => entry.fullTitle.includes('parameterized 3')), true);
  assert.equal(active.tests.some((entry) => entry.fullTitle.includes('declared skip')), false);
  assert.equal(active.tests.some((entry) => entry.fullTitle.includes('todo declaration')), false);
  assert.ok(active.tests.some((entry) => entry.file.includes('alpha project/alpha cases.test.ts')));
  const activeIdentity = (entry) => JSON.stringify([entry.project, entry.file, entry.fullTitle, entry.repeatIndex]);
  const fullActiveIds = active.tests.map(activeIdentity).sort();
  const shardedActiveIds = activeShards.flatMap((inventory) => inventory.tests.map(activeIdentity));
  assert.equal(new Set(shardedActiveIds).size, shardedActiveIds.length, 'native Vitest shards must be disjoint');
  assert.deepEqual([...shardedActiveIds].sort(), fullActiveIds, 'native Vitest shard lists must cover the full active list');

  const artifacts = [];
  for (const shard of Array.from({ length: 4 }, (_, offset) => ({ index: offset + 1, total: 4 }))) {
    const blobPath = path.join(dir, `vitest-blob-${shard.index}.json`);
    const ran = spawnSync(process.execPath, [
      VITEST_CLI,
      'run',
      '--config',
      config,
      '--reporter=default',
      '--reporter=blob',
      `--reporter=${UNIT_SHARD_REPORTER}`,
      `--outputFile.blob=${blobPath}`,
      `--shard=${shard.index}/${shard.total}`,
    ], { cwd: dir, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const artifact = JSON.parse(await readFile(path.join(dir, `unit-shard-${shard.index}-of-${shard.total}.json`), 'utf8'));
    assert.deepEqual(artifact.shard, shard);
    assert.equal(artifact.collectionOutcome, 'complete');
    assert.equal(artifact.runOutcome, 'passed');
    artifacts.push(artifact);
  }
  const reportedResults = artifacts.flatMap((artifact) => artifact.tests);
  assert.equal(reportedResults.length, 10);
  assert.equal(reportedResults.some((entry) => entry.mode === 'skip' && entry.status === 'skipped'), true);
  assert.equal(reportedResults.some((entry) => entry.mode === 'todo' && entry.status === 'skipped'), true);
  assert.equal(reportedResults.some((entry) => entry.mode === 'run' && entry.status === 'skipped'), true);
  const actualActiveIds = reportedResults
    .filter((entry) => entry.mode === 'run' || entry.mode === 'only')
    .map(activeIdentity);
  for (const artifact of artifacts) {
    const artifactIds = artifact.tests.map((entry) => JSON.stringify([entry.project, entry.file, entry.fullTitle, entry.repeatIndex]));
    assert.deepEqual(artifactIds, [...artifactIds].sort(), 'typed reporter shard output order must be codepoint-stable');
  }
  const caseVariantArtifact = artifacts.find((artifact) => artifact.tests.some((entry) => entry.fullTitle === 'data set > Case A'));
  assert.deepEqual(caseVariantArtifact.tests.filter((entry) => entry.fullTitle === 'data set > Case A' || entry.fullTitle === 'data set > case a').map((entry) => entry.fullTitle), [
    'data set > Case A',
    'data set > case a',
  ]);
  assert.equal(new Set(actualActiveIds).size, actualActiveIds.length, 'native Vitest shard results must be disjoint');
  assert.deepEqual([...actualActiveIds].sort(), fullActiveIds, 'native active results must match the full active list');

  await writeFile(path.join(dir, 'beta/reporter failure.test.ts'), `
    import { test } from 'vitest';
    test('failed run still writes evidence', () => { throw new Error('fixture failure'); });
  `);
  const failed = spawnSync(process.execPath, [
    VITEST_CLI,
    'run',
    '--config',
    config,
    '--reporter=default',
    '--reporter=blob',
    `--reporter=${UNIT_SHARD_REPORTER}`,
    `--outputFile.blob=${path.join(dir, 'vitest-blob-failed.json')}`,
    '--shard=1/1',
  ], { cwd: dir, encoding: 'utf8' });
  assert.equal(failed.status, 1, 'fixture is intentionally failing to exercise reporter cleanup');
  const failedArtifact = JSON.parse(await readFile(path.join(dir, 'unit-shard-1-of-1.json'), 'utf8'));
  assert.equal(failedArtifact.collectionOutcome, 'complete');
  assert.equal(failedArtifact.runOutcome, 'failed');
  assert.ok(failedArtifact.tests.some((entry) => entry.fullTitle === 'failed run still writes evidence' && entry.status === 'failed'));
});

test('AC-BSH-001 rejects absolute, traversal, and control-character source paths', () => {
  for (const file of ['/tmp/private.spec.ts', '../outside.spec.ts', 'e2e/../outside.spec.ts', 'e2e/bad\nname.spec.ts', 'C:\\outside.spec.ts']) {
    assert.throws(
      () => normalizePlaywrightList({ report: playwrightReport({ file }), mode: 'ordinary', revision: REVISION, invocation: 'chromium-full' }),
      (error) => error.issues?.some((issue) => issue.code === 'INVALID_PATH'),
      'invalid path must be rejected without echoing its value',
    );
  }
});

test('AC-BSH-001 requires explicit repeat indexes when the config declares repeated runs', () => {
  const report = playwrightReport({ repeatIndices: [0] });
  report.config.projects[0].repeatEach = 2;
  delete report.suites[0].suites[0].specs[0].tests[0].repeatEachIndex;
  assert.throws(
    () => normalizePlaywrightList({ report, mode: 'ordinary', revision: REVISION, invocation: 'chromium-full' }),
    (error) => error.issues?.some((entry) => entry.code === 'MISSING_REPEAT_INDEX'),
  );
});

test('AC-BSH-001 accepts exact disjoint A/B and C/D shards, preserves setup multiplicity, tail lanes, and served mode', () => {
  const result = validatePartition(validPartition());
  assert.deepEqual(result, { ok: true, issues: [] });
});

test('AC-BSH-001 reports the exact missing-case issue for a missing D', () => {
  const fixture = validPartition();
  fixture.selected[1] = inv(fixture.selected[1].tests.filter((entry) => entry.titlePath[1] !== 'D'), { invocation: 'chromium-2' });
  const result = validatePartition(fixture);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['MISSING_TEST']);
});

test('AC-BSH-001 reports the exact duplicate identity issue for B in both shards', () => {
  const fixture = validPartition();
  fixture.selected[1].tests.push(chromiumTests(['B'])[0]);
  const result = validatePartition(fixture);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['DUPLICATE_SELECTED_IDENTITY']);
});

test('AC-BSH-001 reports the exact extra-case issue for E', () => {
  const fixture = validPartition();
  fixture.selected[1].tests.push(chromiumTests(['E'])[0]);
  const result = validatePartition(fixture);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['EXTRA_TEST']);
});

test('AC-BSH-001 reports an empty requested shard', () => {
  const fixture = validPartition();
  fixture.selected[0] = inv([], { invocation: 'chromium-1' });
  const result = validatePartition(fixture);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['EMPTY_SHARD', 'MISSING_TEST', 'SETUP_MULTIPLICITY_MISMATCH']);
});

test('AC-BSH-001 rejects unknown projects in every inventory', () => {
  const fixture = validPartition();
  fixture.selected[0].tests.push(caseEntry('mystery', 'e2e/unknown.spec.ts', ['unknown']));
  const result = validatePartition(fixture);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['UNKNOWN_PROJECT']);
});

test('AC-BSH-001 rejects mismatched revision and configuration digests', () => {
  const revisionFixture = validPartition();
  revisionFixture.selected[1] = inv(revisionFixture.selected[1].tests, { invocation: 'chromium-2', revision: OTHER_REVISION });
  const revisionResult = validatePartition(revisionFixture);
  assert.equal(revisionResult.ok, false);
  assert.deepEqual(codes(revisionResult), ['REVISION_MISMATCH']);

  const configFixture = validPartition();
  configFixture.selected[1] = inv(configFixture.selected[1].tests, { invocation: 'chromium-2', configDigest: 'd'.repeat(64) });
  const configResult = validatePartition(configFixture);
  assert.equal(configResult.ok, false);
  assert.deepEqual(codes(configResult), ['CONFIG_DIGEST_MISMATCH']);
});

test('AC-BSH-001 rejects duplicate identities in the full denominator and setup count drift', () => {
  const duplicateFixture = validPartition();
  duplicateFixture.full.tests.push(chromiumTests(['A'])[0]);
  const duplicateResult = validatePartition(duplicateFixture);
  assert.equal(duplicateResult.ok, false);
  assert.deepEqual(codes(duplicateResult), ['DUPLICATE_FULL_IDENTITY']);

  const setupFixture = validPartition();
  setupFixture.selected[1].tests = setupFixture.selected[1].tests.filter((entry) => entry.project !== 'setup');
  const setupResult = validatePartition(setupFixture);
  assert.equal(setupResult.ok, false);
  assert.deepEqual(codes(setupResult), ['SETUP_MULTIPLICITY_MISMATCH']);
});

test('AC-BSH-002 accepts exact results and a represented ordinary test skip', () => {
  const plan = createPlan(validManifest());
  const artifacts = artifactsFor(plan);
  const chromiumArtifact = artifacts.find((artifact) => artifact.invocationId === 'chromium-1');
  chromiumArtifact.results.find((entry) => entry.project === 'chromium').status = 'skipped';
  const result = validateResults({ plan, artifacts, jobs: jobsFor(plan) });

  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.deepEqual(codes(result), []);
  assert.equal(result.counts.expectedCases, result.counts.reportedCases);
  assert.equal(result.counts.skipped, 1);
});

test('plan construction binds exact execution invocations and shard inventories to the partition proof', () => {
  const manifest = validManifest();
  const plan = createPlan(manifest);
  assert.equal(plan.invocations.length, 5);

  const altered = validManifest();
  altered.invocations[0].inventory = inv(chromiumTests(['A', 'B', 'C']), { invocation: 'chromium-1' });
  assert.throws(
    () => createPlan(altered),
    (error) => error.issues?.some((entry) => entry.code === 'PARTITION_INVOCATION_MISMATCH' && entry.invocationId === 'chromium-1'),
  );
});

test('AC-BSH-002 rejects every non-success expected job outcome', () => {
  const plan = createPlan(validManifest());
  for (const outcome of ['failure', 'skipped', 'cancelled', 'timeout', 'unknown']) {
    const result = validateResults({ plan, artifacts: artifactsFor(plan), jobs: jobsFor(plan, { 'browser-chromium': outcome }) });
    assert.equal(result.ok, false, outcome);
    assert.equal(result.complete, false, outcome);
    assert.deepEqual(codes(result), ['JOB_NOT_SUCCESS'], outcome);
  }
});

test('AC-BSH-002 rejects failed, skipped, cancelled, timed-out, and unknown invocation outcomes', () => {
  const plan = createPlan(validManifest());
  for (const outcome of ['failure', 'skipped', 'cancelled', 'timeout', 'unknown']) {
    const artifacts = artifactsFor(plan, { 'chromium-1': { processOutcome: outcome } });
    const result = validateResults({ plan, artifacts, jobs: jobsFor(plan) });
    assert.equal(result.ok, false, outcome);
    assert.equal(result.complete, false, outcome);
    assert.deepEqual(codes(result), ['ARTIFACT_PROCESS_NOT_SUCCESS'], outcome);
  }
});

test('AC-BSH-002 rejects failed test cases and stale artifact revision or inventory metadata', () => {
  const plan = createPlan(validManifest());
  const failedCaseArtifacts = artifactsFor(plan);
  failedCaseArtifacts[0].results.find((entry) => entry.project === 'chromium').status = 'failed';
  const failedCase = validateResults({ plan, artifacts: failedCaseArtifacts, jobs: jobsFor(plan) });
  assert.equal(failedCase.ok, false);
  assert.equal(failedCase.complete, false);
  assert.deepEqual(codes(failedCase), ['FAILED_RESULT']);

  const staleRevisionArtifacts = artifactsFor(plan, { 'chromium-1': { revision: OTHER_REVISION } });
  const staleRevision = validateResults({ plan, artifacts: staleRevisionArtifacts, jobs: jobsFor(plan) });
  assert.equal(staleRevision.ok, false);
  assert.deepEqual(codes(staleRevision), ['STALE_REVISION']);

  const wrongDigestArtifacts = artifactsFor(plan, { 'chromium-1': { inventoryDigest: 'e'.repeat(64) } });
  const wrongDigest = validateResults({ plan, artifacts: wrongDigestArtifacts, jobs: jobsFor(plan) });
  assert.equal(wrongDigest.ok, false);
  assert.deepEqual(codes(wrongDigest), ['INVENTORY_DIGEST_MISMATCH']);
});

test('AC-BSH-002 rejects missing jobs and missing, duplicate, or stale artifacts', () => {
  const plan = createPlan(validManifest());
  const good = artifactsFor(plan);
  const noJob = validateResults({ plan, artifacts: good, jobs: jobsFor(plan).filter((job) => job.id !== 'browser-tail') });
  assert.equal(noJob.ok, false);
  assert.deepEqual(codes(noJob), ['MISSING_JOB']);

  const noArtifact = validateResults({ plan, artifacts: good.filter((artifact) => artifact.invocationId !== 'chromium-2'), jobs: jobsFor(plan) });
  assert.equal(noArtifact.ok, false);
  assert.deepEqual(codes(noArtifact), ['MISSING_ARTIFACT']);

  const duplicateArtifact = validateResults({ plan, artifacts: [...good, { ...good[0] }], jobs: jobsFor(plan) });
  assert.equal(duplicateArtifact.ok, false);
  assert.deepEqual(codes(duplicateArtifact), ['DUPLICATE_ARTIFACT']);

  const staleArtifact = validateResults({ plan, artifacts: good.map((artifact) => artifact.invocationId === 'chromium-1' ? { ...artifact, attempt: 1 } : artifact), jobs: jobsFor(plan) });
  assert.equal(staleArtifact.ok, false);
  assert.deepEqual(codes(staleArtifact), ['STALE_RUN_ATTEMPT']);
});

test('AC-BSH-002 rejects missing, extra, duplicate, and unexecuted test results', () => {
  const plan = createPlan(validManifest());
  const mutate = (change) => {
    const artifacts = artifactsFor(plan);
    change(artifacts.find((artifact) => artifact.invocationId === 'chromium-1'));
    return validateResults({ plan, artifacts, jobs: jobsFor(plan) });
  };

  const missing = mutate((artifact) => { artifact.results.pop(); });
  assert.equal(missing.ok, false);
  assert.deepEqual(codes(missing), ['MISSING_RESULT']);

  const extra = mutate((artifact) => { artifact.results.push({ ...chromiumTests(['E'])[0], status: 'passed' }); });
  assert.equal(extra.ok, false);
  assert.deepEqual(codes(extra), ['EXTRA_RESULT']);

  const duplicate = mutate((artifact) => { artifact.results.push({ ...artifact.results[0] }); });
  assert.equal(duplicate.ok, false);
  assert.deepEqual(codes(duplicate), ['DUPLICATE_RESULT']);

  const unexecuted = mutate((artifact) => { artifact.results[0].status = 'not_run'; });
  assert.equal(unexecuted.ok, false);
  assert.deepEqual(codes(unexecuted), ['UNEXECUTED_RESULT']);
});

test('AC-BSH-002 keeps a failed attempt fatal when another artifact reports a pass', () => {
  const plan = createPlan(validManifest());
  const artifacts = artifactsFor(plan);
  artifacts[0].processOutcome = 'failure';
  const passedLater = { ...artifacts[0], processOutcome: 'success' };
  const result = validateResults({ plan, artifacts: [...artifacts, passedLater], jobs: jobsFor(plan) });

  assert.equal(result.ok, false);
  assert.equal(result.complete, false);
  assert.deepEqual(codes(result), ['ARTIFACT_PROCESS_NOT_SUCCESS', 'DUPLICATE_ARTIFACT']);
});

test('AC-BSH-002 rejects malformed artifact objects and unrecognized metadata', () => {
  const plan = createPlan(validManifest());
  const artifacts = artifactsFor(plan);
  artifacts[0] = { invocationId: 'chromium-1', rawBody: 'PRIVATE_BODY_SENTINEL' };
  const result = validateResults({ plan, artifacts, jobs: jobsFor(plan) });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['INVALID_ARTIFACT']);
});

test('safe summary contains only approved fields and excludes raw output, bodies, sessions, and absolute paths', () => {
  const plan = createPlan(validManifest());
  const artifacts = artifactsFor(plan, {
    'chromium-1': {
      stdout: 'PRIVATE_STDOUT_SENTINEL',
      stderr: 'PRIVATE_STDERR_SENTINEL',
      attachments: ['PRIVATE_ATTACHMENT_SENTINEL'],
      body: 'PRIVATE_BODY_SENTINEL',
      session: 'PRIVATE_SESSION_SENTINEL',
      absolutePath: '/private/PRIVATE_PATH_SENTINEL',
    },
  });
  const result = validateResults({ plan, artifacts, jobs: jobsFor(plan) });
  const summary = projectSafeSummary({ plan, result });
  const serialized = JSON.stringify(summary);

  assert.deepEqual(Object.keys(summary).sort(), ['complete', 'counts', 'issueCodes', 'lane', 'outcomes', 'revision', 'schemaVersion', 'shard'].sort());
  for (const sentinel of ['PRIVATE_STDOUT_SENTINEL', 'PRIVATE_STDERR_SENTINEL', 'PRIVATE_ATTACHMENT_SENTINEL', 'PRIVATE_BODY_SENTINEL', 'PRIVATE_SESSION_SENTINEL', 'PRIVATE_PATH_SENTINEL']) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
});

test('CLI plan/check succeeds with filenames containing spaces and writes a safe summary', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser sharding CLI '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'manifest input.json');
  const planPath = path.join(root, 'planned inventory.json');
  const resultsPath = path.join(root, 'result artifacts');
  const jobsPath = path.join(root, 'job outcomes.json');
  const summaryPath = path.join(root, 'safe summary.json');
  const manifest = validManifest();
  await writeFile(inputPath, JSON.stringify(manifest));

  const planned = spawnSync(process.execPath, [SCRIPT.pathname, 'plan', '--input', inputPath, '--output', planPath], { encoding: 'utf8' });
  assert.equal(planned.status, 0, planned.stderr || planned.stdout);
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  assert.deepEqual(plan.invocations.map((entry) => entry.id), manifest.invocations.map((entry) => entry.id));
  assert.equal(plan.runId, manifest.runId);
  assert.equal(plan.attempt, manifest.attempt);
  assert.equal(plan.revision, manifest.revision);
  for (const entry of plan.invocations) assert.equal(entry.inventoryDigest, inventoryDigest(entry.inventory));

  await mkdir(resultsPath);
  for (const artifact of artifactsFor(plan)) await writeFile(path.join(resultsPath, artifact.invocationId + '.json'), JSON.stringify(artifact));
  await writeFile(jobsPath, JSON.stringify({ jobs: jobsFor(plan) }));
  const checked = spawnSync(process.execPath, [SCRIPT.pathname, 'check', '--plan', planPath, '--results', resultsPath, '--jobs', jobsPath, '--summary', summaryPath], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  const summaryText = await readFile(summaryPath, 'utf8');
  const summary = JSON.parse(summaryText);
  assert.equal(summary.complete, true);
  assert.equal(summary.revision, REVISION);
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.issueCodes.length, 0);
});

test('CLI reports malformed JSON and unreadable artifact entries as incomplete evidence', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser sharding malformed '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = createPlan(validManifest());
  const planPath = path.join(root, 'plan.json');
  const resultsPath = path.join(root, 'results');
  const jobsPath = path.join(root, 'jobs.json');
  const summaryPath = path.join(root, 'summary.json');
  await writeFile(planPath, JSON.stringify(plan));
  await mkdir(resultsPath);
  await writeFile(path.join(resultsPath, 'chromium-1.json'), '{ malformed');
  await mkdir(path.join(resultsPath, 'chromium-2.json'));
  for (const artifact of artifactsFor(plan).slice(2)) await writeFile(path.join(resultsPath, artifact.invocationId + '.json'), JSON.stringify(artifact));
  await writeFile(jobsPath, JSON.stringify({ jobs: jobsFor(plan) }));

  const checked = spawnSync(process.execPath, [SCRIPT.pathname, 'check', '--plan', planPath, '--results', resultsPath, '--jobs', jobsPath, '--summary', summaryPath], { encoding: 'utf8' });
  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.issueCodes, ['MALFORMED_JSON', 'MALFORMED_JSON']);
});

test('CLI rejects invalid usage and safely diagnoses an unwritable summary path', async (t) => {
  const invalid = spawnSync(process.execPath, [SCRIPT.pathname], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stdout, /INVALID_USAGE/);

  const root = await mkdtemp(path.join(os.tmpdir(), 'browser sharding summary '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = createPlan(validManifest());
  const planPath = path.join(root, 'plan.json');
  const resultsPath = path.join(root, 'results');
  const jobsPath = path.join(root, 'jobs.json');
  const impossibleSummary = path.join(root, 'missing-parent', 'summary.json');
  await writeFile(planPath, JSON.stringify(plan));
  await mkdir(resultsPath);
  for (const artifact of artifactsFor(plan)) await writeFile(path.join(resultsPath, artifact.invocationId + '.json'), JSON.stringify(artifact));
  await writeFile(jobsPath, JSON.stringify({ jobs: jobsFor(plan) }));

  const checked = spawnSync(process.execPath, [SCRIPT.pathname, 'check', '--plan', planPath, '--results', resultsPath, '--jobs', jobsPath, '--summary', impossibleSummary], { encoding: 'utf8' });
  assert.equal(checked.status, 2);
  assert.match(checked.stdout, /SUMMARY_WRITE_FAILED/);
  assert.equal(checked.stdout.includes(impossibleSummary), false);
});
