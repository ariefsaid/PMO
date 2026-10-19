import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  S21_FIXTURE_PHASE_TIMEOUT_MS,
  runS21FixtureCleanup,
} from './AC-S21-005-lifecycle.mjs';

const FIRST_SUPPORT_CASE = 'Supporting proof: Admin reviews the ClickUp list, saves the source, and reads back the binding';
const RELOAD_SUPPORT_CASE = 'Supporting proof: Admin opens the linked task route for the reload continuation';
const CANONICAL_CASE = 'AC-S21-005: Admin sees the persisted ClickUp link and initial source after reload';

async function readS21Spec() {
  return readFile(new URL('../AC-S21-005-task-list-review.spec.ts', import.meta.url), 'utf8');
}

function caseSource(source, title) {
  const marker = `  test('${title}'`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing timed case: ${title}`);
  const nextCase = source.indexOf('\n  test(', start + marker.length);
  return source.slice(start, nextCase === -1 ? source.indexOf('\n});', start) : nextCase);
}

test('S21 reload continuation keeps both normal logins timed and reloads the support page', async () => {
  const source = await readS21Spec();
  const caseTitles = [...source.matchAll(/^  test\('([^']+)'/gm)].map((match) => match[1]);
  assert.deepEqual(caseTitles, [FIRST_SUPPORT_CASE, RELOAD_SUPPORT_CASE, CANONICAL_CASE]);

  const firstSupport = caseSource(source, FIRST_SUPPORT_CASE);
  const reloadSupport = caseSource(source, RELOAD_SUPPORT_CASE);
  const canonical = caseSource(source, CANONICAL_CASE);

  assert.match(firstSupport, /test\.setTimeout\(S21_FIXTURE_PHASE_TIMEOUT_MS\)/);
  assert.match(firstSupport, /await adminLoginAndOpenTaskRoute\(page\)/);
  assert.match(reloadSupport, /test\.setTimeout\(S21_FIXTURE_PHASE_TIMEOUT_MS\)/);
  assert.match(reloadSupport, /browser\.newContext\(ownedContextOptions\(testInfo,\s*\{\s*baseURL:\s*appBaseUrl\s*\}\)\)/);
  assert.match(reloadSupport, /page = await ownedContext\.newPage\(\)/);
  assert.match(reloadSupport, /await installBrowserRouteGuardForPage\(page\)/);
  assert.match(reloadSupport, /await adminLoginAndOpenTaskRoute\(page\)/);
  assert.match(reloadSupport, /continuationPage = page/);
  assert.doesNotMatch(reloadSupport, /page\.reload\(/);
  assert.doesNotMatch(reloadSupport, /storageState|addCookies|addInitScript|\.close\(\)/);
  assert.equal(source.match(/await installBrowserRouteGuardForPage\(page\)/g)?.length, 2);
  assert.equal(source.match(/adminLoginAndOpenTaskRoute\(page\)/g)?.length, 2);
  assert.doesNotMatch(source, /test\.beforeEach/);
  assert.match(source, /aggregateS21BrowserGuardSnapshots\(browserRouteGuards\.map\(/);

  assert.match(canonical, /test\.setTimeout\(S21_FIXTURE_PHASE_TIMEOUT_MS\)/);
  assert.match(canonical, /const page = continuationPage/);
  assert.match(canonical, /await page\.reload\(\)/);
  assert.doesNotMatch(canonical, /browserAdminLoginConfirmed\s*=\s*false/);
  assert.doesNotMatch(canonical, /adminLoginAndOpenTaskRoute|browser\.newContext|newPage/);

  const hooks = source.slice(source.indexOf('test.beforeAll'), source.indexOf('async function adminLoginAndOpenTaskRoute'));
  assert.doesNotMatch(hooks, /adminLoginAndOpenTaskRoute|page\.goto\(|page\.reload\(/);
  const cleanup = source.slice(source.indexOf('test.afterAll'));
  const fixtureCleanupIndex = cleanup.indexOf('await runS21FixtureCleanup(');
  const ownedContextCloseIndex = cleanup.indexOf('await ownedContext?.close()');
  assert.ok(fixtureCleanupIndex >= 0 && ownedContextCloseIndex > fixtureCleanupIndex);
  assert.doesNotMatch(cleanup, /adminLoginAndOpenTaskRoute|page\.goto\(|page\.reload\(/);
});

test('AC-S21-005 keeps every persisted-link, empty-task, and no-write oracle after reload', async () => {
  const source = await readS21Spec();
  const canonical = caseSource(source, CANONICAL_CASE);

  for (const oracle of [
    'await page.reload()',
    'reloadedListField',
    'await expect(reloadedListField).toHaveCount(1)',
    'await expect(reloadedListField).toHaveText(`ClickUp List: ${fixture.listName}`)',
    'reloadedSourceField',
    'await expect(reloadedSourceField).toHaveCount(1)',
    "await expect(reloadedSourceField).toHaveText('Initial source: Start with PMO tasks')",
    'reloaded-link-success-visible',
    'Project linked\\. Initial task transfer is not confirmed\\.',
    "await expect(page.getByText('No tasks yet', { exact: true })).toBeVisible()",
    'projectBindingReadback(initialAdmin, fixture)',
    'expect(secondBinding).toMatchObject({',
    'id: firstBindingId',
    'org_id: fixture.orgId',
    'project_id: fixture.projectId',
    "external_tier: 'clickup'",
    'external_container_id: fixture.listId',
    "config: { direction: 'push-seed' }",
    'linked_by: fixture.userId',
    ".from('tasks')",
    'taskCount !== 0',
    'const browserSnapshot = pageRouteSnapshot?.()',
    'clickupOnboardRequests !== 0',
    'handlerPosts > S21_MAX_HANDLER_POSTS',
    'S21_BROWSER_REQUEST_POLICY_VIOLATION',
    'Object.keys(browserBlocked).length > 0',
    'S21_BROWSER_OUTBOUND_BLOCKED',
    "ledger.steps.projectBinding = 'verified-after-reload'",
    'activeHandlerServer.summary()',
    'await saveLedger(ledgerPath, ledger)',
    'recordS21BrowserFailure(page, error)',
  ]) {
    assert.ok(canonical.includes(oracle), `missing AC-S21-005 oracle: ${oracle}`);
  }
});

test('fixture setup and cleanup hooks retain the original 30-second bound', () => {
  assert.equal(S21_FIXTURE_PHASE_TIMEOUT_MS, 30_000);
});

test('a failed preflight preserves all fixture rows and stops only an owned server', async () => {
  const calls = [];
  const primary = new Error('preflight collision');
  const cleanupError = new Error('cleanup transport error');

  await assert.rejects(runS21FixtureCleanup({
    preflightPassed: false,
    ownedServer: { id: 'owned' },
    primaryFailure: primary,
    stopOwnedServer: async (server) => {
      calls.push(`stop:${server.id}`);
      throw cleanupError;
    },
    cleanupOwnedRows: async () => calls.push('delete-rows'),
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, cleanupError]);
    return true;
  });

  assert.deepEqual(calls, ['stop:owned']);
});

test('partial setup after successful preflight cleans owned rows after stopping its server', async () => {
  const calls = [];
  await runS21FixtureCleanup({
    preflightPassed: true,
    ownedServer: { id: 'owned' },
    primaryFailure: new Error('partial setup failed'),
    stopOwnedServer: async (server) => calls.push(`stop:${server.id}`),
    cleanupOwnedRows: async () => calls.push('delete-owned-rows'),
  });

  assert.deepEqual(calls, ['stop:owned', 'delete-owned-rows']);
});

test('cleanup failures preserve the original browser assertion and every cleanup error', async () => {
  const primary = new Error('browser assertion failed');
  const stopFailure = new Error('handler stop failed');
  const fixtureFailure = new Error('owned-row reconciliation failed');

  await assert.rejects(runS21FixtureCleanup({
    preflightPassed: true,
    ownedServer: { id: 'owned' },
    primaryFailure: primary,
    stopOwnedServer: async () => { throw stopFailure; },
    cleanupOwnedRows: async () => { throw fixtureFailure; },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, stopFailure, fixtureFailure]);
    return true;
  });
});

test('a fixture without an owned server never attempts to stop one', async () => {
  const calls = [];
  await runS21FixtureCleanup({
    preflightPassed: true,
    ownedServer: null,
    primaryFailure: null,
    stopOwnedServer: async () => calls.push('stop'),
    cleanupOwnedRows: async () => calls.push('delete-owned-rows'),
  });

  assert.deepEqual(calls, ['delete-owned-rows']);
});
