import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveErpAuthPair } from './erpAuthPair.ts';
import { isPermittedErpSiteUrl } from './erpHostGuard.ts';

export interface ErpClientForOrg {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  maxRetries: 0;
}

export type ErpClientRefusal = 'not-found' | 'inactive' | 'invalid-site' | 'credentials' | 'company-not-set';
export type ErpClientForOrgResult =
  | { client: ErpClientForOrg; config: Record<string, unknown> | null }
  | { refusal: ErpClientRefusal };

/** Resolve the active org ERP binding, validate its destination, and resolve its credentials once. */
export async function erpClientForOrg(
  serviceClient: SupabaseClient,
  orgId: string,
  options: { requireCompany?: boolean } = {},
): Promise<ErpClientForOrgResult> {
  const { data: binding, error } = await serviceClient
    .from('external_org_bindings')
    .select('site_url,secret_ref,status,activated_at,config')
    .eq('org_id', orgId)
    .eq('external_tier', 'erpnext')
    .maybeSingle();
  if (error || !binding) return { refusal: 'not-found' };
  if (binding.status !== 'active' || !binding.activated_at) return { refusal: 'inactive' };

  const config = binding.config as Record<string, unknown> | null;
  if (options.requireCompany && (typeof config?.company !== 'string' || !config.company))
    return { refusal: 'company-not-set' };

  if (!(await isPermittedErpSiteUrl(binding.site_url))) return { refusal: 'invalid-site' };

  try {
    const credentials = await resolveErpAuthPair(serviceClient, { orgId, secretRef: binding.secret_ref });
    return {
      client: { ...credentials, baseUrl: binding.site_url, fetchImpl: fetch, maxRetries: 0 },
      config,
    };
  } catch {
    return { refusal: 'credentials' };
  }
}
