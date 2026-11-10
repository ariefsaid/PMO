#!/usr/bin/env node
// CI test scope (#1584): decide which test layers a PR to `dev` can affect.
//
//   node scripts/ci-test-scope.mjs --base origin/dev   → {"unit":"full"|"affected","pgtap":bool,"deno":bool,"reason":"…"}
//   node scripts/ci-test-scope.mjs --release-please --target-base main --head-branch <name> --base origin/main
//   node scripts/ci-test-scope.mjs --fs-coupled        → vitest test files that read repo files (one per line)
//   node scripts/ci-test-scope.mjs --self-test
//
// WHY "affected" is safe: `vitest --changed` selects tests through the module graph. The graph is
// blind to (a) config/setup/infra files, (b) files a test reads with fs instead of importing,
// (c) deleted modules (the importer is gone from the graph). (a) and (c) fall back to the full
// suite here; (b) is closed by always running every fs-coupled test (`--fs-coupled`). Anything
// else this misses is caught by the full suite on the push to `dev`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Measured on 34 recent merged PRs to dev (2026-10-31; the last 80 had median 20 changed files, p75 69,
// p90 137): up to 60 files the affected set is median 158 of ~1,410 test files (p75 ~590, a few
// high-fan-out files); above 60 it is 650-760 (~50%), where one job is no faster than two shards.
export const FILE_THRESHOLD = 60;

const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Paths the Vitest module graph cannot see (setup files are added from vite.config.ts at run time).
const UNIT_FULL = [
  /^pmo-portal\/(vite|vitest)[^/]*\.config\.[cm]?[jt]s$/,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^pmo-portal\/\.node-version$/,
  /(^|\/)__mocks__\//,
  /^pmo-portal\/(src\/)?test\/(?!.*\.(test|spec)\.)/, // test helpers/fixtures/setup fan out to most tests
  // NOT public/locales: catalogues are fetched JSON that no test imports, so the only readers are
  // fs-reading tests, and those always run (fsCoupledTests). A self-test pins that assumption.
  /^\.github\/workflows\/ci\.yml$/,
  /^scripts\/ci-test-scope\.mjs$/,
];
// Everything the `pgtap` job runs besides `supabase/**` itself.
const PGTAP = [
  /^supabase\//,
  /^scripts\/(check-migration-collisions\.sh|check-project-short-name-reversal\.mjs|check-isolation-denominator\.mjs|isolation-probe-denominator\.json|with-db-lock\.sh)$/,
  /^scripts\/financial-statements-[\w-]+\.test\.mjs$/,
  // The rollback harness the pgtap job runs (AC-CQ-003) and the pgTAP template it expands.
  /^scripts\/(test-contract-quantities-rollback\.sh|contract-quantities-rollback\.test\.sql)$/,
  /^scripts\/(test-plan-limits-rollback\.sh|plan-limits-rollback\.test\.sql)$/,
  /^scripts\/lib\/flock-run\.sh$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^scripts\/ci-test-scope\.mjs$/,
];
const DENO = [
  /^supabase\/functions\//,
  /^scripts\/(deno-[\w.-]+|m365-record-folder-write-mutation\.mjs)$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^scripts\/ci-test-scope\.mjs$/,
];

const any = (res, p) => res.some((re) => re.test(p));

/**
 * Pure rule engine.
 * @param {{status: string, path: string}[]} changes `git diff --name-status --no-renames` entries
 * @param {{setupFiles?: string[], edgeImports?: Set<string>, threshold?: number}} ctx
 */
export function scope(changes, { setupFiles = [], edgeImports = new Set(), threshold = FILE_THRESHOLD } = {}) {
  const paths = changes.map((c) => c.path);
  const reasons = [];
  const full = (why) => reasons.push(why);

  const hit = paths.find((p) => any(UNIT_FULL, p) || setupFiles.includes(p));
  if (hit) full(`${hit} is invisible to the module graph`);
  const gone = changes.find(
    (c) => c.status === 'D' && !TEST_RE.test(c.path) && /^(pmo-portal|supabase\/functions)\//.test(c.path),
  );
  if (gone) full(`${gone.path} deleted (importers leave the graph)`);
  if (paths.length > threshold) full(`${paths.length} files > ${threshold}`);

  const edge = paths.find((p) => edgeImports.has(p));
  return {
    unit: reasons.length ? 'full' : 'affected',
    pgtap: paths.some((p) => any(PGTAP, p)),
    deno: paths.some((p) => any(DENO, p)) || Boolean(edge),
    reason: reasons.join('; ') || `${paths.length} files, module graph covers them`,
  };
}

