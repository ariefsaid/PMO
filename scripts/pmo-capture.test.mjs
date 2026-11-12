import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHistory } from './lib/pmo-capture.mjs';

test('AC-ROP-017 preview and apply send the scoped operation and the reviewed revision', async () => {
  const calls = [];
  const api = { capture: async (payload) => { calls.push(payload); return { action: payload.action }; } };
  await captureHistory(api, { projectId: 'project-1', dryRun: true });
  await captureHistory(api, { projectId: 'project-1', dryRun: false, revision: 'rev-1', requestId: 'req-1' });
  assert.deepEqual(calls, [
    { action: 'preview', scope: { projectId: 'project-1' } },
    { action: 'apply', scope: { projectId: 'project-1' }, expectedRevision: 'rev-1', requestId: 'req-1' },
  ]);
});

test('AC-ROP-017 apply refuses missing revision or request before sending', async () => {
  const api = { capture: async () => { throw new Error('unexpected write'); } };
  await assert.rejects(captureHistory(api, { projectId: null, dryRun: false }), /revision.*request/i);
});

test('AC-ROP-012 capture flags distinguish all, project, preview and apply', async () => {
  const { parseArgs } = await import('./pmo.mjs');
  assert.deepEqual(parseArgs(['purchases', 'capture', '--all', '--dry-run']).flags.all, true);
  const apply = parseArgs(['purchases', 'capture', '--project', 'p1', '--apply', '--revision', 'r', '--request', 'q']);
  assert.equal(apply.flags.apply, true);
  assert.equal(apply.flags.revision, 'r');
  assert.equal(apply.flags.request, 'q');
});
