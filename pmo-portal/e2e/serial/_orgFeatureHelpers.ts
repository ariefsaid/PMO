import { createClient } from '@supabase/supabase-js';
import { SEED_PASSWORD } from '../helpers';

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const ORG = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';

/**
 * Remove a per-organisation feature override the journey wrote, through the Operator's own RPC
 * (`org_features` gives service_role SELECT only), so the org falls back to its plan like the seed.
 */
export async function clearFeatureOverride(key: string): Promise<void> {
  if (!ANON_KEY) return;
  const auth = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: 'operator@pmo.test', password: SEED_PASSWORD });
  if (error || !data.session) throw new Error(`operator sign-in failed: ${error?.message}`);
  const operator = createClient(URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  const cleared = await operator.rpc('operator_clear_feature_override', { p_org_id: ORG, p_key: key });
  if (cleared.error) throw new Error(`clearing the ${key} override failed: ${cleared.error.message}`);
}