const RELEASE_PLEASE_FILES = [
  '.release-please-manifest.json',
  'pmo-portal/CHANGELOG.md',
  'pmo-portal/package.json',
  'pmo-portal/package-lock.json',
];
const RELEASE_PLEASE_ALLOWED = new Set(RELEASE_PLEASE_FILES);
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fullReleasePlease(reason) {
  return { unit: 'full', pgtap: true, deno: true, releaseLight: false, reason };
}

function parseJsonFile(files, name) {
  if (!files || typeof files[name] !== 'string' || files[name].trim() === '') throw new Error('missing file');
  return JSON.parse(files[name]);
}

function topLevelVersion(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.version === 'string'
    ? value.version
    : null;
}

function packageLockRootVersion(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return null;
  if (!Object.hasOwn(lock, 'packages')) return topLevelVersion(lock);
  const packages = lock.packages;
  return packages && typeof packages === 'object' && !Array.isArray(packages)
    ? topLevelVersion(packages[''])
    : null;
}

function withoutPackageVersion(value, lockfile = false) {
  const { version: _topLevelVersion, ...rest } = value;
  if (!lockfile || !Object.hasOwn(value, 'packages')) return rest;
  const packages = value.packages;
  const { version: _rootPackageVersion, ...rootPackage } = packages[''];
  return { ...rest, packages: { ...packages, '': rootPackage } };
}

function changelogVersion(changelog) {
  if (typeof changelog !== 'string') return null;
  const heading = changelog.split(/\r?\n/).find((line) => line.startsWith('## '));
  return heading?.match(/^## \[([^\]]+)\]/)?.[1] ?? null;
}

/**
 * Classify the deliberately narrow release-please fast path. Any missing or uncertain input falls
 * back to the full CI lanes. JSON is compared as parsed data with only the package version fields
 * removed (including package-lock's root package record), so formatting/key order is immaterial and
 * nested dependency edits remain visible.
 */
export function classifyReleasePlease({
  targetBase,
  headBranch,
  changes,
  diffMetadataClean,
  baseFiles,
  headFiles,
} = {}) {
  if (targetBase !== 'main') return fullReleasePlease('target is not main');
  if (typeof headBranch !== 'string' || !headBranch.startsWith('release-please--')) {
    return fullReleasePlease('head branch is not release-please generated');
  }
  if (diffMetadataClean !== true) return fullReleasePlease('diff metadata is uncertain');
  if (!Array.isArray(changes) || changes.length === 0) return fullReleasePlease('diff is empty or unavailable');
  const seen = new Set();
  for (const change of changes) {
    if (!change || change.status !== 'M' || typeof change.path !== 'string' || !RELEASE_PLEASE_ALLOWED.has(change.path)) {
      return fullReleasePlease('diff contains an unexpected or renamed path');
    }
    if (seen.has(change.path)) return fullReleasePlease('diff contains duplicate paths');
    seen.add(change.path);
  }

  let manifest;
  let baseManifest;
  let basePackage;
  let headPackage;
  let baseLock;
  let headLock;
  try {
    manifest = parseJsonFile(headFiles, '.release-please-manifest.json');
    baseManifest = parseJsonFile(baseFiles, '.release-please-manifest.json');
    basePackage = parseJsonFile(baseFiles, 'pmo-portal/package.json');
    headPackage = parseJsonFile(headFiles, 'pmo-portal/package.json');
    baseLock = parseJsonFile(baseFiles, 'pmo-portal/package-lock.json');
    headLock = parseJsonFile(headFiles, 'pmo-portal/package-lock.json');
    if (typeof baseFiles['pmo-portal/CHANGELOG.md'] !== 'string' || baseFiles['pmo-portal/CHANGELOG.md'].trim() === '' ||
        typeof headFiles['pmo-portal/CHANGELOG.md'] !== 'string' || headFiles['pmo-portal/CHANGELOG.md'].trim() === '') {
      throw new Error('missing changelog');
    }
  } catch {
    return fullReleasePlease('an expected release file is missing or malformed');
  }

  const manifestVersion = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest['pmo-portal']
    : null;
  const baseManifestVersion = baseManifest && typeof baseManifest === 'object' && !Array.isArray(baseManifest)
    ? baseManifest['pmo-portal']
    : null;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      !baseManifest || typeof baseManifest !== 'object' || Array.isArray(baseManifest)) {
    return fullReleasePlease('release manifest is not a JSON object');
  }
  const { 'pmo-portal': _baseManifestVersion, ...baseManifestWithoutVersion } = baseManifest;
  const { 'pmo-portal': _headManifestVersion, ...headManifestWithoutVersion } = manifest;
  if (!isDeepStrictEqual(baseManifestWithoutVersion, headManifestWithoutVersion)) {
    return fullReleasePlease('release manifest contains a non-version edit');
  }
  const packageVersion = topLevelVersion(headPackage);
  const lockVersion = topLevelVersion(headLock);
  const lockRootPackageVersion = packageLockRootVersion(headLock);
  const headingVersion = changelogVersion(headFiles['pmo-portal/CHANGELOG.md']);
  if (![manifestVersion, packageVersion, lockVersion, lockRootPackageVersion, headingVersion].every((version) => typeof version === 'string' && RELEASE_VERSION.test(version))) {
    return fullReleasePlease('release version is missing or malformed');
  }
  if (new Set([manifestVersion, packageVersion, lockVersion, lockRootPackageVersion, headingVersion]).size !== 1) {
    return fullReleasePlease('release versions do not agree');
  }

  const baseLockRootPackageVersion = packageLockRootVersion(baseLock);
  const previousVersions = [baseManifestVersion, topLevelVersion(basePackage), topLevelVersion(baseLock), baseLockRootPackageVersion];
  if (!previousVersions.every((version) => typeof version === 'string' && RELEASE_VERSION.test(version))) {
    return fullReleasePlease('base package-lock root version is missing or malformed');
  }
  if (previousVersions.every((version) => version === manifestVersion)) {
    return fullReleasePlease('release version is unchanged');
  }
  for (const [before, after, isLockfile] of [[basePackage, headPackage, false], [baseLock, headLock, true]]) {
    if (!before || typeof before !== 'object' || Array.isArray(before) || !after || typeof after !== 'object' || Array.isArray(after)) {
      return fullReleasePlease('package metadata is not a JSON object');
    }
    if (topLevelVersion(before) === null || topLevelVersion(after) === null) {
      return fullReleasePlease('package version field is missing');
    }
    if (isLockfile && (packageLockRootVersion(before) === null || packageLockRootVersion(after) === null)) {
      return fullReleasePlease('package-lock root package version is missing');
    }
    const beforeWithoutVersion = withoutPackageVersion(before, isLockfile);
    const afterWithoutVersion = withoutPackageVersion(after, isLockfile);
    if (!isDeepStrictEqual(beforeWithoutVersion, afterWithoutVersion)) {
      return fullReleasePlease('package JSON contains a non-version edit');
    }
  }

  return {
    unit: 'full',
    pgtap: true,
    deno: true,
    releaseLight: true,
    version: manifestVersion,
    reason: 'release-please version files validated',
  };
}

