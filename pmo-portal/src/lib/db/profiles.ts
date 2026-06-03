import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProfileRow = Tables<'profiles'>;

/** Profiles eligible for the PM filter (role = 'Project Manager'; OD-2). RLS scopes org. */
export async function listProjectManagers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'Project Manager');
  if (error) throw new Error(error.message);
  return data ?? [];
}
