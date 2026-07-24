import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const repo = new URL('..', import.meta.url).pathname;
const bootScript = join(repo, 'scripts/deno-boot-smoke-edge-fns.sh');
const unitScript = join(repo, 'scripts/deno-test-edge-fns.sh');

const fixtureRoot = () => mkdtempSync(join(tmpdir(), 'pmo-deno-inventory-'));

const touch = (path) => {
  mkdirSync(new URL('.', `file://${path}`).pathname, { recursive: true });
  writeFileSync(path, '');
};

test('boot inventory lists every direct function entrypoint', () => {
  const root = fixtureRoot();
  touch(join(root, 'alpha/index.ts'));
  touch(join(root, 'beta/index.ts'));

  const output = execFileSync('bash', [bootScript, '--list'], {
    env: { ...process.env, SUPABASE_FUNCTIONS_ROOT: root },
    encoding: 'utf8',
  }).trim().split('\n');

  assert.deepEqual(output, [join(root, 'alpha/index.ts'), join(root, 'beta/index.ts')]);
});

test('unit inventory discovers nested test directories and reduces them to function roots', () => {
  const root = fixtureRoot();
  touch(join(root, 'alpha/deno.json'));
  touch(join(root, 'alpha/__tests__/handler.test.ts'));
  touch(join(root, 'beta/deno.json'));
  touch(join(root, 'beta/index.test.ts'));
  touch(join(root, '_shared/deep/shared.test.ts'));

  const output = execFileSync('bash', [unitScript, '--list'], {
    env: { ...process.env, SUPABASE_FUNCTIONS_ROOT: root },
    encoding: 'utf8',
  }).trim().split('\n');

  assert.deepEqual(output, [
    join(root, 'alpha'),
    join(root, 'beta'),
    join(root, '_shared'),
  ]);
});

test('both inventories fail closed when discovery is empty', () => {
  const root = fixtureRoot();

  for (const script of [bootScript, unitScript]) {
    const result = spawnSync('bash', [script, '--list'], {
      env: { ...process.env, SUPABASE_FUNCTIONS_ROOT: root },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `${script} unexpectedly accepted an empty inventory`);
    assert.match(result.stderr, /inventory is empty/);
  }
});