// ── repo reading ────────────────────────────────────────────────────────────
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

function parseNameStatusZ(output) {
  const fields = output.split('\0');
  const changes = [];
  for (let index = 0; index < fields.length && fields[index] !== ''; ) {
    const status = fields[index++];
    const renamedOrCopied = status.startsWith('R') || status.startsWith('C');
    const pathCount = renamedOrCopied ? 2 : 1;
    if (fields.length < index + pathCount) return null;
    if (renamedOrCopied) {
      const oldPath = fields[index++];
      const nextPath = fields[index++];
      changes.push({ status, path: nextPath, oldPath });
    } else {
      changes.push({ status, path: fields[index++] });
    }
  }
  return changes;
}

function gitFile(revision, file) {
  try {
    return git('show', `${revision}:${file}`);
  } catch {
    return undefined;
  }
}

function releasePleaseCli(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const baseRef = value('--base');
  const resultForFailure = (reason) => console.log(JSON.stringify(fullReleasePlease(reason)));
  if (!baseRef) return resultForFailure('base ref is missing');

  try {
    const diffRange = `${baseRef}...HEAD`;
    const changes = parseNameStatusZ(git('diff', '--name-status', '--find-renames', '-z', '--no-ext-diff', diffRange));
    if (!changes) return resultForFailure('diff paths could not be parsed');
    const diffMetadataClean = git('diff', '--summary', '--no-ext-diff', diffRange).trim() === '';
    const baseFiles = Object.fromEntries(RELEASE_PLEASE_FILES.map((file) => [file, gitFile(baseRef, file)]));
    const headFiles = Object.fromEntries(RELEASE_PLEASE_FILES.map((file) => [file, gitFile('HEAD', file)]));
    const result = classifyReleasePlease({
      targetBase: value('--target-base'),
      headBranch: value('--head-branch'),
      changes,
      diffMetadataClean,
      baseFiles,
      headFiles,
    });
    console.log(JSON.stringify(result));
  } catch {
    resultForFailure('diff could not be inspected');
  }
}

