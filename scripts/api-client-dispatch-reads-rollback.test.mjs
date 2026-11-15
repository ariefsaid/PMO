// #2278: the 0876 rollback is a complete statement and removes exactly what 0876 adds to api_client_request_guard().
// Static check of the SQL text (no database): the rollback's function body must equal the 0872 body it restores,
// and every code line 0876 adds over that body must be one of its `-- 0876` lines, which the rollback must not contain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const UP = 'supabase/migrations/0876_api_client_dispatch_reads.sql';
const DOWN = 'supabase/migrations/rollback/0876_api_client_dispatch_reads_down.sql';
const PRIOR = 'supabase/migrations/0872_api_client_capture_reads.sql';

/** The one `create or replace function public.api_client_request_guard()` statement, checked for a closed $$ body. */
export function guardStatement(sql, label) {
  const starts = [...sql.matchAll(/create or replace function public\.api_client_request_guard\(\)/gi)];
  assert.equal(starts.length, 1, `${label}: exactly one api_client_request_guard() definition`);
  const rest = sql.slice(starts[0].index);
  const open = rest.indexOf('$$');
  assert.ok(open > 0, `${label}: the body opens with $$`);
  const close = rest.indexOf('$$', open + 2);
  assert.ok(close > open, `${label}: the body closes with $$`);
  assert.match(rest.slice(close), /^\$\$;\s*$/, `${label}: the statement ends with $$; and nothing follows it`);
  const body = rest.slice(open + 2, close);
  assert.match(body, /^\s*declare\b[\s\S]*\bbegin\b[\s\S]*\bend;\s*$/i, `${label}: the body is declare … begin … end;`);
  assert.equal((body.match(/\bif\b/gi) ?? []).length, 2 * (body.match(/\bend if;/gi) ?? []).length,
    `${label}: every if has its end if`);
  return rest.slice(0, close + 3);
}

/** text[] constants by name. */
export function arrays(stmt) {
  const out = new Map();
  for (const m of stmt.matchAll(/(?<![a-z_])([a-z_]+)\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/g)) {
    out.set(m[1], [...m[2].matchAll(/'([^']+)'/g)].map((n) => n[1]));
  }
  return out;
}

const lines = (stmt) => stmt.split('\n');

function check(up, down, prior) {
  assert.equal(down, prior, 'the rollback restores the 0872 guard body verbatim');
  const downLines = new Set(lines(down));
  const added = lines(up).filter((l) => !downLines.has(l));
  assert.ok(added.length > 0, '0876 adds lines over the 0872 body');
  assert.deepEqual(added.filter((l) => !/--\s*0876\s*$/.test(l) && !/^\s*--/.test(l)), [], 'every code line 0876 adds carries its -- 0876 tag');
  assert.deepEqual(lines(down).filter((l) => /--\s*0876\s*$/.test(l)), [], 'the rollback keeps no -- 0876 line');
  const removed = lines(down).filter((l) => !new Set(lines(up)).has(l));
  assert.deepEqual(removed, [], '0876 removes nothing from the 0872 body');
  const upArrays = arrays(up);
  const downArrays = arrays(down);
  const dropped = [...upArrays.keys()].filter((k) => !downArrays.has(k));
  assert.deepEqual(dropped.sort(), ['dispatch_read_procurement_rpcs', 'dispatch_read_rpcs'], 'the rollback drops the dispatch-read tier');
  assert.deepEqual(dropped.flatMap((k) => upArrays.get(k)).sort(),
    ['actor_authorization_state', 'domain_owned_by_tier', 'pre_cutover_procurement']);
  for (const [k, v] of downArrays) assert.deepEqual(upArrays.get(k), v, `${k} is unchanged by 0876`);
}

test('#2278: the 0876 rollback parses and drops exactly the dispatch-read tier 0876 adds', () => {
  check(guardStatement(read(UP), '0876'), guardStatement(read(DOWN), '0876 rollback'), guardStatement(read(PRIOR), '0872'));
});

test('#2278 self-test: a rollback that keeps a 0876 line, or loses a 0872 line, fails', () => {
  const up = guardStatement(read(UP), '0876');
  const down = guardStatement(read(DOWN), '0876 rollback');
  const prior = guardStatement(read(PRIOR), '0872');
  const kept = down.replace('declare\n', "declare\n  dispatch_read_rpcs constant text[] := array['domain_owned_by_tier'];  -- 0876\n");
  assert.throws(() => check(up, kept, prior));
  const lost = down.replace(/\n[^\n]*stage_admin_rpcs constant[^\n]*/, '');
  assert.throws(() => check(up, lost, prior));
  assert.throws(() => guardStatement(down.replace(/\$\$;$/, ''), 'truncated'));
});
