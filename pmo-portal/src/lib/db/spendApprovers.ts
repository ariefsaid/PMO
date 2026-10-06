import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';

/** #803 — one row of `spend_approvers`: a project approver, or (projectId null) a senior-set member. */
export interface SpendApproverRow {
  id: string;
  projectId: string | null;
  projectName: string | null;
  profileId: string;
  fullName: string;
}

interface RawRow {
  id: string;
  project_id: string | null;
  profile_id: string;
  project: { name: string } | null;
  profile: { full_name: string } | null;
}

// spend_approvers has TWO FKs to profiles (profile_id, created_by): the embed names its constraint.
const SELECT =
  'id, project_id, profile_id, project:projects(name), profile:profiles!spend_approvers_profile_id_fkey(full_name)';

/** Every active member reads (RLS). org_id is NEVER sent. Senior set first, then by project, then name. */
export async function listSpendApprovers(): Promise<SpendApproverRow[]> {
  const { data, error } = await supabase.from('spend_approvers').select(SELECT);
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as unknown as RawRow[])
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project?.name ?? null,
      profileId: r.profile_id,
      fullName: r.profile?.full_name ?? '',
    }))
    .sort(
      (a, b) =>
        (a.projectName ?? '').localeCompare(b.projectName ?? '') || a.fullName.localeCompare(b.fullName),
    );
}

/** Admin-only (RLS). `projectId` null = the overhead/over-budget set. org_id is stamped server-side. */
export async function addSpendApprover(profileId: string, projectId: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('spend_approvers')
    .insert({ profile_id: profileId, project_id: projectId })
    .select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, 'The approver was not added. Only an Admin can change spend approvers.');
}

/** Admin-only (RLS). A USING denial deletes nothing silently — assertWriteLanded makes it loud (#541). */
export async function removeSpendApprover(id: string): Promise<void> {
  const { data, error } = await supabase.from('spend_approvers').delete().eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, 'The approver was not removed. Only an Admin can change spend approvers.');
}