/** Relative import targets of a source file, resolved to repo-relative paths that exist. */
export function localImports(file, root = ROOT) {
  const src = readFileSync(path.join(root, file), 'utf8');
  const out = [];
  for (const [, spec] of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const base = path.posix.join(path.posix.dirname(file), spec);
    const hit = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((s) => base + s).find((c) => /\.[cm]?[jt]sx?$/.test(c) && existsSync(path.join(root, c)));
    if (hit) out.push(hit);
  }
  return out;
}

/** pmo-portal files that edge functions import (transitively): Deno typechecks them too. */
export function edgeImportedPortalFiles(root = ROOT) {
  const seen = new Set();
  const queue = git('ls-files', 'supabase/functions').split('\n').filter((f) => /\.tsx?$/.test(f));
  while (queue.length) {
    for (const dep of localImports(queue.pop(), root)) {
      if (dep.startsWith('pmo-portal/') && !seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

const FS_RE = /["'](?:node:)?(?:fs|fs\/promises|child_process)["']|import\.meta\.glob|\?raw["']/;

/** Vitest test files (paths relative to pmo-portal/) that read repo files directly, themselves or via a direct helper. */
export function fsCoupledTests(root = ROOT) {
  const tracked = git('ls-files', 'pmo-portal', 'supabase/functions/erpnext-sweep').split('\n');
  const tests = tracked.filter(
    (f) => TEST_RE.test(f) && /\.tsx?$/.test(f) && !/^pmo-portal\/(e2e|evals\/cases)\//.test(f) && (f.startsWith('pmo-portal/') || /Backstop\.test\.ts$/.test(f)),
  );
  const reads = (f) => FS_RE.test(readFileSync(path.join(root, f), 'utf8'));
  return tests
    .filter((f) => reads(f) || localImports(f, root).some(reads))
    .map((f) => path.posix.relative('pmo-portal', f));
}

function setupFilesFromConfig(root = ROOT) {
  const cfg = readFileSync(path.join(root, 'pmo-portal/vite.config.ts'), 'utf8');
  const m = cfg.match(/setupFiles:\s*\[([^\]]*)\]/);
  return [...(m?.[1].matchAll(/["']([^"']+)["']/g) ?? [])].map((x) => path.posix.join('pmo-portal', x[1]));
}

function cli(argv) {
  if (argv.includes('--release-please')) return releasePleaseCli(argv);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--fs-coupled')) return console.log(fsCoupledTests().join('\n'));
  const base = argv[argv.indexOf('--base') + 1];
  if (!argv.includes('--base') || !base) throw new Error('usage: ci-test-scope.mjs --base <ref> | --release-please --target-base <branch> --head-branch <name> --base <ref> | --fs-coupled | --self-test');
  const changes = git('diff', '--name-status', '--no-renames', `${base}...HEAD`)
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status, path: rest.join('\t') };
    });
  console.log(JSON.stringify(scope(changes, { setupFiles: setupFilesFromConfig(), edgeImports: edgeImportedPortalFiles() })));
}

