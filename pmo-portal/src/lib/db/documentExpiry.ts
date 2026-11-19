import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages, type PageResult } from '@/src/lib/pagedRead';

/**
 * Document expiry DAL (#2527, migrations 0970-0974). One read: the expiry list RPC, which is SECURITY INVOKER — RLS decides
 * what each caller sees (medical documents are Admin-only). The RPC is not in the generated types until the next
 * `supabase gen types`, so the call is typed here.
 */
export interface ExpiringDocumentRow {
  id: string;
  subject_kind: 'person' | 'equipment';
  subject_id: string;
  subject_name: string;
  type_name: string;
  is_medical: boolean;
  number: string | null;
  expires_on: string;
  days_left: number;
  medical_status: 'fit' | 'unfit' | null;
  location_note: string | null;
}

export const EXPIRY_WINDOW_DAYS = 30;

export async function listExpiringDocuments(days: number = EXPIRY_WINDOW_DAYS): Promise<ExpiringDocumentRow[]> {
  const rpc = supabase.rpc as unknown as (
    fn: string, args: { p_days: number },
  ) => { range: (from: number, to: number) => PromiseLike<PageResult<ExpiringDocumentRow>> };
  return fetchAllPages((from, to) => rpc.call(supabase, 'list_expiring_documents', { p_days: days }).range(from, to));
}
