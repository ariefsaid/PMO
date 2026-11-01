/** Pass (8) — advance an ERPNext org's open connect run (ECA2-T13, #1605). The loop is shared (`_shared/connectRun.ts`). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { advanceConnectRuns as advance } from '../_shared/connectRun.ts';

export { CONNECT_CALLS_PER_TICK, RUN_BUDGET_MS } from '../_shared/connectRun.ts';
export const advanceConnectRuns = (sc: SupabaseClient, org: { orgId: string; bindingId?: string | null }) => advance(sc, org, 'erpnext');
