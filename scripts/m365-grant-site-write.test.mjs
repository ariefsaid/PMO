// Tests for scripts/m365-grant-site-write.sh with a MOCK `az` on PATH. Nothing here contacts Microsoft.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const SCRIPT = new URL('./m365-grant-site-write.sh', import.meta.url).pathname;
const SITE = 'synthetic.example.invalid,11111111-aaaa-4aaa-8aaa-111111111111,22222222-bbbb-4bbb-8bbb-222222222222';
const APP = '11111111-1111-4111-8111-111111111111';

function sandbox(azExit = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'm365-grant-'));
  const log = join(dir, 'az.log');
  const az = join(dir, 'az');
  writeFileSync(az, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${log}"\nprintf 'SECRET-RESPONSE-BODY'\nexit ${azExit}\n`);
  chmodSync(az, 0o755);
  // Keep the real system PATH for jq/bash; the mock az wins because it is first.
  const run = (...args) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
  return { run, log };
}

test('default and --dry-run print the single request and call no tool', () => {
  for (const extra of [[], ['--dry-run']]) {
    const { run, log } = sandbox();
    const result = run('--site-id', SITE, '--app-id', APP, ...extra);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN/);
    assert.match(result.stdout, /^POST https:\/\/graph\.microsoft\.com\/v1\.0\/sites\/synthetic\.example\.invalid%2C11111111-aaaa-4aaa-8aaa-111111111111%2C22222222-bbbb-4bbb-8bbb-222222222222\/permissions$/m);
    const body = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    assert.deepEqual(body, { roles: ['write'], grantedToIdentities: [{ application: { id: APP } }] });
    assert.equal(existsSync(log), false, 'az must not be invoked in a dry run');
    assert.doesNotMatch(result.stdout + result.stderr, /Bearer|token|secret/i);
  }
});

test('--execute makes exactly the one expected az rest POST and prints a generic result only', () => {
  const { run, log } = sandbox();
  const result = run('--site-id', SITE, '--app-id', APP, '--execute');
  assert.equal(result.status, 0, result.stderr);
  const argv = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(argv.slice(0, 5), ['rest', '--method', 'POST', '--url', `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(SITE)}/permissions`]);
  assert.deepEqual(argv.slice(5, 8), ['--headers', 'Content-Type=application/json', '--body']);
  assert.deepEqual(JSON.parse(argv[8]), { roles: ['write'], grantedToIdentities: [{ application: { id: APP } }] });
  assert.deepEqual(argv.slice(9), ['--output', 'none']);
  assert.ok(!argv.some((arg) => /token|bearer|secret/i.test(arg)), 'no token on argv');
  assert.doesNotMatch(result.stdout, /SECRET-RESPONSE-BODY/);
  assert.match(result.stdout, /Granted/);
});

test('a failing az fails the script (no success claim)', () => {
  const { run } = sandbox(1);
  const result = run('--site-id', SITE, '--app-id', APP, '--execute');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Granted/);
});

test('missing, invalid, duplicate, conflicting and unknown arguments are refused before any call', () => {
  const cases = [
    [],
    ['--site-id', SITE],
    ['--app-id', APP],
    ['--site-id', '../../tenant', '--app-id', APP],
    ['--site-id', 'a/b', '--app-id', APP],
    ['--site-id', 'a?x=1', '--app-id', APP],
    ['--site-id', 'a%2Fb', '--app-id', APP],
    ['--site-id', 'a b', '--app-id', APP],
    ['--site-id', 'a..b', '--app-id', APP],
    ['--site-id', SITE, '--app-id', 'not-a-uuid'],
    ['--site-id', SITE, '--app-id', APP, '--site-id', SITE],
    ['--site-id', SITE, '--app-id', APP, '--app-id', APP],
    ['--site-id', SITE, '--app-id', APP, '--dry-run', '--execute'],
    ['--site-id', SITE, '--app-id', APP, '--execute', '--execute'],
    ['--site-id', SITE, '--app-id', APP, '--token', 'x'],
    ['--site-id', SITE, '--app-id'],
  ];
  for (const args of cases) {
    const { run, log } = sandbox();
    const result = run(...args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(existsSync(log), false, `az must not run for ${JSON.stringify(args)}`);
  }
});

test('the script has no login, secret, token or retry behaviour', () => {
  const source = readFileSync(SCRIPT, 'utf8').split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(source, /az login|op read|curl|--access-token|get-access-token|while .*retry|sleep/);
  assert.equal((source.match(/az rest/g) ?? []).length, 1);
});
