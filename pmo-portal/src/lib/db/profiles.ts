import { fetchAllPages } from '@/src/lib/pagedRead';
import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';

export type ProfileRow = Pick<Tables<'profiles'>,
  'id' | 'full_name' | 'email' | 'role' | 'built_in_role' | 'status' | 'org_id' | 'manager_id'>;

export const PROFILE_LOOKUP_COLUMNS = 'id,full_name,email,role,built_in_role,status,org_id,manager_id';

/** Profiles eligible for the PM filter (role = 'Project Manager'; OD-2). RLS scopes org. */
export async function listProjectManagers(): Promise<ProfileRow[]> {
  const { data, error } = await supabase.from('profiles').select(PROFILE_LOOKUP_COLUMNS).eq('role', 'Project Manager');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * All profiles in the caller's org (the assignee picker source for Tasks; AC-TASK-008). org_id is
 * NEVER sent — RLS (profiles_select: org_id = auth_org_id()) scopes rows. Ordered by full_name for a
 * stable, scannable picker. Any member can be assigned a task, so this is unfiltered by role.
 */
export async function listOrgProfiles(): Promise<ProfileRow[]> {
  return fetchAllPages<ProfileRow>((from, to) =>
    supabase.from('profiles').select(PROFILE_LOOKUP_COLUMNS).order('full_name').order('id').range(from, to),
  );
}
