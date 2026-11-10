import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as ciScope from './ci-test-scope.mjs';

const MANIFEST = '.release-please-manifest.json';
const CHANGELOG = 'pmo-portal/CHANGELOG.md';
const PACKAGE = 'pmo-portal/package.json';
const LOCK = 'pmo-portal/package-lock.json';
const ALLOWED = [MANIFEST, CHANGELOG, PACKAGE, LOCK];
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function fixture(version, { packageExtra = {}, headingVersion = version } = {}) {
  const manifest = { 'pmo-portal': version };
  const pkg = { name: 'pmo-portal', version, ...packageExtra };
  const lock = {
    name: 'pmo-portal',
    version,
    lockfileVersion: 3,
    packages: { '': { name: 'pmo-portal', version } },
  };
  return {
    [MANIFEST]: JSON.stringify(manifest),
    [PACKAGE]: JSON.stringify(pkg),
    [LOCK]: JSON.stringify(lock),
    [CHANGELOG]: `# Changelog\n\n## [${headingVersion}](https://example.test) (2026-11-10)\n\nRelease notes.\n`,
  };
}

function classify(input) {
  assert.equal(typeof ciScope.classifyReleasePlease, 'function', 'ci-test-scope must export the release-please classifier');
  return ciScope.classifyReleasePlease(input);
}

function request({ baseFiles = fixture('0.34.0'), headFiles = fixture('0.35.0'), changes = ALLOWED.map((path) => ({ status: 'M', path })), ...overrides } = {}) {
  return {
    targetBase: 'main',
    headBranch: 'release-please--branches--main--bump--minor',
    changes,
    diffMetadataClean: true,
    baseFiles,
    headFiles,
    ...overrides,
  };
}

test('release-please version-only PR is light after parsed version consistency checks', () => {
  const result = classify(request());
  assert.equal(result.releaseLight, true);
  assert.equal(result.version, '0.35.0');
});

test('release-please JSON formatting and object-key order are compared semantically', () => {
  const baseFiles = fixture('0.34.0');
  const headFiles = fixture('0.35.0');
  baseFiles[PACKAGE] = '{"name":"pmo-portal","private":true,"version":"0.34.0"}\n';
  headFiles[PACKAGE] = '{\n  "version": "0.35.0",\n  "private": true,\n  "name": "pmo-portal"\n}\n';
  const result = classify(request({ baseFiles, headFiles }));
  assert.equal(result.releaseLight, true);
});

test('a non-empty subset of the allowed paths can be light when it completes a consistent version bump', () => {
  const baseFiles = fixture('0.35.0');
  const headFiles = fixture('0.35.0');
  const packageBefore = JSON.parse(baseFiles[PACKAGE]);
  packageBefore.version = '0.34.0';
  baseFiles[PACKAGE] = JSON.stringify(packageBefore);
  const result = classify(request({
    baseFiles,
    headFiles,
    changes: [{ status: 'M', path: PACKAGE }],
  }));
  assert.equal(result.releaseLight, true);
});

test('an unchanged release version is not a version-bump fast path', () => {
  const baseFiles = fixture('0.35.0');
  const headFiles = fixture('0.35.0');
  headFiles[CHANGELOG] += '\nAdditional release note.\n';
  assert.equal(classify(request({ baseFiles, headFiles, changes: [{ status: 'M', path: CHANGELOG }] })).releaseLight, false);
});

test('a release-please diff with an extra file stays on the full path', () => {
  const changes = [...ALLOWED.map((path) => ({ status: 'M', path })), { status: 'M', path: 'pmo-portal/src/App.tsx' }];
  assert.equal(classify(request({ changes })).releaseLight, false);
});

test('a package.json semantic edit beyond its top-level version stays full', () => {
  const baseFiles = fixture('0.34.0');
  const headFiles = fixture('0.35.0', { packageExtra: { scripts: { build: 'vite build' } } });
  assert.equal(classify(request({ baseFiles, headFiles })).releaseLight, false);
});

test('a package-lock semantic edit beyond its root-version fields stays full', () => {
  const baseFiles = fixture('0.34.0');
  const headFiles = fixture('0.35.0');
  const lock = JSON.parse(headFiles[LOCK]);
  lock.packages['node_modules/example'] = { version: '2.0.0' };
  headFiles[LOCK] = JSON.stringify(lock);
  assert.equal(classify(request({ baseFiles, headFiles })).releaseLight, false);
});

test('malformed expected JSON stays full', () => {
  const headFiles = fixture('0.35.0');
  headFiles[PACKAGE] = '{broken';
  assert.equal(classify(request({ headFiles })).releaseLight, false);
});

