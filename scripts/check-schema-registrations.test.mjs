import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('schema registrations reports three scratch gaps and clears all three after registration', () => {
  const result = spawnSync('bash', ['scripts/check-schema-registrations.sh', '--self-test'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /schema registration self-test: exactly three gaps, then clean/);
});
