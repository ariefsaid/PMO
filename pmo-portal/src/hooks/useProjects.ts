import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects, type ProjectWithRefs, type CreateProjectInput, type ProjectHeaderInput } from '@/src/lib/db/projects';
import { listClientCompanies, type CompanyRow } from '@/src/lib/db/companies';
import { listProjectManagers, type ProfileRow } from '@/src/lib/db/profiles';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped project list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-002). */
export function useProjects() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectWithRefs[]>({
    queryKey: ['projects', orgId],
    queryFn: () => listProjects(),
    enabled: Boolean(orgId),
  });
}

/**
 * Dated milestones for a set of visible projects — the read-only Project Calendar view.
 * One batched read (NFR-CAL-PERF-001); short-circuits (no query) on an empty id set so an
 * empty/filtered-out list never issues an RPC. queryKey is org-scoped + keyed on the sorted
 * id set so the cache is tenant-scoped and stable across re-renders.
 *
 * @param ids     Project IDs to fetch milestone dates for.
 * @param active  Pass `false` (e.g. when the calendar view is not shown) to skip the RPC entirely
 *                and avoid a wasted round-trip on every Projects page load. Defaults to `true` for
 *                backwards compatibility, but callers SHOULD pass `view === 'calendar'`.
 */
export function useProjectsMilestoneDates(ids: string[], active = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['milestone-dates', orgId, [...ids].sort()],
    queryFn: () => repositories.milestone.milestoneDatesForProjects(ids),
    enabled: active && Boolean(orgId) && ids.length > 0,
  });
}

export function useClientCompanies() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow[]>({
    queryKey: ['companies', 'client', orgId],
    queryFn: () => listClientCompanies(),
    enabled: Boolean(orgId),
  });
}

export function useProjectManagers() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProfileRow[]>({
    queryKey: ['profiles', 'pm', orgId],
    queryFn: () => listProjectManagers(),
    enabled: Boolean(orgId),
  });
}

export interface UpdateProjectHeaderArgs {
  id: string;
  input: ProjectHeaderInput;
}

export interface SetContractValueArgs {
  id: string;
  value: number;
}

/**
 * Project CRUD mutations over the repository seam (ADR-0017): create a new opportunity,
 * edit the header, soft-archive, hard-delete (Admin-only FE gate), and set the SoD-gated
 * contract_value (via the scoped RPC,
 * ADR-0019). Each invalidates the `['projects', …]` query family on success so every cached
 * list + the project-detail view refetch. Errors propagate as `AppError` (code preserved) for
 * the caller to classify via `classifyMutationError`. RLS/RPC remain the enforcement authority.
 */
export function useProjectMutations() {
  const qc = useQueryClient();
  // Invalidate the whole project family: the index lists AND the opportunity-by-id detail
  // query (keyed ['opportunity', …]) so a header/value edit re-reads everywhere. F1 (Wave 3):
  // also bust the project FK-picker cache (`['fk-options','project']`) so procurement/other forms
  // don't serve a stale, archived, or missing project name for the ~5-min query staleTime.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['opportunity'] });
    qc.invalidateQueries({ queryKey: ['fk-options', 'project'] });
  };

  const create = useMutation({
    mutationFn: (input: CreateProjectInput) => repositories.project.create(input),
    onSuccess: invalidate,
  });

  const updateHeader = useMutation({
    mutationFn: ({ id, input }: UpdateProjectHeaderArgs) =>
      repositories.project.updateHeader(id, input),
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.project.archive(id),
    onSuccess: invalidate,
  });

  // Hard delete (Admin-only in the FE gate). Irreversible; rejects 23503 when the
  // project is referenced (procurement / timesheet). Archive is the safe default.
  const remove = useMutation({
    mutationFn: (id: string) => repositories.project.delete(id),
    onSuccess: invalidate,
  });

  const setContractValue = useMutation({
    mutationFn: ({ id, value }: SetContractValueArgs) =>
      repositories.project.setContractValue(id, value),
    onSuccess: invalidate,
  });

  return { create, updateHeader, archive, remove, setContractValue };
}
