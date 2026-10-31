/**
 * THE Odoo client resolver (FR-ODC-100, NFR-ODC-001): the only place an Odoo key leaves Vault. Every check runs
 * before the key is read, and every Odoo request goes through the host guard. No later slice builds its own.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardedErpFetch, isPermittedErpSiteUrl } from './erpHostGuard.ts';
import { externalConnectEnabled } from './externalConnectEnabled.ts';
import type { OdooClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

export type OdooClientRefusal = 'not-found' | 'inactive' | 'invalid-site' | 'credentials' | 'company-not-set' | 'kill-switch';
export type OdooClientForOrgResult =
  | { client: OdooClientDeps; config: Record<string, unknown>; companyId: number | null }
  | { refusal: OdooClientRefusal };

/** Activation and company are required unless a setup step (company listing, activation) opts out. */
export async function odooClientForOrg(
  sc: SupabaseClient,
  orgId: string,
  options: { requireActivated?: boolean; requireCompany?: boolean } = {},
): Promise<OdooClientForOrgResult> {
  if (!externalConnectEnabled()) return { refusal: 'kill-switch' };
  const { data: b, error } = await sc.from('external_org_bindings').select('site_url,secret_ref,status,activated_at,config')
    .eq('org_id', orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error || !b) return { refusal: 'not-found' };
  if (b.status !== 'active' || (options.requireActivated !== false && !b.activated_at)) return { refusal: 'inactive' };
  const config = (b.config ?? {}) as Record<string, unknown>;
  const companyId = Number.isInteger(config.odoo_company_id) ? (config.odoo_company_id as number) : null;
  if (options.requireCompany !== false && companyId === null) return { refusal: 'company-not-set' };
  if (!(await isPermittedErpSiteUrl(b.site_url))) return { refusal: 'invalid-site' };
  const { data: key, error: keyError } = await sc.rpc('read_vault_secret', { p_secret_ref: b.secret_ref });
  // An Odoo key is one token; a `a:b` value is some other tier's pair under this reference — refuse it.
  if (keyError || typeof key !== 'string' || key === '' || key.includes(':')) return { refusal: 'credentials' };
  return {
    client: { baseUrl: b.site_url, apiKey: key, database: String(config.database ?? ''), fetchImpl: guardedErpFetch(b.site_url) },
    config,
    companyId,
  };
}
