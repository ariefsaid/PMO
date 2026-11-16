/**
 * The registry of company-defaults writers by tier (#1599 ECX-3): the setup verbs ask for a writer by tier and never branch on
 * it. ERPNext only today; Odoo declares `company-defaults.set` pending (#1504) and has no entry, so its request is refused before
 * the database or the ERP is asked. A refusal carries the resolver's classified reason, never a credential or a host.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { CompanyDefaultsWriter } from '../../../pmo-portal/src/lib/adapterSeam/companyDefaults.ts';
import { createErpnextCompanyDefaults, listErpnextCostCentres, type CostCentreRow } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/companyDefaults.ts';
import { erpClientForOrg } from './erpClientForOrg.ts';

export interface CompanyDefaultsTarget {
  company: string;
  writer: CompanyDefaultsWriter;
  /** Every cost centre of the company, as the ERP lists it (fails rather than return a partial list). */
  costCentres(): Promise<CostCentreRow[]>;
}

const FACTORIES: Record<string, (sc: SupabaseClient, orgId: string) => Promise<CompanyDefaultsTarget>> = {
  erpnext: async (sc, orgId) => {
    const r = await erpClientForOrg(sc, orgId, { requireCompany: true });
    if ('refusal' in r) throw new AppError(`The erpnext connection is not ready: ${r.refusal}`, 'config-rejected');
    const company = String(r.config?.company);
    return { company, writer: createErpnextCompanyDefaults(r.client, company), costCentres: () => listErpnextCostCentres(r.client, company) };
  },
};

export function hasCompanyDefaultsWriter(tier: string): boolean {
  return Object.hasOwn(FACTORIES, tier);
}

export async function companyDefaultsForOrg(sc: SupabaseClient, orgId: string, tier: string): Promise<CompanyDefaultsTarget> {
  if (!hasCompanyDefaultsWriter(tier)) throw new AppError('Setting company defaults from PMO is not available for this ERP yet', 'BAD_REQUEST');
  return await FACTORIES[tier](sc, orgId);
}
