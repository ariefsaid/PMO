// #2734: the seed organisation carries an ACTIVE accounting binding, so it is not a no-ERP organisation. The NEF journeys
// disconnect it for their run (serial lane: org-wide state) and restore it afterwards; the precondition is asserted first.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey } from '../helpers';
import { requireMatchingLocalSupabaseUrls } from '../../src/lib/testing/localSupabaseUrl';

export interface NoErpHandle { restore(): Promise<void> }

export async function disconnectSeedOrgErp(): Promise<NoErpHandle> {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('NEF journeys need the local service client (run via scripts/e2e-local.sh)');
  const admin: SupabaseClient = createClient(requireMatchingLocalSupabaseUrls(undefined, undefined), key, { auth: { persistSession: false } });
  const fin = await admin.from('profiles').select('org_id').eq('email', 'finance@acme.test').single();
  if (fin.error) throw new Error('NEF fixture finance profile: ' + fin.error.message);
  const orgId = fin.data.org_id as string;
  const active = await admin.from('external_org_bindings').select('id').eq('org_id', orgId).eq('status', 'active');
  if (active.error) throw new Error('NEF fixture bindings: ' + active.error.message);
  const ids = (active.data ?? []).map((b) => b.id as string);
  if (ids.length > 0) {
    const off = await admin.from('external_org_bindings').update({ status: 'disconnected' }).in('id', ids).select('id');
    if (off.error) throw new Error('NEF fixture disconnect: ' + off.error.message);
  }
  // Precondition: no active binding and no externally-owned domain, i.e. a no-ERP organisation.
  const still = await admin.from('external_org_bindings').select('id').eq('org_id', orgId).eq('status', 'active');
  const owned = await admin.from('external_domain_ownership').select('domain').eq('org_id', orgId);
  if (still.error || owned.error || (still.data ?? []).length > 0 || (owned.data ?? []).length > 0) {
    throw new Error('NEF precondition failed: the seed organisation is not a no-ERP organisation');
  }
  return {
    async restore() {
      if (ids.length === 0) return;
      const back = await admin.from('external_org_bindings').update({ status: 'active' }).in('id', ids);
      if (back.error) throw new Error('NEF cleanup restore bindings: ' + back.error.message);
    },
  };
}
