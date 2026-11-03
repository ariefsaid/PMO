/**
 * The registry of connect adapters by tier (ECA-2): the setup verbs and the sweep ask for an adapter by tier and never
 * branch on it. A record lookup is not a tier branch (`tierBranch.test.ts`). A refusal carries the resolver's classified
 * reason, never a credential or a host.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { ConnectAdapter } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { createErpnextConnectAdapter } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/connectAdapter.ts';
import { createOdooSetupAdapter } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { erpClientForOrg } from './erpClientForOrg.ts';
import { odooClientForOrg } from './odooClientForOrg.ts';

const refused = (tier: string, why: string) => new AppError(`The ${tier} connection is not ready: ${why}`, 'config-rejected');

const FACTORIES: Record<string, (sc: SupabaseClient, orgId: string) => Promise<ConnectAdapter>> = {
  erpnext: async (sc, orgId) => {
    const r = await erpClientForOrg(sc, orgId, { requireCompany: true });
    if ('refusal' in r) throw refused('erpnext', r.refusal);
    return createErpnextConnectAdapter(r.client, String(r.config?.company));
  },
  odoo: async (sc, orgId) => {
    const r = await odooClientForOrg(sc, orgId);
    if ('refusal' in r) throw refused('odoo', r.refusal);
    const plan = r.config.analytic_plan_id;
    return createOdooSetupAdapter(bindCall(r.client), {
      companyId: r.companyId as number,
      analyticPlanId: Number.isInteger(plan) ? (plan as number) : null,
      unitMap: (r.config.unit_map ?? {}) as Record<string, string>,
    });
  },
};

export async function connectAdapterForOrg(sc: SupabaseClient, orgId: string, tier: string): Promise<ConnectAdapter> {
  if (!Object.hasOwn(FACTORIES, tier)) throw new AppError('Unknown ERP', 'config-rejected');
  return await FACTORIES[tier](sc, orgId);
}
