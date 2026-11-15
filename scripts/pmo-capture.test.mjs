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
    { action: 'report', scope: { projectId: 'project-1' } },
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

test('AC-ROP-062 apply includes same-scope reconciliation even after refusals', async () => {
  const { captureHistory } = await import('./lib/pmo-capture.mjs');
  const calls = [];
  const api = { capture: async payload => { calls.push(payload); return payload.action === 'apply' ? { complete: false, refusals: ['stale'] } : { complete: true, ledger: 10 }; } };
  const result = await captureHistory(api, { projectId: 'project-1', dryRun: false, revision: 'rev', requestId: 'req' });
  assert.deepEqual(result, { complete: false, refusals: ['stale'], report: { complete: true, ledger: 10 } });
  assert.deepEqual(calls[1], { action: 'report', scope: { projectId: 'project-1' } });
});

test('AC-ROP-062 unavailable reconciliation preserves the apply result', async () => {
  const { captureHistory } = await import('./lib/pmo-capture.mjs');
  const api = { capture: async payload => { if (payload.action === 'report') throw new Error('unavailable'); return { complete: true, purchase: 'p1' }; } };
  const result = await captureHistory(api, { dryRun: false, revision: 'rev', requestId: 'req' });
  assert.deepEqual(result, { complete: true, purchase: 'p1', report: { complete: false, missing: ['report_unavailable'] } });
});

const U = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const row = (n, extra = {}) => ({ request_id: U(n), source_id: U(100 + n), decision: 'project', project_id: U(900), ...extra });

test('AC-ROP-012 assign defaults to preview and apply carries the reviewed revision', async () => {
  const { runCaptureAssignments } = await import('./lib/pmo-capture.mjs');
  const calls = [];
  const api = { capture: async payload => { calls.push(payload); return { complete: true, revision: 'rev-1', results: [] }; } };
  await runCaptureAssignments(api, [row(1)], { dryRun: true });
  await runCaptureAssignments(api, [row(1)], { dryRun: false, revision: 'rev-1' });
  assert.equal(calls[0].dryRun, true);
  assert.deepEqual(calls[1], { action: 'assign', rows: [row(1)], expectedRevision: 'rev-1', dryRun: false });
});

test('AC-ROP-012 assign refuses bad files before any request', async () => {
  const { runCaptureAssignments } = await import('./lib/pmo-capture.mjs');
  let called = 0;
  const api = { capture: async () => { called += 1; return {}; } };
  const bad = {
    '501 rows': Array.from({ length: 501 }, (_, i) => row(i + 1)),
    'no rows': [],
    'missing decision': [{ request_id: U(1), source_id: U(101) }],
    'duplicate request': [row(1), { ...row(2), request_id: U(1) }],
    'duplicate source': [row(1), { ...row(2), source_id: U(101) }],
    'bad uuid': [row(1, { project_id: 'nope' })],
    'project without project_id': [{ request_id: U(1), source_id: U(101), decision: 'project' }],
    'set_aside with project': [row(1, { decision: 'set_aside' })],
    'override not boolean': [row(1, { accept_set_aside: 'yes' })],
    'unknown field': [row(1, { note: 'x' })],
  };
  for (const [name, rows] of Object.entries(bad)) {
    await assert.rejects(runCaptureAssignments(api, rows, { dryRun: true }), error => Array.isArray(error.problems) && error.problems.length > 0, name);
  }
  await assert.rejects(runCaptureAssignments(api, [row(1)], { dryRun: false }), /revision/i);
  assert.equal(called, 0);
});

