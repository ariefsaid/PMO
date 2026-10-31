#!/usr/bin/env node
// Money / SoD mutation proof for #1512 (ADR-0030 Layer 1; CLAUDE.md "mutation-check anything security-critical").
// Usage: scripts/with-db-lock.sh node scripts/stock-mutation-proof.mjs [caseId ...]    (refuses without the DB lock)
import { spawnSync } from 'node:child_process';
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// $PSQL or psql on PATH talks to DB_URL; with neither (the shared Mac has no psql) use the local stack's container.
const hasPsql = !process.env.PSQL && spawnSync('psql', ['--version']).status === 0;
const PSQL_CMD = process.env.PSQL ? [process.env.PSQL, DB] : hasPsql ? ['psql', DB]
  : ['docker', 'exec', '-i', 'supabase_db_pmo-portal', 'psql', '-U', 'postgres', '-d', 'postgres'];
export const CASES = [
  { id: 'admin_only',   fn: 'public.set_stock_warehouse_keeper(uuid,uuid,boolean)', from: /(v_admin := )[^;]+(;\s*-- mut:admin_only)/,        to: '$1true$2', test: 'supabase/tests/stock_master_data.test.sql' },
  { id: 'owned',        fn: 'public.stock_assert_standalone(uuid)',                from: /(v_allowed := )[^;]+(;\s*-- mut:owned)/,            to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'keeper',       fn: 'public.stock_assert_keeper(uuid,uuid,uuid)',          from: /(v_keeper := )[\s\S]*?(;\s*-- mut:keeper\b)/,       to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'keeper_admin', fn: 'public.stock_assert_keeper(uuid,uuid,uuid)',          from: /(v_admin := )[^;]+(;\s*-- mut:keeper_admin)/,        to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'future',       fn: 'public.stock_assert_dates(uuid,date)',                from: /(v_future_ok := )[^;]+(;\s*-- mut:future)/,         to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'backdate',     fn: 'public.stock_assert_dates(uuid,date)',                from: /(v_old_ok := )[^;]+(;\s*-- mut:backdate)/,          to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'avg',          fn: 'public.stock_write_entry(public.stock_documents,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid)',
                        from: /round\(v_out \* b\.value_on_hand \/ b\.qty_on_hand, 2\)(\s*end;\s*-- mut:avg)/, to: 'round(v_out * b.value_on_hand / b.qty_on_hand, 2) + 1$1', test: 'supabase/tests/stock_valuation.test.sql' },
  { id: 'costignore',   fn: 'public.stock_insert_lines(public.stock_documents,jsonb)', from: /(case when )p_doc\.kind in \('receive','count'\) or \(p_doc\.kind = 'adjustment' and t\.e->>'direction' = 'in'\)(\s*then \(t\.e->>'unit_cost'\)::numeric end,\s*-- mut:costignore)/, to: '$1true$2', test: 'supabase/tests/stock_posting_guards.test.sql' },
  { id: 'insufficient', fn: 'public.stock_write_entry(public.stock_documents,uuid,uuid,uuid,numeric,numeric,uuid,uuid,uuid)', from: /if v_out > b\.qty_on_hand then/, to: 'if false then', test: 'supabase/tests/stock_valuation.test.sql' },
  { id: 'immutable',    fn: 'public.guard_stock_ledger_append_only()', from: /raise exception 'STK_IMMUTABLE: the stock ledger is append-only' using errcode = 'P0001';/, to: 'return new;', test: 'supabase/tests/stock_immutability_idempotency.test.sql' },
  { id: 'conserve',     fn: 'public.stock_apply_transfer(public.stock_documents,boolean)', from: /-v_out(, null, null, null\);\s*-- mut:conserve)/, to: '-v_out + 1$1', test: 'supabase/tests/stock_valuation.test.sql' },
  // S2b (0414): issue and return.
  { id: 'projactive',  fn: 'public.stock_apply_issue(public.stock_documents,boolean)',  from: /(v_active := )[^;]+(;\s*-- mut:projactive)/, to: '$1true$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'projorg',     fn: 'public.stock_apply_issue(public.stock_documents,boolean)',  from: / and p\.org_id = p_doc\.org_id;/,            to: ';',        test: 'supabase/tests/stock_tenant_isolation.test.sql' },
  { id: 'boq',         fn: 'public.stock_apply_issue(public.stock_documents,boolean)',  from: /(v_boq_ok := )[\s\S]*?(;\s*-- mut:boq)/,      to: '$1true$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'cap',         fn: 'public.stock_apply_return(public.stock_documents,boolean)', from: /(v_cap_ok := )[^;]+(;\s*-- mut:cap\b)/,       to: '$1true$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'cap_post',    fn: 'public.stock_apply_return(public.stock_documents,boolean)', from: /(if )v_ret \+ l\.quantity > v_issued( then\s*-- mut:cap_post)/, to: '$1false$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'returncost',  fn: 'public.stock_apply_return(public.stock_documents,boolean)', from: /(round\(l\.quantity \* v_issued_val \/ v_issued, 2\))(\s*end;\s*-- mut:returncost)/, to: '$1 + 1$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'returnclamp', fn: 'public.stock_apply_return(public.stock_documents,boolean)', from: /(v_in := )least\(v_in, v_issued_val - v_ret_val\)(;\s*-- mut:returnclamp)/, to: '$1v_in$2', test: 'supabase/tests/stock_out_flows.test.sql' },
  { id: 'lockorder',   fn: 'public.stock_lock_for_document(public.stock_documents)',    from: /(order by l\.item_id, w\.wid)(\s*-- mut:lockorder)/, to: '$1 desc$2', cmd: ['node', 'pmo-portal/src/lib/db/stockPosting.concurrent.integration.mjs'] },
];
// S2b / S4 / S5 / S6 append their cases to this table in their own slice (ids named in each slice's mutation task).
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const psql = (args, opts) => run(PSQL_CMD[0], [...PSQL_CMD.slice(1), ...args], opts);
const sql = (q) => psql(['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]);
// A case names either a pgTAP file (`test`) or a command (`cmd`, e.g. the S2b concurrency script).
const exec = (c) => (c.cmd ? run(c.cmd[0], c.cmd.slice(1)) : run('supabase', ['test', 'db', c.test]));
export function mutate(def, c) {
  const hits = [...def.matchAll(new RegExp(c.from.source, c.from.flags.includes('g') ? c.from.flags : c.from.flags + 'g'))];
  if (hits.length !== 1) throw new Error(`${c.id}: mutation matched ${hits.length} times (expected exactly 1) - the marker moved`);
  const out = def.replace(c.from, c.to);
  if (out === def) throw new Error(`${c.id}: mutation changed nothing`);
  return out;
}
export function runProof(ids = []) {
  if (!process.env.PMO_DB_LOCK_HELD) throw new Error('run under scripts/with-db-lock.sh');
  const results = [];
  for (const c of CASES.filter((x) => !ids.length || ids.includes(x.id))) {
    const orig = sql(`select pg_get_functiondef('${c.fn}'::regprocedure)`).stdout;
    if (!orig) throw new Error(`${c.id}: function ${c.fn} not found`);
    const mutated = mutate(orig, c);
    let red;
    try {
      const apply = psql(['-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: mutated });
      if (apply.status !== 0) throw new Error(`${c.id}: mutated definition did not load: ${apply.stderr}`);
      red = exec(c).status !== 0;
    } finally {
      const restore = psql(['-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: orig });
      if (restore.status !== 0) throw new Error(`${c.id}: RESTORE FAILED - run supabase db reset: ${restore.stderr}`);
    }
    const green = exec(c).status === 0;
    results.push({ id: c.id, red, green });
  }
  return results;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runProof(process.argv.slice(2));
  console.table(r);
  process.exit(r.every((x) => x.red && x.green) ? 0 : 1);
}
