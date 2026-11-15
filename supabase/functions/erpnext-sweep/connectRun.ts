/** Pass (8) — advance an ERPNext org's open connect run (ECA2-T13, #1605). The loop is shared (`_shared/connectRun.ts`). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { advanceConnectRuns as advance } from '../_shared/connectRun.ts';
import { sweepErpFetchWrap, type SweepBudgetHolder } from './sweepShared.ts';

export { CONNECT_CALLS_PER_TICK, RUN_BUDGET_MS } from '../_shared/connectRun.ts';

/** #2149: the run's ERP client is the sweep's budget transport, and a tick the budget stopped is not counted. */
export function advanceConnectRuns(sc: SupabaseClient, org: { orgId: string; bindingId?: string | null } & SweepBudgetHolder) {
  let stopped = false;
  return advance(sc, org, 'erpnext', { wrapErpFetch: sweepErpFetchWrap(org, () => { stopped = true; }), budgetStopped: () => stopped });
}
