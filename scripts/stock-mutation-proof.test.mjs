// Pure checks of the #1512 mutation harness (no DB): the mutation primitive and the case table.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
import { CASES, mutate, runProof } from './stock-mutation-proof.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const c = { id: 'fixture', from: /(v_ok := )[^;]+(;\s*-- mut:fixture)/, to: '$1true$2' };

test('mutate() changes exactly the marked line', () => {
  const def = 'begin\n  v_ok := a > b;   -- mut:fixture\n  if not v_ok then raise; end if;\nend';
  assert.equal(mutate(def, c), 'begin\n  v_ok := true;   -- mut:fixture\n  if not v_ok then raise; end if;\nend');
});
test('mutate() throws when the marker is missing', () => {
  assert.throws(() => mutate('begin v_ok := a > b; end', c), /matched 0 times/);
});
test('mutate() throws when the marker matches twice', () => {
  assert.throws(() => mutate('v_ok := a;   -- mut:fixture\nv_ok := b;   -- mut:fixture', c), /matched 2 times/);
});
test('mutate() throws when the replacement changes nothing', () => {
  assert.throws(() => mutate('v_ok := true;   -- mut:fixture', c), /changed nothing/);
});
test('runProof() refuses to run without the DB lock', () => {
  const held = process.env.PMO_DB_LOCK_HELD; delete process.env.PMO_DB_LOCK_HELD;
  try { assert.throws(() => runProof(), /with-db-lock/); } finally { if (held !== undefined) process.env.PMO_DB_LOCK_HELD = held; }
});
test('every case has a unique id and an owning test that exists', () => {
  const ids = CASES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate case id');
  for (const x of CASES) {
    const file = x.cmd ? x.cmd.at(-1) : x.test;
    assert.ok(file && fs.existsSync(path.join(ROOT, file)), `${x.id}: owning test ${file} does not exist`);
  }
});
test('every -- mut: marker in the stock migrations matches exactly one case pattern', () => {
  const dir = path.join(ROOT, 'supabase/migrations');
  const sql = fs.readdirSync(dir).filter((n) => /^\d+_stock_.*\.sql$/.test(n)).map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).join('\n');
  for (const x of CASES.filter((k) => /mut:/.test(k.from.source))) {
    const hits = [...sql.matchAll(new RegExp(x.from.source, 'g'))].length;
    assert.equal(hits, 1, `${x.id}: pattern matched ${hits} times in the migration source`);
  }
});
