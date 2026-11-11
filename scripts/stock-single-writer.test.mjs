import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';
const DIR = path.resolve(import.meta.dirname, '../supabase/migrations');
const WRITES = /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?(?:public\.)?(stock_ledger|stock_balances)\b/gi;
// function -> tables it may write. Everything else under supabase/migrations/ must not write these two tables.
const ALLOWED = { stock_write_entry: ['stock_ledger', 'stock_balances'], stock_lock_for_document: ['stock_balances'] };
function functionBodies(sql) {                       // [{ name, body }] by `create [or replace] function [public.]name ... $$ ... $$;`
  return [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)[\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/gi)].map((m) => ({ name: m[1], body: m[3], start: m.index, end: m.index + m[0].length }));
}
test('FR-STK-072 only stock_write_entry writes the ledger and balances; stock_lock_for_document may seed a zero balance row', () => {
  const offenders = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    const fns = functionBodies(sql);
    for (const m of sql.matchAll(WRITES)) {
      const owner = fns.find((fn) => m.index >= fn.start && m.index < fn.end);
      const table = m[2].toLowerCase();
      if (!owner || !(ALLOWED[owner.name] ?? []).includes(table)) offenders.push(`${f}: ${m[0]} (${owner?.name ?? 'top level'})`);
    }
  }
  assert.deepEqual(offenders, [], 'an unexpected writer of stock_ledger / stock_balances');
});
test('the guard is not vacuous: it sees the real writer', () => {
  const sql = fs.readFileSync(path.join(DIR, '0413_stock_posting_engine.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert.ok([...sql.matchAll(WRITES)].length >= 3, 'expected the three real write statements in 0413');
});
test('mutation: a rogue writer is caught', () => {
  const rogue = 'create function public.rogue() returns void language sql as $$ update public.stock_balances set qty_on_hand = 1; $$;';
  const fns = functionBodies(rogue); const m = [...rogue.matchAll(WRITES)][0];
  assert.equal(fns.find((fn) => m.index >= fn.start && m.index < fn.end).name, 'rogue');
  assert.equal((ALLOWED.rogue ?? []).includes('stock_balances'), false);
});
