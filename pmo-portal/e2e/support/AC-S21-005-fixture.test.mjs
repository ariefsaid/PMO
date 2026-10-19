import assert from 'node:assert/strict';
import test from 'node:test';
import * as fixtureSupport from './AC-S21-005-fixture.mjs';
import {
  createS21FixtureIdentity,
  createS21WriteAheadLedger,
  encodeS21CopyRow,
} from './AC-S21-005-fixture.mjs';
import { validateS21TransportSummary } from './AC-S21-005-transport.mjs';

const TEST_RUN_ID = '11111111-2222-4333-8444-555555555555';

test('fixture identity is fresh, synthetic, and uses one exact project/list label', () => {
  const fixture = createS21FixtureIdentity(TEST_RUN_ID);
  const uuids = [fixture.orgId, fixture.userId, fixture.projectId, fixture.orgBindingId];

  assert.equal(new Set(uuids).size, uuids.length);
  assert.ok(uuids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)));
  assert.match(fixture.email, /^ac-s21-005-[0-9a-f]{8}@example\.invalid$/i);
  assert.equal(fixture.projectName, fixture.listName);
  assert.ok(fixture.secretRef.startsWith('s21-ac005-'));
  assert.notEqual(fixture.orgId, TEST_RUN_ID);
});

test('write-ahead ledger contains only owned identifiers and synthetic labels', () => {
  const fixture = createS21FixtureIdentity(TEST_RUN_ID);
  const ledger = createS21WriteAheadLedger(fixture);
  const encoded = JSON.stringify(ledger);

  assert.equal(ledger.runId, TEST_RUN_ID);
  assert.equal(ledger.steps.organization, 'not-started');
  assert.equal(ledger.steps.projectBinding, 'not-started');
  assert.equal(/password|sentinel|access.?token/i.test(encoded), false);
  assert.equal(encoded.includes('secret-value'), false);
  assert.equal(ledger.ownedIds.orgId, fixture.orgId);
  assert.equal(ledger.ownedLabels.projectName, fixture.projectName);
});

test('COPY row encoding safely preserves commas and quotes and rejects line breaks', () => {
  assert.equal(encodeS21CopyRow(['one, two', 'a "quoted" value']), '"one, two","a ""quoted"" value"');
  assert.throws(() => encodeS21CopyRow(['first\nsecond']), /S21_COPY_VALUE_INVALID/);
  assert.throws(() => encodeS21CopyRow(['first\rsecond']), /S21_COPY_VALUE_INVALID/);
});

test('private failure diagnostic scrubs exact credentials and suppresses detail before browser login', () => {
  const capture = fixtureSupport.captureS21FailureDiagnostic;
  assert.equal(typeof capture, 'function');

  const secret = 'SYNTHETIC_CREDENTIAL_SENTINEL';
  const error = new Error(`locator assertion failed at the list picker: ${secret}`);
  assert.deepEqual(capture(error, { secretValues: [secret], includeDetails: true }), {
    name: error.name,
    message: 'locator assertion failed at the list picker: [REDACTED]',
    stack: error.stack.replaceAll(secret, '[REDACTED]'),
  });

  assert.deepEqual(capture(error, { secretValues: [secret], includeDetails: false }), {
    name: 'Error',
    message: null,
    stack: null,
  });
  assert.deepEqual(capture({ toString: () => 'unexpected thrown value' }), {
    name: 'NonError',
    message: 'S21_NON_ERROR_THROWABLE',
    stack: null,
  });
});

test('first Playwright failure survives a later transport-summary cleanup failure', () => {
  const recordFailure = fixtureSupport.recordS21PrimaryFailure;
  assert.equal(typeof recordFailure, 'function');
  const secret = 'SYNTHETIC_BROWSER_SESSION_TOKEN';
  const firstMessage = `expected the task list to load; ${secret}`;
  const ledger = {
    primaryFailure: null,
    failedJourneyStage: null,
    primaryFailureDiagnostic: null,
    cleanupFailureSteps: [],
  };

  recordFailure(ledger, new Error(firstMessage), {
    stage: 'tasks-page-heading-visible',
    secretValues: [secret],
    includeDetails: true,
  });

  const summaryBeforeLink = {
    event: 'summary',
    handlerPosts: { externalLists: 1, externalLink: 0 },
    handlerResponseStatusCounts: { externalLists: { '200': 1 }, externalLink: {} },
    clickup: {},
  };
  assert.throws(() => validateS21TransportSummary(summaryBeforeLink), /S21_TRANSPORT_SUMMARY_INVALID/);
  ledger.cleanupFailureSteps.push('transport-summary');
  recordFailure(ledger, new Error('secondary cleanup failure'), {
    stage: 'cleanup', secretValues: [secret], includeDetails: true,
  });

  assert.equal(ledger.primaryFailure, 'S21_PLAYWRIGHT_ASSERTION_FAILED');
  assert.equal(ledger.failedJourneyStage, 'tasks-page-heading-visible');
  assert.equal(ledger.primaryFailureDiagnostic.message, 'expected the task list to load; [REDACTED]');
  assert.equal(ledger.primaryFailureDiagnostic.message.includes(secret), false);
  assert.deepEqual(ledger.cleanupFailureSteps, ['transport-summary']);
});