test('AC-ROP-012 assignment output is actionable and never claims an ERP write', async () => {
  const { runCaptureAssignments } = await import('./lib/pmo-capture.mjs');
  const rows = [row(1), row(2), row(3, { decision: 'set_aside', project_id: undefined })];
  delete rows[2].project_id;
  const server = { complete: true, revision: 'rev-9', results: [
    { request_id: U(1), source_id: U(101), source: 'INV-1', supplier: 'Supplier One', outcome: 'create', would_create: true, procurement_id: null, assignment_origin: 'pmo_assignment', mapped_amount: '60', excluded: [{ account: 'Fixed Assets', kind: 'capital' }], ledger_currency: 'USD', prior_placement: [{ project_id: U(901), amount: '60' }], clears_mark: true, erp_write: false },
    { request_id: U(2), source_id: U(102), source: 'INV-2', outcome: 'refused', reason: 'source_tagged', erp_write: false },
    { request_id: U(3), source_id: U(103), source: 'INV-3', outcome: 'refused', reason: 'snapshot_refresh_required', message: 'retry after the next ledger refresh', erp_write: false },
  ] };
  const api = { capture: async () => server };
  const preview = await runCaptureAssignments(api, rows, { dryRun: true, file: 'a.json' });
  assert.equal(preview.erp_write, false);
  assert.equal(preview.revision, 'rev-9');
  assert.deepEqual(preview.counts, { rows: 3, create: 1, skip: 0, refused: 2 });
  const [one, two, three] = preview.rows;
  assert.equal(one.reference, 'INV-1'); assert.equal(one.supplier, 'Supplier One');
  assert.equal(one.would_create, true); assert.equal(one.purchase_id, null);
  assert.deepEqual(one.placement, { project_id: U(900), amount: '60', currency: 'USD', excluded: [{ account: 'Fixed Assets', kind: 'capital' }],
    loses_cost: [{ project_id: U(901), amount: '60' }], clears_overhead_mark: true });
  assert.equal(one.assignment_origin, 'pmo_assignment');
  assert.equal(one.next, "node scripts/pmo.mjs purchases assign 'a.json' --apply --revision rev-9");
  assert.equal(two.reason, 'source_tagged'); assert.match(two.next, /preview again: node scripts\/pmo\.mjs purchases assign 'a\.json'/);
  assert.match(three.next, /after the next ledger refresh/);
  assert.ok(preview.rows.every(r => r.erp_write === false));
  assert.doesNotMatch(preview.next, /--apply/, 'a preview with refusals never suggests applying');
});

test('AC-ROP-012 a refused or stale revision never applies silently', async () => {
  const { runCaptureAssignments } = await import('./lib/pmo-capture.mjs');
  const api = { capture: async () => ({ complete: false, reason: 'source_stale', results: [], erp_write: false }) };
  const result = await runCaptureAssignments(api, [row(1)], { dryRun: false, revision: 'old', file: 'a.json' });
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'source_stale');
  assert.match(result.next, /preview again/);
  assert.doesNotMatch(result.next, /--apply/);
});

test('AC-ROP-012 the next command quotes the file path and a partial apply says preview again', async () => {
  const { runCaptureAssignments } = await import('./lib/pmo-capture.mjs');
  const server = { complete: true, revision: 'rev-2', results: [
    { request_id: U(1), source_id: U(101), outcome: 'create', procurement_id: U(500), erp_write: false },
    { request_id: U(2), source_id: U(102), outcome: 'refused', reason: 'source_tagged', erp_write: false } ] };
  const result = await runCaptureAssignments({ capture: async () => server }, [row(1), row(2)], { dryRun: false, revision: 'rev-1', file: "my files/it's.json" });
  assert.match(result.rows[0].next, /^to undo: node scripts\/pmo\.mjs purchases undo-record-only /);
  assert.match(result.rows[1].next, /assign 'my files\/it'\\''s\.json'/);
  assert.match(result.next, /preview again .*then apply with the new revision; rows already applied are skipped/);
});

test('AC-CAPV-007 an apply that stops part-way reads no report and says how far it got and how to continue', async () => {
  const { captureHistory, captureProgressNote } = await import('./lib/pmo-capture.mjs');
  const calls = [];
  const stopped = { complete: false, resume: true, next_index: 25, group_count: 30, sources_per_call: 500, results: [], erp_write: false };
  const api = { capture: async payload => { calls.push(payload); return stopped; } };
  const result = await captureHistory(api, { projectId: null, dryRun: false, revision: 'rev-1', requestId: 'req-1' });
  assert.deepEqual(calls.map(call => call.action), ['apply']);
  assert.deepEqual(result, stopped);
  assert.equal(captureProgressNote(result, { projectId: null, revision: 'rev-1', requestId: 'req-1' }),
    "groups 25 of 30 processed (up to 500 sources per call)\ncontinue with: node scripts/pmo.mjs purchases capture --all --apply --revision 'rev-1' --request 'req-1'");
  assert.equal(captureProgressNote(result, { projectId: 'project-1', revision: "it's", requestId: 'req-1' }),
    "groups 25 of 30 processed (up to 500 sources per call)\ncontinue with: node scripts/pmo.mjs purchases capture --project 'project-1' --apply --revision 'it'\\''s' --request 'req-1'");
});

test('AC-CAPV-007 only a stopped apply prints a continue command, with its counts when the reply has them', async () => {
  const { captureProgressNote } = await import('./lib/pmo-capture.mjs');
  const identity = { projectId: null, revision: 'rev-1', requestId: 'req-1' };
  assert.equal(captureProgressNote({ complete: true, resume: false, next_index: 30, group_count: 30 }, identity), null);
  assert.equal(captureProgressNote({ complete: false, missing: ['feed_not_current'] }, identity), null);
  assert.equal(captureProgressNote({ complete: false, resume: true }, identity),
    "the apply stopped before the batch completed\ncontinue with: node scripts/pmo.mjs purchases capture --all --apply --revision 'rev-1' --request 'req-1'");
});
