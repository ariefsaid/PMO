import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type CompanyRow = Tables<'companies'>;

/** Client companies in the caller's org (for the client filter dropdown). RLS scopes org. */
export async function listClientCompanies(): Promise<CompanyRow[]> {
  const { data, error } = await supabase.from('companies').select('*').eq('type', 'Client');
  if (error) throw new Error(error.message);
  return data ?? [];
}
