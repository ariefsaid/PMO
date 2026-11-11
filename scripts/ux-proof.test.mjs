import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { violations } from './ux-proof-metrics.mjs';

test('rendered proof self-test checks its thresholds without an app', () => {
  const result = spawnSync(process.execPath, ['scripts/ux-proof.mjs', '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self-test.*pass/i);
});

test('rendered proof fails when a route renders fewer chart svgs than its baseline', () => {
  const failures = violations({ chartCount: 1, smallTextSamples: {} }, undefined, '/finance @1440', 2);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /chartCount=1.*baseline 2/);
  assert.match(failures[0], /svg\.recharts-surface/);
  assert.deepEqual(violations({ chartCount: 2, smallTextSamples: {} }, undefined, '/finance @1440', 2), []);
});
