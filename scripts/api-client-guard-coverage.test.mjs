// AC-ROP-012: every RPC and table the command-line client reaches with the caller's own token appears in the
// latest api_client_request_guard() body. A command-line sign-in carries client_id, so an unlisted name is
// refused before it runs; a mocked test never sees that (#2276).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const cliFiles = ['scripts/pmo.mjs', ...fs.readdirSync(path.join(root, 'scripts/lib'))
  .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => `scripts/lib/${f}`)];
const cliSrc = cliFiles.map((f) => read(f)).join('\n');

const migrations = path.join(root, 'supabase/migrations');
const latest = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(migrations, f), 'utf8'))).pop();
const guardSql = fs.readFileSync(path.join(migrations, latest), 'utf8');
const guarded = new Set([...guardSql.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));

const names = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

// Deliberately unlisted: `pmo budgets activate` is disabled (ACTIVATION_ENABLED) until the owner rules. An entry that
// becomes listed fails the test, so the exception cannot outlive the decision.
const KNOWN_UNLISTED = new Set(['activate_budget_version']);

/** [name, kind, where] for every call the CLI makes with the caller's token. */
function calls() {
  const out = [];
  for (const n of names(cliSrc, /\/rest\/v1\/rpc\/([a-z_0-9]+)/g)) out.push([n, 'rpc', 'pmo (direct)']);
  for (const n of names(cliSrc, /\bapi\.rpc\(\s*'([a-z_0-9]+)'/g)) out.push([n, 'rpc', 'pmo (via api.rpc)']);
  for (const n of names(cliSrc, /\/rest\/v1\/([a-z_0-9]+)[?`'"]/g)) out.push([n, 'table', 'pmo (direct)']);
  for (const fn of new Set(names(cliSrc, /\/functions\/v1\/([a-z0-9-]+)/g))) {
    const f = path.join(root, 'supabase/functions', fn, 'index.ts');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const n of names(src, /\bcaller\s*\.rpc\(\s*'([a-z_0-9]+)'/g)) out.push([n, 'rpc', `function ${fn}`]);
    for (const n of names(src, /\bcaller\s*\.from\(\s*'([a-z_0-9]+)'/g)) out.push([n, 'table', `function ${fn}`]);
  }
  return out;
}

test('AC-ROP-012: the guard lists every RPC and table the CLI and its functions reach with the caller token', () => {
  const found = calls();
  assert.ok(found.some(([n]) => n === 'purchase_capture_source_page'), 'the scan sees the purchase-capture function');
  for (const n of KNOWN_UNLISTED) assert.equal(guarded.has(n), false, `${n} is now listed: drop it from KNOWN_UNLISTED`);
  const missing = found.filter(([n]) => !guarded.has(n) && !KNOWN_UNLISTED.has(n)).map(([n, k, w]) => `${k} ${n} (${w})`);
  assert.deepEqual([...new Set(missing)], [], `unlisted in ${latest}`);
});
