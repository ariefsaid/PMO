import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import { listOrgProfiles, type ProfileRow } from '@/src/lib/db/profiles';
import { employeeChoiceLabels } from '@/src/components/timesheets/employeeChoiceLabels';
import type { ProposedEmployeeLink } from '@/src/lib/db/timesheetPush';
import { supabase } from '@/src/lib/supabase/client';

interface EmployeeMatchReviewRow {
  id: string;
  employee_name: string | null;
  employee_number: string | null;
  work_email: string | null;
  link_proposed_reason: string | null;
  profile_id: string | null;
  profile?: { full_name?: string | null; email?: string | null } | null;
}

const EMPLOYEE_REVIEW_COLUMNS =
  'id, employee_name, employee_number, work_email, link_proposed_reason, profile_id, profile:profiles!erp_employees_profile_id_fkey(full_name, email)';

/**
 * Active, caller-org profile identities that can be distinguished in a confirmation picker.
 * RLS on listOrgProfiles remains the tenant boundary; no role-based auto-match is inferred here.
 */
function selectableProfiles(profiles: ProfileRow[], confirmedProfileIds: ReadonlySet<string>): ProfileRow[] {
  const active = profiles.filter((profile) =>
    profile.status === 'active'
    && Boolean(profile.full_name.trim() || profile.email.trim())
    && !confirmedProfileIds.has(profile.id),
  );
  const identifiableIds = new Set(employeeChoiceLabels(
    active.map((profile) => ({
      value: profile.id,
      name: profile.full_name,
      email: profile.email,
    })),
    { omitAmbiguous: true },
  ).map(({ value }) => value));
  return active.filter((profile) => identifiableIds.has(profile.id));
}

/**
 * Read-only Admin review model. Employee rows and profile options are scoped by their existing RLS
 * reads; this leaf never accepts or sends an org id. Proposed-link semantics for other consumers
 * remain in timesheetPush.listProposedEmployeeLinks.
 */
export async function listEmployeeMatchReview(): Promise<{
  links: ProposedEmployeeLink[];
  profiles: ProfileRow[];
}> {
  const [rows, confirmedRows, orgProfiles] = await Promise.all([
    fetchAllRowsByKeyset<EmployeeMatchReviewRow>(async (afterId, limit) => {
      let query = supabase
        .from('erp_employees')
        .select(EMPLOYEE_REVIEW_COLUMNS)
        .in('link_state', ['proposed', 'unlinked'])
        .order('id', { ascending: true });
      if (afterId !== null) query = query.gt('id', afterId);
      const { data, error } = await query.limit(limit);
      return { data: data as unknown as EmployeeMatchReviewRow[] | null, error };
    }),
    fetchAllRowsByKeyset<{ id: string; profile_id: string | null }>(async (afterId, limit) => {
      let query = supabase
        .from('erp_employees')
        .select('id, profile_id')
        .eq('link_state', 'confirmed')
        .order('id', { ascending: true });
      if (afterId !== null) query = query.gt('id', afterId);
      const { data, error } = await query.limit(limit);
      return { data: data as unknown as { id: string; profile_id: string | null }[] | null, error };
    }),
    listOrgProfiles(),
  ]);
  const confirmedProfileIds = new Set(
    confirmedRows.flatMap((row) => row.profile_id ? [row.profile_id] : []),
  );
  const profiles = selectableProfiles(orgProfiles, confirmedProfileIds);

  return {
    links: rows.map((row) => {
      const profile = row.profile as EmployeeMatchReviewRow['profile'];
      return {
        id: row.id,
        employee_name: row.employee_name,
        employee_number: row.employee_number,
        work_email: row.work_email,
        link_proposed_reason: row.link_proposed_reason,
        profile_id: row.profile_id,
        profile_name: profile?.full_name ?? null,
        profile_email: profile?.email ?? null,
      };
    }),
    profiles,
  };
}
