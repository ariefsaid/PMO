import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const recorded = JSON.parse(readFileSync(new URL('../scripts/unit-test-durations.json', import.meta.url))).milliseconds;
export function partition(files, count, durations = recorded) {
  assert.ok(Number.isInteger(count) && count > 0);
  assert.equal(new Set(files).size, files.length, 'duplicate test in discovery');
  const bins = Array.from({ length: count }, () => ({ files: [], duration: 0 }));
  const weight = file => durations[file] ?? 1000;
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const bin = bins.reduce((a, b) => a.duration <= b.duration ? a : b);
    bin.files.push(file);
    bin.duration += weight(file);
  }
  validateInventory(files, bins.map(bin => bin.files));
  return bins;
}
export function validateInventory(discovered, shards) {
  const union = shards.flat();
  assert.equal(new Set(union).size, union.length, 'duplicate shard entry');
  assert.deepEqual([...union].sort(), [...discovered].sort(), 'shard union differs from runner discovery');
}
