import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProcurementRow = Tables<'procurements'>;

/** A procurement row with project/vendor/requester names resolved in SQL (kills render-time .find()). */
export type ProcurementWithRefs = ProcurementRow & {
  project: { name: string; code: string | null } | null;
  vendor: { name: string } | null;
  requested_by: { full_name: string } | null;
};

const SELECT =
  '*, project:projects(name,code), vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name)';

/**
 * List procurements for the caller's org. org_id is NEVER sent — RLS (org_id = auth_org_id())
 * scopes rows (FR-DAL-PROC-001). The page filters the cached list client-side this issue.
 */
export async function listProcurements(): Promise<ProcurementWithRefs[]> {
  const { data, error } = await supabase.from('procurements').select(SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ProcurementWithRefs[];
}
