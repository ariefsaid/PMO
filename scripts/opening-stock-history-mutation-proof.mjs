#!/usr/bin/env node
// Mutation proof for opening stock history (docs/specs/opening-stock-history.spec.md). Each case breaks one `-- mut:` line of
// supabase/migrations/1901_opening_stock_history_rpcs.sql; supabase/tests/1900_opening_stock_history.test.sql must go red.
// Usage: scripts/with-db-lock.sh node scripts/opening-stock-history-mutation-proof.mjs [caseId ...]
import { runProof } from './stock-mutation-proof.mjs';
const test = 'supabase/tests/1900_opening_stock_history.test.sql';
export const CASES = [
  { id: 'zero_cost',  fn: 'public.opening_history_plan(uuid,date,jsonb)', from: /if coalesce\(v_c, 0\) <> 0 then(\s*v_msg := 'STK_ZERO_COST: row ' \|\| r\.n;\s*-- mut:zero_cost)/, to: 'if false then$1', test },
  { id: 'over_issue', fn: 'public.opening_history_plan(uuid,date,jsonb)', from: /if v_q > v_sq then(\s*v_msg := 'OPN_OVER_ISSUE: row ' \|\| r\.n;\s*-- mut:over_issue)/, to: 'if false then$1', test },
  { id: 'admin_preview', fn: 'public.preview_stock_opening_history(date,jsonb)', from: /if public\.auth_role\(\) is distinct from 'Admin' then(\s*-- mut:admin)/, to: 'if false then$1', test },
  { id: 'admin_load', fn: 'public.load_stock_opening_history(date,jsonb,uuid,text)', from: /if public\.auth_role\(\) is distinct from 'Admin' then(\s*-- mut:admin)/, to: 'if false then$1', test },
  { id: 'idempotent', fn: 'public.load_stock_opening_history(date,jsonb,uuid,text)', from: /if exists \(select 1 from public\.opening_balances o where o\.org_id = v_org and o\.client_request_id = p_client_request_id\) then(\s*-- mut:idempotent)/, to: 'if false then$1', test },
];
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runProof(process.argv.slice(2), CASES);
  console.table(r);
  process.exit(r.every((x) => x.red && x.green) ? 0 : 1);
}
