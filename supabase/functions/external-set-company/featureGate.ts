import type { SupabaseClient } from '@supabase/supabase-js';

export type FeatureDecision = 'on' | 'off' | 'unavailable';

/** Resolve the effective ERP entitlement through the service-only S2 projection. */
export async function erpSyncFeatureDecision(client: SupabaseClient, orgId: string): Promise<FeatureDecision> {
  const { data, error } = await client.rpc('service_feature_enabled', {
    p_org_id: orgId,
    p_key: 'erp_sync',
  });
  if (error) return 'unavailable';
  return data === true ? 'on' : 'off';
}
