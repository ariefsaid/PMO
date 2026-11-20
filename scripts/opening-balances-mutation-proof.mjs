#!/usr/bin/env node
// Money mutation proof for #2588 opening balances (CLAUDE.md "mutation-check anything security-critical"). Each case breaks
// one `-- mut:` line of supabase/migrations/1046_opening_balances.sql; supabase/tests/opening_balances.test.sql must go red.
// Usage: scripts/with-db-lock.sh node scripts/opening-balances-mutation-proof.mjs [caseId ...]
import { runProof } from './stock-mutation-proof.mjs';
const test = 'supabase/tests/opening_balances.test.sql';
export const CASES = [
  { id: 'admin',          fn: 'public.opening_assert_load(uuid,date)', from: /if public\.auth_role\(\) is distinct from 'Admin' then(\s*-- mut:admin)/, to: 'if false then$1', test },
  { id: 'one_date',       fn: 'public.opening_assert_load(uuid,date)', from: /and o\.as_of <> p_as_of\) then(\s*-- mut:one_date)/, to: 'and false) then$1', test },
  { id: 'running',        fn: 'public.load_work_order_opening(uuid,date,jsonb,text)', from: /if v_status <> 'Issued' then(\s*-- mut:running)/, to: 'if false then$1', test },
  { id: 'wo_activity',    fn: 'public.load_work_order_opening(uuid,date,jsonb,text)', from: /if public\.opening_work_order_has_activity\(p_work_order_id, null\) then(\s*-- mut:wo_activity)/, to: 'if false then$1', test },
  { id: 'wo_reverse',     fn: 'public.reverse_opening_balance(uuid)', from: /if public\.opening_work_order_has_activity\(o\.work_order_id, o\.id\) then(\s*-- mut:wo_reverse)/, to: 'if false then$1', test },
  { id: 'stock_activity', fn: 'public.load_stock_opening(uuid,date,jsonb,text)', from: /if exists \(select 1 from public\.stock_ledger s where s\.warehouse_id = p_warehouse_id\) then(\s*-- mut:stock_activity)/, to: 'if false then$1', test },
  { id: 'stock_reverse',  fn: 'public.reverse_opening_balance(uuid)', from: /if exists \(select 1 from public\.stock_ledger s where s\.warehouse_id = o\.warehouse_id and s\.document_id <> o\.stock_document_id\) then(\s*-- mut:stock_reverse)/, to: 'if false then$1', test },
  // The double-count proof: drop the opening's claimed value from the work-order billing lines.
  { id: 'billing_lines',  view: 'public.work_order_billing_lines', from: /ob\.reversed_at IS NULL/, to: 'false', test },
];
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runProof(process.argv.slice(2), CASES);
  console.table(r);
  process.exit(r.every((x) => x.red && x.green) ? 0 : 1);
}