test('a missing expected file stays full', () => {
  for (const path of ALLOWED) {
    const baseFiles = fixture('0.34.0');
    const headFiles = fixture('0.35.0');
    delete baseFiles[path];
    assert.equal(classify(request({ baseFiles })).releaseLight, false, `missing base ${path} must stay full`);
    delete headFiles[path];
    assert.equal(classify(request({ headFiles })).releaseLight, false, `missing head ${path} must stay full`);
  }
});

test('manifest, package, lock root, and top release heading versions must agree', () => {
  for (const headFiles of [
    { ...fixture('0.35.0'), [MANIFEST]: JSON.stringify({ 'pmo-portal': '0.35.1' }) },
    { ...fixture('0.35.0'), [PACKAGE]: JSON.stringify({ name: 'pmo-portal', version: '0.35.1' }) },
    { ...fixture('0.35.0'), [LOCK]: JSON.stringify({ name: 'pmo-portal', version: '0.35.1', lockfileVersion: 3 }) },
    { ...fixture('0.35.0'), [LOCK]: JSON.stringify({ name: 'pmo-portal', version: '0.35.0', lockfileVersion: 3, packages: { '': { name: 'pmo-portal', version: '0.35.1' } } }) },
    fixture('0.35.0', { headingVersion: '0.35.1' }),
    { ...fixture('0.35.0'), [CHANGELOG]: '# Changelog\n\n## [Unreleased]\n\n## [0.35.0](https://example.test)\n' },
  ]) {
    assert.equal(classify(request({ headFiles })).releaseLight, false);
  }
});

test('renames and uncertain diff metadata stay full', () => {
  assert.equal(classify(request({ changes: [{ status: 'R100', path: PACKAGE, oldPath: 'old-package.json' }] })).releaseLight, false);
  assert.equal(classify(request({ diffMetadataClean: false })).releaseLight, false);
  assert.equal(classify(request({ diffMetadataClean: undefined })).releaseLight, false);
});

test('a non-release branch or a non-main target stays full', () => {
  assert.equal(classify(request({ headBranch: 'feature/release-please-fix' })).releaseLight, false);
  assert.equal(classify(request({ targetBase: 'dev' })).releaseLight, false);
});

function jobBlock(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length;
  assert.ok(start !== -1 && (nextName ? end > start : true), `workflow job ${name} is present`);
  return workflow.slice(start, end);
}

test('light classification is wired only through scope for main release-please PRs', () => {
  const scopeJob = jobBlock('scope', 'unit');
  assert.match(scopeJob, /release_light: \$\{\{ steps\.scope\.outputs\.release_light \}\}/);
  assert.match(scopeJob, /HEAD_BRANCH: \$\{\{ github\.head_ref \}\}/);
  assert.match(scopeJob, /\[ "\$EVENT" = pull_request \] && \[ "\$BASE_REF" = main \]/);
  assert.match(scopeJob, /--release-please --target-base "\$BASE_REF" --head-branch "\$HEAD_BRANCH" --base "origin\/\$BASE_REF"/);
  assert.match(scopeJob, /release_light=\$\(jq -r '\.releaseLight \/\/ false'/);
});

test('validated light path skips expensive jobs while required verify and integration still run', () => {
  for (const [name, nextName] of [
    ['unit', 'checks'],
    ['checks', 'deno'],
    ['deno', 'coverage'],
    ['coverage', 'verify'],
    ['browser-chromium', 'integration-lanes'],
    ['integration-lanes', 'integration-full'],
    ['integration-full', 'integration'],
  ]) {
    assert.match(jobBlock(name, nextName), /needs\.scope\.outputs\.release_light != 'true'/, `${name} must skip for a validated light path`);
  }

  const verify = jobBlock('verify', 'pgtap');
  assert.match(verify, /\n    if: \$\{\{ !cancelled\(\) && github\.event_name != 'workflow_dispatch' \}\}/);
  assert.match(verify, /Release-please version check passed[\s\S]*needs\.scope\.result[\s\S]*needs\.checks\.result[\s\S]*needs\.unit\.result[\s\S]*needs\.coverage\.result/);
  assert.match(verify, /Every verify-stage job passed\n        if: needs\.scope\.outputs\.release_light != 'true'/);

  const integration = jobBlock('integration', null);
  assert.match(integration, /needs: \[scope, browser-chromium, integration-lanes, integration-full\]/);
  assert.match(integration, /\n    if: \$\{\{ always\(\) && !cancelled\(\)/);
  assert.match(integration, /Release-please version check passed[\s\S]*needs\.scope\.result[\s\S]*needs\.browser-chromium\.result[\s\S]*needs\.integration-lanes\.result[\s\S]*needs\.integration-full\.result/);
  assert.match(integration, /Full integration evidence passed[\s\S]*needs\.browser-chromium\.result[\s\S]*needs\.integration-lanes\.result[\s\S]*needs\.integration-full\.result/);
  assert.match(workflow, /^  verify:/m);
  assert.match(workflow, /^  integration:/m);
});
