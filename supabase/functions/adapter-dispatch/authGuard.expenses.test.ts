// AC-EXP-125 [Deno] — the sweep re-authorizes expense replays with checkErpnextCommandAuthorization. The ROLE half
// is delegated to expense_posting_for_push (0263 §5 re-checks the recorded actor's current role); the ACTIVE half
// and the kind/domain check still apply here.
// Verify: cd supabase/functions/adapter-dispatch && deno test authGuard.expenses.test.ts --config deno.json --allow-env --allow-net --allow-read
import { assertEquals } from '@std/assert';
import { checkErpnextCommandAuthorization } from './authGuard.ts';

const client = (role: string, active: boolean, owned = true) => ({
  rpc: async (fn: string) => {
    if (fn === 'domain_owned_by_tier') return { data: owned, error: null };
    if (fn === 'actor_authorization_state') return { data: { role, active }, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  },
});
const cmd = { domain: 'expenses', operation: 'create', record: { id: 'claim-1:approval', erp_doc_kind: 'expense-journal' } };

Deno.test('AC-EXP-125 an active Project Manager approver passes the role half (delegated to the DB gate)', async () => {
  assertEquals((await checkErpnextCommandAuthorization(client('Project Manager', true), 'org-1', 'u-1', cmd)).ok, true);
});
Deno.test('AC-EXP-125 an inactive actor is refused', async () => {
  const r = await checkErpnextCommandAuthorization(client('Finance', false), 'org-1', 'u-1', cmd);
  assertEquals([r.ok, r.status], [false, 403]);
});
Deno.test('AC-EXP-125 an org that does not own expenses on the erpnext tier is refused', async () => {
  const r = await checkErpnextCommandAuthorization(client('Finance', true, false), 'org-1', 'u-1', cmd);
  assertEquals([r.ok, r.status], [false, 403]);
});
Deno.test('AC-EXP-125 a kind of another domain is refused', async () => {
  const r = await checkErpnextCommandAuthorization(client('Finance', true), 'org-1', 'u-1', { ...cmd, record: { id: 'x', erp_doc_kind: 'payment' } });
  assertEquals([r.ok, r.status], [false, 422]);
});
