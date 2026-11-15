import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findOffenders } from './check-no-attribution.mjs';

const script = fileURLToPath(new URL('./check-no-attribution.mjs', import.meta.url));

function repo(messages, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'no-attr-test-'));
  const base = { ...process.env, GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.test', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.test' };
  const git = (args, e = base) => execFileSync('git', args, { cwd: dir, env: e, encoding: 'utf8' });
  git(['init', '-q']);
  writeFileSync(join(dir, 'f'), '0');
  git(['add', 'f']);
  git(['commit', '-q', '-m', 'base']);
  const baseSha = git(['rev-parse', 'HEAD']).trim();
  messages.forEach((m, i) => {
    writeFileSync(join(dir, 'f'), String(i + 1));
    git(['commit', '-q', '-am', m], { ...base, ...env });
  });
  return { dir, baseSha };
}

test('AC-NOATTR-001: a clean range passes', () => {
  const { dir, baseSha } = repo(['one', 'two']);
  try { assert.deepEqual(findOffenders(baseSha, 'HEAD', dir), []); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AC-NOATTR-002: a message line is reported with its hash', () => {
  const { dir, baseSha } = repo(['fine', 'x\n\nGenerated' + ' with a tool']);
  try {
    const found = findOffenders(baseSha, 'HEAD', dir);
    assert.equal(found.length, 1);
    assert.match(found[0].hash, /^[0-9a-f]{40}$/);
    assert.ok(found[0].matched[0].startsWith('message line'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AC-NOATTR-003: author and committer identity are checked, case-insensitively', () => {
  const { dir, baseSha } = repo(['one'], { GIT_AUTHOR_NAME: 'CLAU' + 'DE', GIT_COMMITTER_EMAIL: 'a@Anthro' + 'pic.test' });
  try {
    const [o] = findOffenders(baseSha, 'HEAD', dir);
    assert.ok(o.matched.some((m) => m.startsWith('author name')));
    assert.ok(o.matched.some((m) => m.startsWith('committer email')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AC-NOATTR-004: the CLI exits 1 on an offender and 0 when clean; --self-test passes', () => {
  const bad = repo(['Co-Authored' + '-By: x']);
  const ok = repo(['fine']);
  try {
    assert.throws(() => execFileSync('node', [script, bad.baseSha], { cwd: bad.dir, stdio: 'pipe' }), (e) => e.status === 1);
    execFileSync('node', [script, ok.baseSha], { cwd: ok.dir, stdio: 'pipe' });
    execFileSync('node', [script, '--self-test'], { stdio: 'pipe' });
  } finally { rmSync(bad.dir, { recursive: true, force: true }); rmSync(ok.dir, { recursive: true, force: true }); }
});

const T = 'clau' + 'de';
const V = 'anthro' + 'pic';
const withDir = (messages, env, fn) => {
  const { dir, baseSha } = repo(messages, env);
  try { return fn(findOffenders(baseSha, 'HEAD', dir)); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('AC-NOATTR-005: ordinary mentions of the tool name in a message pass', () => {
  withDir(['docs: update ' + T.toUpperCase() + '.md and .' + T + '/settings.json'], {}, (o) => assert.deepEqual(o, []));
});

test('AC-NOATTR-006: each attribution form in a message fails', () => {
  const forms = [
    'Co-Authored' + '-By: Someone <a@b.test>',
    T[0].toUpperCase() + T.slice(1) + '-Session: https://example.test/x',
    'Generated' + ' with a tool',
    'contact noreply@' + V + '.com',
    'see https://' + T + '.ai/code/session_1',
  ];
  for (const f of forms) withDir(['x\n\n' + f], {}, (o) => assert.equal(o.length, 1, f));
});

test('AC-NOATTR-007: tool-named author and vendor-domain committer email fail', () => {
  withDir(['one'], { GIT_AUTHOR_NAME: T }, (o) => assert.ok(o[0].matched[0].startsWith('author name')));
  withDir(['one'], { GIT_COMMITTER_EMAIL: 'noreply@' + V + '.com' }, (o) => assert.ok(o[0].matched[0].startsWith('committer email')));
});
