import test from 'node:test';
import assert from 'node:assert/strict';
import { scope } from './ci-test-scope.mjs';

test('actual affected selection over 400 files uses full four-shard lane, regardless of changed paths', () => {
  const changes = [{ status: 'M', path: 'pmo-portal/src/lib/example.ts' }];
  const small = scope(changes, { affectedTestCount: 400 });
  assert.deepEqual([small.unit, small.shards], ['affected', 1]);
  assert.deepEqual(small, scope(changes));
  const broad = scope(changes, { affectedTestCount: 401 });
  assert.deepEqual([broad.unit, broad.shards], ['full', 4]);
  assert.match(broad.reason, /401 affected tests > 400/);
  assert.deepEqual([broad.pgtap, broad.deno], [small.pgtap, small.deno]);
});