// ── self-test ───────────────────────────────────────────────────────────────
async function selfTest() {
  const { default: test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;
  const M = (...ps) => ps.map((p) => ({ status: 'M', path: p }));
  const s = (ps, ctx) => scope(M(...ps), ctx);

  test('one src/lib module → affected, no db, no deno', () => {
    assert.deepEqual(
      (({ unit, pgtap, deno }) => ({ unit, pgtap, deno }))(s(['pmo-portal/src/lib/format.ts', 'pmo-portal/src/lib/format.test.ts'])),
      { unit: 'affected', pgtap: false, deno: false },
    );
  });
  for (const p of [
    'pmo-portal/vite.config.ts', 'pmo-portal/vitest.eval.config.ts', 'pmo-portal/package.json', 'package-lock.json',
    'pmo-portal/package-lock.json', 'pmo-portal/tsconfig.json', 'pmo-portal/test/setup.ts', 'pmo-portal/test/postgrestFake.ts',
    'pmo-portal/src/test/helper.ts', 'pmo-portal/src/lib/__mocks__/x.ts',
    'pmo-portal/.node-version', '.github/workflows/ci.yml', 'scripts/ci-test-scope.mjs',
  ]) {
    test(`unit full: ${p}`, () => assert.equal(s([p]).unit, 'full'));
  }
  test('i18n catalogues stay affected: their readers are fs-coupled and always run', () => {
    assert.equal(s(['pmo-portal/public/locales/id/common.json']).unit, 'affected');
    const readers = fsCoupledTests().filter((f) => readFileSync(path.join(ROOT, 'pmo-portal', f), 'utf8').includes('locales'));
    assert.ok(readers.length > 0, 'no always-run test reads public/locales: restore the locales rule in UNIT_FULL');
  });
  test('a test file under test/ stays affected', () => assert.equal(s(['pmo-portal/test/smoke.test.ts']).unit, 'affected'));
  test('setup file from config is full', () =>
    assert.equal(s(['pmo-portal/test/custom-setup.ts'], { setupFiles: ['pmo-portal/test/custom-setup.ts'] }).unit, 'full'));
  test('deleted source → full; deleted test → affected', () => {
    assert.equal(scope([{ status: 'D', path: 'pmo-portal/src/lib/a.ts' }]).unit, 'full');
    assert.equal(scope([{ status: 'D', path: 'pmo-portal/src/lib/a.test.ts' }]).unit, 'affected');
  });
  test('file-count threshold', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => `pmo-portal/src/lib/f${i}.ts`);
    assert.equal(s(many(FILE_THRESHOLD)).unit, 'affected');
    assert.equal(s(many(FILE_THRESHOLD + 1)).unit, 'full');
    assert.equal(s(many(5), { threshold: 4 }).unit, 'full');
  });
  for (const p of ['supabase/migrations/0400_x.sql', 'supabase/tests/x.sql', 'supabase/functions/a/index.ts', 'scripts/with-db-lock.sh',
    'scripts/check-isolation-denominator.mjs', 'scripts/isolation-probe-denominator.json', 'scripts/financial-statements-rollback.test.mjs',
    'scripts/financial-statements-nightly-intent-race.test.mjs',
    'scripts/test-contract-quantities-rollback.sh', 'scripts/contract-quantities-rollback.test.sql',
    'scripts/test-plan-limits-rollback.sh', 'scripts/plan-limits-rollback.test.sql', '.github/workflows/ci.yml']) {
    test(`pgtap: ${p}`, () => assert.equal(s([p]).pgtap, true));
  }
  test('pgtap false for app-only, docs and unrelated scripts', () => {
    for (const p of ['pmo-portal/App.tsx', 'docs/x.md', 'scripts/changed-lines-coverage.mjs']) assert.equal(s([p]).pgtap, false);
  });
  for (const p of ['supabase/functions/a/index.ts', 'scripts/deno-test-edge-fns.sh', 'scripts/m365-record-folder-write-mutation.mjs', '.github/workflows/ci.yml']) {
    test(`deno: ${p}`, () => assert.equal(s([p]).deno, true));
  }
  test('deno true for a pmo-portal file an edge function imports; false for others', () => {
    const ctx = { edgeImports: new Set(['pmo-portal/src/lib/appError.ts']) };
    assert.equal(s(['pmo-portal/src/lib/appError.ts'], ctx).deno, true);
    assert.equal(s(['pmo-portal/src/lib/format.ts'], ctx).deno, false);
    assert.equal(s(['supabase/migrations/0400_x.sql']).deno, false);
  });
  test('reason names the trigger', () => assert.match(s(['pmo-portal/vite.config.ts']).reason, /vite\.config\.ts/));

  test('localImports + fsCoupled helper hop resolve against a real tree', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(path.join(tmpdir(), 'scope-'));
    mkdirSync(path.join(dir, 'a'));
    writeFileSync(path.join(dir, 'a/x.ts'), '');
    writeFileSync(path.join(dir, 'a/y.ts'), "import { x } from './x';\nconst z = await import('../a/x.ts');\nimport r from 'react';");
    assert.deepEqual(localImports('a/y.ts', dir), ['a/x.ts', 'a/x.ts']);
    assert.ok(FS_RE.test("import fs from 'node:fs';") && FS_RE.test("import s from './a.css?raw'") && !FS_RE.test("import x from './fsUtil'"));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cli(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
