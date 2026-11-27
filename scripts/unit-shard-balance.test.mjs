import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partition, validateInventory } from '../pmo-portal/unit-shard-balance.mjs';
test('recorded release files balance within 1.3 times the mean deterministically', () => {
  const durations = JSON.parse(readFileSync(new URL('./unit-test-durations.json', import.meta.url))).milliseconds;
  const files = Object.keys(durations);
  const bins = partition(files, 4);
  const mean = bins.reduce((sum, bin) => sum + bin.duration, 0) / 4;
  assert.ok(Math.max(...bins.map(bin => bin.duration)) <= mean * 1.3);
  assert.deepEqual(bins, partition(files.reverse(), 4));
  console.log('Recorded test milliseconds by shard:', bins.map(bin => bin.duration));
});
test('inventory fails closed on omitted, duplicated and undiscovered tests', () => {
  validateInventory(['a', 'b'], [['b'], ['a']]);
  for (const shards of [[['a']], [['a'], ['a', 'b']], [['a', 'b', 'c']]]) {
    assert.throws(() => validateInventory(['a', 'b'], shards));
  }
  assert.throws(() => partition(['a', 'a'], 4));
});
test('affected discovery remains its own complete partition including new files', () => {
  const files = ['new.test.ts', 'other.test.ts'];
  validateInventory(files, partition(files, 4).map(bin => bin.files));
});
