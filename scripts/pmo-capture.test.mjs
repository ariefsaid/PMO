import test from 'node:test';
import assert from 'node:assert/strict';

test('AC-ROP-012 preview and apply retain scope and reviewed identity', async () => {
  const { captureHistory } = await import('./lib/pmo-capture.mjs');
  const calls = [];
  const api = { capture: async (payload) => { calls.push(payload); return { complete: true }; } };
  await captureHistory(api, { projectId: 'project-1', dryRun: true });
  await captureHistory(api, { projectId: 'project-1', dryRun: false, revision: 'revision-1', requestId: 'request-1' });
  assert.deepEqual(calls, [
    { action: 'preview', scope: { projectId: 'project-1' } },
    { action: 'apply', scope: { projectId: 'project-1' }, expectedRevision: 'revision-1', requestId: 'request-1' },
  ]);
});

test('AC-ROP-012 apply without reviewed identity never calls the server', async () => {
  const { captureHistory } = await import('./lib/pmo-capture.mjs');
  let called = false;
  const api = { capture: async () => { called = true; } };
  await assert.rejects(captureHistory(api, { dryRun: false }), /revision.*request/i);
  assert.equal(called, false);
});

test('capture proof cleanup preserves the exact primary error alongside a cleanup failure', async () => {
  const { withCaptureProofCleanup } = await import('./lib/pmo-capture.mjs');
  const primary = new Error('primary failure');
  const cleanup = new Error('cleanup failure');
  await assert.rejects(withCaptureProofCleanup(async () => { throw primary; }, async () => { throw cleanup; }), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, cleanup]);
    return true;
  });
  await assert.rejects(withCaptureProofCleanup(async () => { throw primary; }, async () => {}), error => error === primary);
  await assert.rejects(withCaptureProofCleanup(async () => 'ok', async () => { throw cleanup; }), error => error === cleanup);
  assert.equal(await withCaptureProofCleanup(async () => 'ok', async () => {}), 'ok');
});
