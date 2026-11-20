#!/usr/bin/env node
// Money mutation proof for #2588 opening balances (CLAUDE.md "mutation-check anything security-critical"). Each case breaks
// one `-- mut:` line of supabase/migrations/1046_opening_balances.sql; supabase/tests/opening_balances.test.sql must go red.
// Usage: scripts/with-db-lock.sh node scripts/opening-balances-mutation-proof.mjs [caseId ...]
import { runProof } from './stock-mutation-proof.mjs';
const test = 'supabase/tests/opening_balances.test.sql';
const concurrent = 'pmo-portal/src/lib/db/openingBalances.concurrent.integration.mjs';
export const CASES = [
  { id: 'admin',          fn: 'public.opening_assert_load(uuid,date)', from: /if public\.auth_role\(\) is distinct from 'Admin' then(\s*-- mut:admin)/, to: 'if false then$1', test },
  { id: 'one_date',       fn: 'public.opening_assert_load(uuid,date)', from: /and o\.as_of <> p_as_of\) then(\s*-- mut:one_date)/, to: 'and false) then$1', test },
  { id: 'running',        fn: 'public.load_work_order_opening(uuid,date,jsonb,text)', from: /if v_status <> 'Issued' then(\s*-- mut:running)/, to: 'if false then$1', test },
  { id: 'wo_activity',    fn: 'public.load_work_order_opening(uuid,date,jsonb,text)', from: /if public\.opening_work_order_has_activity\(p_work_order_id, null\) then(\s*-- mut:wo_activity)/, to: 'if false then$1', test },
  { id: 'wo_reverse',     fn: 'public.reverse_opening_balance(uuid)', from: /if public\.opening_work_order_has_activity\(o\.work_order_id, o\.id\) then(\s*-- mut:wo_reverse)/, to: 'if false then$1', test },
  { id: 'stock_activity', fn: 'public.load_stock_opening(uuid,date,jsonb,text)', from: /if public\.opening_location_has_movement\(v_org, p_warehouse_id, null\) then(\s*-- mut:stock_activity)/, to: 'if false then$1', test },
  { id: 'stock_reverse',  fn: 'public.reverse_opening_balance(uuid)', from: /if public\.opening_location_has_movement\(v_org, o\.warehouse_id, o\.stock_document_id\) then(\s*-- mut:stock_reverse)/, to: 'if false then$1', test },
  { id: 'act_acceptance', fn: 'public.opening_work_order_has_activity(uuid,uuid)', from: /select exists \(select 1 from public\.work_order_acceptances a [^\n]*(-- mut:act_acceptance)/, to: 'select false  $1', test },
  { id: 'act_invoice',    fn: 'public.opening_work_order_has_activity(uuid,uuid)', from: /or exists \(select 1 from public\.work_order_billing_lines l [^\n]*(-- mut:act_invoice)/, to: 'or false  $1', test },
  { id: 'reversed_reload', fn: 'public.opening_location_has_movement(uuid,uuid,uuid)', from: /and not exists \(select 1 from public\.opening_balances r [^\n]*(-- mut:reversed_reload)/, to: '$1', test },
  // The two-session proofs (one row lock, one organisation lock).
  { id: 'wo_row_lock', fn: 'public.reverse_opening_balance(uuid)', from: / for update;(\s*-- mut:wo_row_lock)/, to: ';$1', cmd: ['node', concurrent] },
  { id: 'org_lock',    fn: 'public.opening_assert_load(uuid,date)', from: /perform pg_advisory_xact_lock\(hashtextextended\('opening_balance:' \|\| p_org::text, 0\)\);(\s*-- mut:org_lock)/, to: 'perform 1;$1', cmd: ['node', concurrent] },
  // The double-count proof: drop the opening's claimed value from the work-order billing lines.
  { id: 'billing_lines',  view: 'public.work_order_billing_lines', from: /ob\.reversed_at IS NULL/, to: 'false', test },
];
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runProof(process.argv.slice(2), CASES);
  console.table(r);
  process.exit(r.every((x) => x.red && x.green) ? 0 : 1);
}
