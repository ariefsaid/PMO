import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('rendered proof self-test checks its thresholds without an app', () => {
  const result = spawnSync(process.execPath, ['scripts/ux-proof.mjs', '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self-test.*pass/i);
});
