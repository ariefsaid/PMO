import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partition, validateInventory } from '../pmo-portal/unit-shard-balance.mjs';
test('recorded release files balance within 1.3 times the mean deterministically', () => {
  const durations = JSON.parse(readFileSync(new URL('./unit-test-durations.json', import.meta.url))).milliseconds;
  const files = Object.keys(durations);
  const bins = partition(files, 8);
  const mean = bins.reduce((sum, bin) => sum + bin.duration, 0) / 8;
  assert.ok(Math.max(...bins.map(bin => bin.duration)) <= mean * 1.3);
  assert.deepEqual(bins, partition(files.reverse(), 8));
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
  validateInventory(files, partition(files, 8).map(bin => bin.files));
});
test('Vitest sequencer consumes the installed runner context and partitions actual discovery', async () => {
  const { default: Sequencer } = await import('../pmo-portal/unit-sequencer.mjs');
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const root = resolve('pmo-portal');
  const result = spawnSync(resolve(root, 'node_modules/.bin/vitest'), ['list', '--filesOnly'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const files = result.stdout.trim().split('\n').map(file => file.replace(/^\[[^\]]+\] /, ''));
  const specs = files.map(file => ({ moduleId: resolve(root, file) }));
  const shards = [1, 2, 3, 4, 5, 6, 7, 8].map(index => new Sequencer({ config: { root, shard: { index, count: 8 } } }).shard(specs).map(spec => spec.moduleId));
  validateInventory(specs.map(spec => spec.moduleId), shards);
});
