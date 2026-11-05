import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createS21JourneyHarness } from './AC-S21-005-harness.mjs';
import { S21_MAX_CLICKUP_GETS, S21_MAX_HANDLER_POSTS } from './AC-S21-005-transport.mjs';

const LOCAL_STATUS = {
  API_URL: 'http://127.0.0.1:54321',
  DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ANON_KEY: 'anon-key',
  SERVICE_ROLE_KEY: 'service-role-key',
};

const DOM_BOOLEAN_FIELDS = [
  'tasksHeadingVisible',
  'emptyTaskStateVisible',
  'bindingLoadingVisible',
  'compactCardPresent',
  'compactCardUnique',
  'clickupTierCardPresent',
  'bindingErrorVisible',
  'listErrorVisible',
  'listDetailsLoadingVisible',
  'savedListIdentityVisible',
];

/** Runs initRun with a private evidence directory and a fake local-stack status. */
async function freshHarness({ status = LOCAL_STATUS } = {}) {
  const harness = createS21JourneyHarness();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), 's21-harness-test-'));
  const previousEvidenceDir = process.env.S21_EVIDENCE_DIR;
  process.env.S21_EVIDENCE_DIR = evidenceDir;
  try {
    await harness.initRun({ status });
  } finally {
    if (previousEvidenceDir === undefined) delete process.env.S21_EVIDENCE_DIR;
    else process.env.S21_EVIDENCE_DIR = previousEvidenceDir;
  }
  return {
    harness,
    evidenceDir,
    cleanup: async () => rm(evidenceDir, { recursive: true, force: true }),
  };
}

function recordingPage() {
  const listeners = {};
  const screenshots = [];
  return {
    listeners,
    screenshots,
    on: (event, handler) => {
      (listeners[event] ??= []).push(handler);
    },
    screenshot: async (options) => {
      screenshots.push(options);
      await writeFile(options.path, 'png');
    },
  };
}

test('the per-run fixture interface exposes setup, page guard, readback and dispose', () => {
  const harness = createS21JourneyHarness();
  for (const verb of [
    'setup',
    'installPageGuard',
    'readback',
    'dispose',
    'initRun',
    'persistLedger',
    'beginReloadDiagnostic',
    'recordJourneyFailure',
    'setJourneyStage',
    'markBrowserLoginConfirmed',
    'markBindingCreated',
    'stopOwnedHandler',
    'cleanupOwnedRows',
  ]) {
    assert.equal(typeof harness[verb], 'function', `missing harness verb: ${verb}`);
  }
  for (const fact of [
    'fixture',
    'ledger',
    'ledgerPath',
    'initialAdmin',
    'handlerServer',
    'ephemeralPassword',
    'apiOrigin',
    'appOrigin',
  ]) {
    assert.ok(fact in harness, `missing harness fact: ${fact}`);
  }
});

test('initRun provisions the write-ahead ledger, request caps and 0600 evidence before the journey starts', async () => {
  const { harness, cleanup } = await freshHarness();
  try {
    const fixture = harness.fixture;
    assert.match(fixture.orgName, /^S21-AC005-[0-9a-f]{8}$/);
    assert.equal(harness.ledger.schemaVersion, 1);
    assert.equal(harness.ledger.runId, fixture.runId);
    assert.deepEqual(harness.ledger.requestCaps, {
      clickupGets: S21_MAX_CLICKUP_GETS,
      handlerPosts: S21_MAX_HANDLER_POSTS,
    });
    assert.equal(harness.ledger.journeyStage, 'fixture-preflight');
    assert.equal(harness.ledger.failedJourneyStage, null);
    assert.equal(harness.ledger.primaryFailure, null);
    assert.deepEqual(harness.ledger.cleanupFailureSteps, []);

    const ledgerFile = harness.ledgerPath;
    assert.equal(path.basename(ledgerFile), 'write-ahead-ledger.json');
    const evidenceDirectory = path.dirname(ledgerFile);
    assert.match(path.basename(evidenceDirectory), /^s21-ac005-/);
    assert.equal((await stat(ledgerFile)).mode & 0o777, 0o600);
    assert.equal((await stat(evidenceDirectory)).mode & 0o777, 0o700);

    const persisted = JSON.parse(await readFile(ledgerFile, 'utf8'));
    assert.equal(persisted.runId, fixture.runId);
    assert.equal(harness.apiOrigin, LOCAL_STATUS.API_URL);
  } finally {
    await cleanup();
  }
});

test('initRun refuses a run whose local stack configuration is unavailable', async () => {
  const harness = createS21JourneyHarness();
  await assert.rejects(
    harness.initRun({ status: {} }),
    (error) => error.message === 'S21_LOCAL_CONFIG_UNAVAILABLE',
  );
});

