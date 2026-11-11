/**
 * Pass (8b) — send the PMO masters an Admin accepted as "send" (ECA3-T7, #1606, FR-ECA-020..022) to ERPNext. The loop lives in
 * `_shared/connectSendsCore.ts`; this wraps it with ERPNext's connection, probe and reissue rule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createErpnextConnectAdapter, erpnextSendProbe } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/connectAdapter.ts';
import { withProbeBudget } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { erpClientForOrg } from '../_shared/erpClientForOrg.ts';
import { erpReason } from '../_shared/erpReason.ts';
import { CONNECT_SENDS_BUDGET_MS, CONNECT_SENDS_PER_TICK, drainSends, type DrainResult } from '../_shared/connectSendsCore.ts';

export { CONNECT_SENDS_BUDGET_MS, CONNECT_SENDS_PER_TICK, CONNECT_SEND_REJECTION_TEXT, type DrainResult } from '../_shared/connectSendsCore.ts';

export function drainConnectSends(sc: SupabaseClient, org: { orgId: string; bindingId?: string | null }, budget = CONNECT_SENDS_PER_TICK,
  clock: { nowMs: () => number; budgetMs: number } = { nowMs: Date.now, budgetMs: CONNECT_SENDS_BUDGET_MS }): Promise<DrainResult> {
  return drainSends(sc, org, {
    tier: 'erpnext',
    async open() {
      const conn = await erpClientForOrg(sc, org.orgId, { requireCompany: true });
      if ('refusal' in conn) return { refusal: conn.refusal };
      const company = String(conn.config?.company);
      return { connect: createErpnextConnectAdapter(conn.client, company), probe: (kind, master) => erpnextSendProbe(withProbeBudget(conn.client), company, kind, master) };
    },
    // ERPNext refuses a second Project with the same name and a second Item with the same code, so a probe miss proves the create never
    // landed; a company name is not unique and can be edited in Desk, so a missing company is held for a person (the Odoo rule too).
    reissueOnInconclusiveAbsence: (kind) => kind !== 'party',
    reasonOf: erpReason,
  }, budget, clock);
}
