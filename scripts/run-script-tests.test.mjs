// Tests for scripts/run-script-tests.mjs (#2332). Imports the shipped module; asserts the list
// contract CI depends on: non-empty, exclusions dropped, stale exclusions caught by --self-test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EXCLUDED, listScriptTests, readScriptsEntries, selfTestProblems } from './run-script-tests.mjs';

test('#2332 the script test list is non-empty', () => {
  const files = listScriptTests(readScriptsEntries());
  assert.ok(files.length > 0, `expected script tests, got none (${files.length})`);
});

test('#2332 no excluded file appears in the run list', () => {
  const entries = readScriptsEntries();
  const files = listScriptTests(entries);
  // Precondition: the excluded files do exist on disk, so "absent from the list" means
  // the runner dropped them, not that the names went stale.
  for (const name of EXCLUDED) {
    assert.ok(entries.includes(name), `exclusion is stale, scripts/${name} does not exist`);
    assert.ok(!files.includes(name), `excluded file leaked into the run list: scripts/${name}`);
  }
});

test('#2332 every EXCLUDED name is a scripts/*.test.mjs file (self-test has something to check)', () => {
  for (const name of EXCLUDED) {
    assert.match(name, /\.test\.mjs$/, `${name} must be a .test.mjs file`);
  }
});

test('#2332 self-test reports a stale exclusion from a fake directory listing', () => {
  const fake = ['aaa-real.test.mjs', 'bbb-real.test.mjs'];
  const problems = selfTestProblems(fake);
  assert.ok(problems.length > 0, 'expected the self-test to report problems for a fake listing');
  for (const name of EXCLUDED) {
    assert.ok(
      problems.some((p) => p.includes(name) && p.includes('stale exclusion')),
      `expected a "stale exclusion" problem for ${name}, got: ${problems.join(' | ')}`,
    );
  }
});

test('#2332 self-test reports an empty listing', () => {
  const problems = selfTestProblems([]);
  assert.ok(
    problems.some((p) => p.includes('script test list is empty')),
    `expected an empty-list problem, got: ${problems.join(' | ')}`,
  );
});

test('#2332 self-test reports an excluded file that leaked into the run list', () => {
  // The leak line is a canary for a broken list function: with the shipped filter it is
  // unreachable, so inject a broken listFn (one that stopped dropping exclusions) and the
  // self-test must go red. Break-the-filter => red; that is the polarity CI depends on.
  const fake = ['aaa-real.test.mjs', 'bbb-real.test.mjs', ...EXCLUDED];
  const brokenList = () => [...EXCLUDED, 'aaa-real.test.mjs'];
  const problems = selfTestProblems(fake, brokenList);
  assert.ok(
    problems.some((p) => p.includes('leaked') && p.includes(EXCLUDED[0])),
    `expected a leak problem for ${EXCLUDED[0]}, got: ${problems.join(' | ')}`,
  );
});

test('#2332 self-test is clean on a healthy fake listing (only live exclusions remain)', () => {
  // Listing where every excluded name exists: no stale, no leak, non-empty.
  const fake = ['aaa-real.test.mjs', 'bbb-real.test.mjs', ...EXCLUDED];
  assert.deepEqual(selfTestProblems(fake), []);
});

test('#2332 the run list is sorted', () => {
  const files = listScriptTests(readScriptsEntries());
  assert.deepEqual(files, [...files].sort());
});