test('persistLedger swaps the ledger atomically and keeps it private', async () => {
  const { harness, evidenceDir, cleanup } = await freshHarness();
  try {
    const target = path.join(evidenceDir, 'manual-ledger.json');
    await harness.persistLedger(target, { steps: { cleanup: 'in-flight' } });

    assert.equal((await stat(target)).mode & 0o777, 0o600);
    const directoryEntries = await readdir(evidenceDir);
    assert.ok(!directoryEntries.some((entry) => entry.endsWith('.next')), 'no atomic swap residue');
    const persisted = JSON.parse(await readFile(target, 'utf8'));
    assert.deepEqual(persisted.steps, { cleanup: 'in-flight' });
  } finally {
    await cleanup();
  }
});

test('installPageGuard refuses to forward before the owned handler exists', async () => {
  const harness = createS21JourneyHarness();
  await assert.rejects(
    harness.installPageGuard({ route: async () => {} }),
    (error) => error.message === 'S21_HANDLER_SERVER_UNAVAILABLE',
  );
});

test('journey failures record the first failure, reload diagnostics and the failure screenshot', async () => {
  const { harness, cleanup } = await freshHarness();
  try {
    const page = recordingPage();
    harness.beginReloadDiagnostic(page);
    for (const handler of page.listeners.response ?? []) {
      handler({ url: () => 'http://127.0.0.1:54321/rest/v1/tasks?select=id', status: () => 503 });
    }
    for (const handler of page.listeners.requestfailed ?? []) {
      handler({ url: () => 'http://127.0.0.1:54321/functions/v1/external-lists' });
    }
    harness.markBrowserLoginConfirmed(true);
    harness.setJourneyStage('reload-linked-task-route');

    await harness.recordJourneyFailure(page, new Error('S21_TASK_SET_CHANGED'));
    const ledger = harness.ledger;
    assert.equal(ledger.primaryFailure, 'S21_TASK_SET_CHANGED');
    assert.equal(ledger.failedJourneyStage, 'reload-linked-task-route');
    const expectedDom = Object.fromEntries(DOM_BOOLEAN_FIELDS.map((field) => [field, false]));
    assert.deepEqual(ledger.reloadDiagnostic, {
      dom: expectedDom,
      endpoints: [
        { category: 'rest-tasks', status: 503, failed: false },
        { category: 'function-external-lists', status: null, failed: true },
      ],
    });
    assert.equal(ledger.failureScreenshot, 'first-failure.png');
    assert.equal(page.screenshots.length, 1);
    assert.equal(page.screenshots[0].fullPage, true);
    assert.equal(ledger.journeyStage, 'cleanup');

    await harness.recordJourneyFailure(page, new Error('S21_LATER_FAILURE'));
    assert.equal(ledger.primaryFailure, 'S21_TASK_SET_CHANGED');
  } finally {
    await cleanup();
  }
});

test('an unconfirmed browser login keeps failure details redacted and skips the screenshot', async () => {
  const { harness, cleanup } = await freshHarness();
  try {
    const page = recordingPage();
    page.screenshot = async () => assert.fail('no screenshot before the browser login is confirmed');
    harness.setJourneyStage('admin-login-page-load');

    await harness.recordJourneyFailure(page, new Error('S21_ORGANIZATION_WRITE_NOT_RECONCILED'));
    assert.equal(harness.ledger.primaryFailure, 'S21_ORGANIZATION_WRITE_NOT_RECONCILED');
    assert.equal(harness.ledger.failedJourneyStage, 'admin-login-page-load');
    assert.equal(harness.ledger.primaryFailureDiagnostic.message, null);
    assert.equal(harness.ledger.failureScreenshot, null);
    assert.equal(harness.ledger.journeyStage, 'cleanup');
  } finally {
    await cleanup();
  }
});

test('dispose without a run is a no-op', async () => {
  const harness = createS21JourneyHarness();
  let runCleanupCalled = false;
  await harness.dispose({ runCleanup: async () => {
    runCleanupCalled = true;
  } });
  assert.equal(runCleanupCalled, false);
});

test('dispose hands the run state to the lifecycle cleanup with stop-before-rows callbacks', async () => {
  const { harness, cleanup } = await freshHarness();
  try {
    const failure = new Error('S21_PROJECT_BINDING_PERSISTENCE_MISMATCH');
    harness.setJourneyStage('link-success-visible');
    await harness.recordJourneyFailure(null, failure);

    let captured = null;
    await harness.dispose({ runCleanup: async (options) => {
      captured = options;
    } });

    assert.equal(captured.preflightPassed, false);
    assert.equal(captured.ownedServer, null);
    assert.equal(captured.primaryFailure, failure);
    assert.equal(typeof captured.stopOwnedServer, 'function');
    assert.equal(typeof captured.cleanupOwnedRows, 'function');
  } finally {
    await cleanup();
  }
});
