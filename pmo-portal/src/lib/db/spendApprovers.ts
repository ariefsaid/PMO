import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/** #803 — one row of `spend_approvers`: a project approver, or (projectId null) a senior-set member. */
export interface SpendApproverRow {
  id: string;
  projectId: string | null;
  projectName: string | null;
  profileId: string;
  fullName: string;
  /** #2695 — the tier this approver sits in (request amount from which they decide); absent = the base tier. */
  minAmount?: number;
}

interface RawRow {
  id: string;
  project_id: string | null;
  profile_id: string;
  min_amount: number | string | null;
  project: { name: string } | null;
  profile: { full_name: string } | null;
}

// spend_approvers has TWO FKs to profiles (profile_id, created_by): the embed names its constraint.
const SELECT =
  'id, project_id, profile_id, min_amount, project:projects(name), profile:profiles!spend_approvers_profile_id_fkey(full_name)';

/** Every active member reads (RLS). org_id is NEVER sent. Senior set first, then by project, then name. */
export async function listSpendApprovers(): Promise<SpendApproverRow[]> {
  // Complete keyset scan: one capped response would silently hide approvers past db-max-rows.
  const data = await fetchAllRowsByKeyset<RawRow>(async (afterId, limit) => {
    let q = supabase.from('spend_approvers').select(SELECT).order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    const res = await q.limit(limit);
    return { data: res.data as unknown as RawRow[] | null, error: res.error };
  });
  return data
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project?.name ?? null,
      profileId: r.profile_id,
      fullName: r.profile?.full_name ?? '',
      ...(r.min_amount == null ? {} : { minAmount: Number(r.min_amount) }),
    }))
    .sort(
      (a, b) =>
        (a.projectName ?? '').localeCompare(b.projectName ?? '') || a.fullName.localeCompare(b.fullName),
    );
}

/** Admin-only (RLS). `projectId` null = the overhead/over-budget set. org_id is stamped server-side. */
export async function addSpendApprover(
  profileId: string,
  projectId: string | null,
  minAmount: number | null = null,
): Promise<void> {
  const { data, error } = await supabase
    .from('spend_approvers')
    .insert({ profile_id: profileId, project_id: projectId, ...(minAmount === null ? {} : { min_amount: minAmount }) })
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

/** #2695 — are approver lists narrowed by amount tier? Every active member reads (RLS); no row means off. */
export async function getSpendApprovalTiersEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('spend_approval_settings').select('tiers_enabled').maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data?.tiers_enabled === true;
}

/** Admin-only (RLS). org_id is stamped server-side; the unique org row is created on first use. */
export async function setSpendApprovalTiersEnabled(enabled: boolean): Promise<void> {
  const { data: existing, error: readError } = await supabase.from('spend_approval_settings').select('id').maybeSingle();
  if (readError) throw new AppError(readError.message, readError.code);
  const res = existing
    ? await supabase.from('spend_approval_settings').update({ tiers_enabled: enabled }).eq('id', existing.id).select('id')
    : await supabase.from('spend_approval_settings').insert({ tiers_enabled: enabled }).select('id');
  if (res.error) throw new AppError(res.error.message, res.error.code);
  assertWriteLanded(res.data, 'The setting was not saved. Only an Admin can change spend approvers.');
}
