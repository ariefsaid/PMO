import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseArgs, percentile, summarize, dateVars, fill } from './perf/load-run.mjs';

test('parseArgs defaults and flags', () => {
  assert.deepEqual(parseArgs([]).users, 50);
  const o = parseArgs(['--users', '10', '--duration', '5', '--routes', 'project,procurement', '--no-db-stats']);
  assert.equal(o.users, 10); assert.equal(o.duration, 5); assert.deepEqual(o.routes, ['project', 'procurement']); assert.equal(o.dbStats, false);
});
test('parseArgs rejects bad numbers, unknown flags, remote hosts', () => {
  assert.throws(() => parseArgs(['--users', 'x']));
  assert.throws(() => parseArgs(['--users', '0']));
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--url', 'https://example.supabase.co']), /non-localhost/);
  assert.equal(parseArgs(['--url', 'https://example.supabase.co', '--allow-remote']).allowRemote, true);
});
test('percentile is nearest-rank', () => {
  const v = Array.from({ length: 100 }, (_, i) => 100 - i); // unsorted 1..100
  assert.equal(percentile(v, 50), 50); assert.equal(percentile(v, 95), 95); assert.equal(percentile(v, 99), 99);
  assert.equal(percentile([7], 99), 7); assert.ok(Number.isNaN(percentile([], 50)));
});
test('summarize excludes failed pages from latency, counts failures', () => {
  const s = summarize([{ ms: 10, failed: 0 }, { ms: 20, failed: 0 }, { ms: 9999, failed: 2 }]);
  assert.equal(s.pages, 3); assert.equal(s.p95, 20); assert.equal(s.failedCalls, 2); assert.equal(s.failedPages, 1);
});
test('dateVars derives the windows from today, not capture time', () => {
  const d = dateVars(new Date('2027-03-15T12:00:00Z'));
  assert.deepEqual(d, { yearStart: '2027-01-01', monthStart: '2027-03-01', monthEnd: '2027-03-31', monthStartMinus1: '2027-02-01', monthStartMinus12: '2026-03-01' });
});
test('fill substitutes every placeholder and leaves none behind', () => {
  const out = fill('/x?id=eq.{userId}&o={orgId}&a={userId}&{projectId}{yearStart}', { userId: 'U', orgId: 'O', projectId: 'P', yearStart: 'Y' });
  assert.equal(out, '/x?id=eq.U&o=O&a=U&PY');
  assert.throws(() => fill('{nope}', {}), /unresolved/);
});
test('fixture has no captured user/org ids or capture-time dates', () => {
  const raw = fs.readFileSync(new URL('./perf/load-routes.json', import.meta.url), 'utf8');
  assert.doesNotMatch(raw, /0000000000a[12]|00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(raw, /\b20\d\d-\d\d-\d\d\b/);
});
