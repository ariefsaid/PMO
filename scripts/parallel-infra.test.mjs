/**
 * parallel-infra.test.mjs — proves the parallel-agent infra scripts actually work:
 * the shared flock core (scripts/lib/flock-run.sh + its three wrappers) and
 * scripts/renumber-migration.sh.
 *
 * Run:  node --test scripts/parallel-infra.test.mjs
 *
 * Everything here uses TEMP lock paths and TEMP git repos — it never touches the
 * real ~/.pmo-*.lock files, the shared Supabase DB, or the real repo.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const DB_LOCK = path.join(SCRIPTS, 'with-db-lock.sh');
const TEST_LOCK = path.join(SCRIPTS, 'with-test-lock.sh');
const RENUMBER = path.join(SCRIPTS, 'renumber-migration.sh');

const withTemp = (prefix, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Async variant — a sync `finally` would delete the dir before the body awaits. */
const withTempAsync = async (prefix, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Run a lock wrapper as a child process, returning the spawned handle. */
const spawnLocked = (script, lockPath, env, cmd) =>
  spawn('bash', [script, ...cmd], {
    env: { ...process.env, ...env, PMO_DB_LOCK: lockPath, PMO_TEST_LOCK: lockPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const waitFor = (child) =>
  new Promise((resolve) => {
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stderr }));
  });

// ── The lock actually excludes ────────────────────────────────────────────────
// Two holders each append START/END markers. If the lock works the sequence is
// strictly A-start A-end B-start B-end (or B before A) — never interleaved.
// Asserting on ORDER, not on sleep duration, is what makes this a real proof.
test('flock core serialises two concurrent holders (no interleaving)', async () => {
  await withTempAsync('pmo-lock-excl-', async (dir) => {
    const lock = path.join(dir, 'the.lock');
    const log = path.join(dir, 'order.log');
    // 1.5s hold: long enough that the waiter's reported wait rounds to >=1s, so
    // the "did it actually block?" assertion below is meaningful.
    const body = (tag) =>
      `printf '${tag}-start\\n' >> ${log}; sleep 1.5; printf '${tag}-end\\n' >> ${log}`;

    const a = spawnLocked(DB_LOCK, lock, {}, ['bash', '-c', body('A')]);
    // Give A a beat to take the lock, so B genuinely contends for it.
    await new Promise((r) => setTimeout(r, 150));
    const b = spawnLocked(DB_LOCK, lock, {}, ['bash', '-c', body('B')]);

    const [ra, rb] = await Promise.all([waitFor(a), waitFor(b)]);
    assert.equal(ra.code, 0, `holder A failed: ${ra.stderr}`);
    assert.equal(rb.code, 0, `holder B failed: ${rb.stderr}`);

    const seq = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.deepEqual(seq, ['A-start', 'A-end', 'B-start', 'B-end'],
      `holders interleaved — the lock did not exclude. Got: ${seq.join(' ')}`);
    // And B must report that it waited.
    assert.match(rb.stderr, /ACQUIRED \(waited [1-9]/,
      'B should report a non-zero wait; it seems not to have contended');
  });
});

// ── Timeout path returns 75 (EX_TEMPFAIL) ─────────────────────────────────────
test('lock timeout exits 75 (EX_TEMPFAIL) instead of blocking forever', async () => {
  await withTempAsync('pmo-lock-timeout-', async (dir) => {
    const lock = path.join(dir, 'the.lock');
    const holder = spawnLocked(DB_LOCK, lock, {}, ['sleep', '5']);
    await new Promise((r) => setTimeout(r, 300));

    const loser = spawnLocked(DB_LOCK, lock, { PMO_DB_LOCK_TIMEOUT: '1' }, ['true']);
    const { code, stderr } = await waitFor(loser);
    assert.equal(code, 75, 'timeout must exit 75/EX_TEMPFAIL');
    assert.match(stderr, /gave up after/);

    holder.kill('SIGKILL');
    await waitFor(holder);
  });
});

// ── Re-entrancy: the held-var reaches the child ───────────────────────────────
// This is what stops a self-wrapping script (scripts/m365-race-probe.sh) from
// re-acquiring its own outer hold and deadlocking against itself.
test('wrapper exports its *_LOCK_HELD var into the child environment', async () => {
  await withTempAsync('pmo-lock-held-', async (dir) => {
    const lock = path.join(dir, 'the.lock');
    const out = execFileSync('bash', [DB_LOCK, 'bash', '-c', 'echo "held=${PMO_DB_LOCK_HELD:-unset}"'],
      { env: { ...process.env, PMO_DB_LOCK: lock }, encoding: 'utf8' });
    assert.match(out, /held=1/, 'PMO_DB_LOCK_HELD must be exported so self-wraps skip re-locking');
  });
});

test('the test lock is a SEPARATE lock from the db lock (they must not block each other)', async () => {
  await withTempAsync('pmo-lock-sep-', async (dir) => {
    const dbLock = path.join(dir, 'db.lock');
    const testLock = path.join(dir, 'test.lock');
    // Hold the db lock, then take the test lock with a short timeout. A shared
    // lockfile would time out (75); separate locks succeed immediately.
    const holder = spawn('bash', [DB_LOCK, 'sleep', '5'],
      { env: { ...process.env, PMO_DB_LOCK: dbLock }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((r) => setTimeout(r, 300));

    const other = spawn('bash', [TEST_LOCK, 'true'], {
      env: { ...process.env, PMO_TEST_LOCK: testLock, PMO_TEST_LOCK_TIMEOUT: '2' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const { code } = await waitFor(other);
    assert.equal(code, 0, 'test lock must be independent of the db lock');

    holder.kill('SIGKILL');
    await waitFor(holder);
  });
});

// ── renumber-migration.sh ─────────────────────────────────────────────────────
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A throwaway repo with two migrations and one doc referencing the first. */
const makeRepo = (dir) => {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'supabase/migrations/0050_add_widgets.sql'), '-- widgets\n');
  fs.writeFileSync(path.join(dir, 'supabase/migrations/0051_add_gadgets.sql'), '-- gadgets\n');
  // A doc referencing the migration in FILENAME form (auto-rewritten) and in
  // BARE form (advisory only).
  fs.writeFileSync(path.join(dir, 'docs.md'),
    'See 0050_add_widgets.sql for widgets.\nReversibility: revert migration 0050 by hand.\nADR 0050 is unrelated prose.\n');
  fs.copyFileSync(path.join(SCRIPTS, 'check-migration-collisions.sh'),
    path.join(dir, 'scripts/check-migration-collisions.sh'));
  fs.chmodSync(path.join(dir, 'scripts/check-migration-collisions.sh'), 0o755);
  fs.copyFileSync(RENUMBER, path.join(dir, 'scripts/renumber-migration.sh'));
  fs.chmodSync(path.join(dir, 'scripts/renumber-migration.sh'), 0o755);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
};

// spawnSync, not execFileSync: execFileSync only surfaces stderr on FAILURE, and
// the success path here has assertions about its advisory stderr output.
const runRenumber = (dir, oldP, newP) => {
  const r = spawnSync('bash', ['scripts/renumber-migration.sh', oldP, newP],
    { cwd: dir, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

test('renumber renames the migration and rewrites filename-form references', () => {
  withTemp('pmo-renumber-ok-', (dir) => {
    makeRepo(dir);
    const { code, stderr } = runRenumber(dir, '0050', '0052');
    assert.equal(code, 0, `expected success, got ${code}: ${stderr}`);

    assert.ok(fs.existsSync(path.join(dir, 'supabase/migrations/0052_add_widgets.sql')),
      'renamed file should exist');
    assert.ok(!fs.existsSync(path.join(dir, 'supabase/migrations/0050_add_widgets.sql')),
      'old file should be gone');

    const docs = fs.readFileSync(path.join(dir, 'docs.md'), 'utf8');
    assert.match(docs, /0052_add_widgets\.sql/, 'filename-form ref must be rewritten');
    assert.doesNotMatch(docs, /0050_add_widgets\.sql/, 'old filename-form ref must not survive');
    // Bare form is deliberately left alone, and surfaced as advisory.
    assert.match(docs, /revert migration 0050 by hand/, 'bare form must NOT be auto-rewritten');
    assert.match(stderr, /REVIEW/, 'bare-form refs should be reported for human review');
  });
});

// MUTATION CHECK — break the sweep and the guard MUST go red. A guard that stays
// green while the rewrite is a no-op is the exact T6 failure this script exists
// to prevent, so it is tested directly rather than assumed.
test('renumber FAILS LOUDLY when the reference sweep silently does nothing', () => {
  withTemp('pmo-renumber-mutant-', (dir) => {
    makeRepo(dir);
    const script = path.join(dir, 'scripts/renumber-migration.sh');
    const src = fs.readFileSync(script, 'utf8');
    // Neuter the rewrite (simulates the zsh word-split no-op) while leaving the
    // guard intact.
    const mutated = src.replace(/^\s*sed -E -i ''.*$/m, '  : # sabotaged rewrite');
    assert.notEqual(mutated, src, 'mutation did not apply — test would be vacuous');
    fs.writeFileSync(script, mutated);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'sabotage');

    const { code, stderr } = runRenumber(dir, '0050', '0052');
    assert.notEqual(code, 0, 'a no-op sweep MUST fail, not report success');
    assert.match(stderr, /SURVIVED the sweep/);
  });
});

test('renumber refuses a dirty working tree', () => {
  withTemp('pmo-renumber-dirty-', (dir) => {
    makeRepo(dir);
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'uncommitted\n');
    const { code, stderr } = runRenumber(dir, '0050', '0052');
    assert.notEqual(code, 0);
    assert.match(stderr, /working tree is dirty/);
  });
});

test('renumber refuses when the target prefix is already taken', () => {
  withTemp('pmo-renumber-taken-', (dir) => {
    makeRepo(dir);
    const { code, stderr } = runRenumber(dir, '0050', '0051');
    assert.notEqual(code, 0);
    assert.match(stderr, /already taken/);
  });
});
