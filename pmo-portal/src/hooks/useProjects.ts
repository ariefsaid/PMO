import { projectKeys, invalidateProjectProjections } from './projectQueryKeys';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ProjectWithRefs,
  type CreateProjectInput,
  type ProjectHeaderInput,
  type SetProjectContractValueInput,
} from '@/src/lib/db/projects';
import type { CompanyRow } from '@/src/lib/db/companies';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { useStartRecordFolder } from '@/src/hooks/useStartRecordFolder';
import { synchronizeErpProject } from '@/src/lib/repositories/projectErpSetup';

/** Org-scoped project list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-002). */
export function useProjectIdentity() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['project-identity', orgId],
    queryFn: () => repositories.project.listIdentity(),
    enabled: Boolean(orgId),
  });
}

/**
 * Project pickers: id, name, short_name, code, status, PM; the same rows as `useProjects()`
 * without the full row and joins. Under `projectKeys.all` so project writes invalidate it.
 */
export function useProjectPickerOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: [...projectKeys.all(orgId), 'picker'],
    queryFn: () => repositories.project.listPickerOptions(),
    enabled: Boolean(orgId),
  });
}

/** One narrow read for project numbers shown on a bounded dashboard card set. */
export function useProjectNumbers(ids: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const stableIds = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['project-numbers', orgId, stableIds],
    queryFn: async () => Object.fromEntries(
      (await repositories.project.listNumbers(stableIds)).map((row) => [row.id, row.pmo_project_number]),
    ) as Record<string, string | null>,
    enabled: Boolean(orgId) && stableIds.length > 0,
  });
}

export function useProjects(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectWithRefs[]>({
    queryKey: projectKeys.all(orgId),
    queryFn: () => repositories.project.list(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/** One project by id (the detail route) — never loads the list. Org-scoped key (FR-QRY-002). */
export function useProject(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectWithRefs | null>({
    queryKey: projectKeys.detail(orgId, id),
    queryFn: () => repositories.project.getWithRefs(id!),
    enabled: Boolean(orgId && id),
  });
}

export { usePrefetchProject } from './usePrefetchProject';

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
    queryKey: projectKeys.milestoneDates(orgId, ids),
    queryFn: () => repositories.milestone.milestoneDatesForProjects(ids),
    enabled: active && Boolean(orgId) && ids.length > 0,
  });
}

export function useClientCompanies() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow[]>({
    queryKey: ['companies', 'client', orgId],
    queryFn: () => repositories.company.listClients(),
    enabled: Boolean(orgId),
  });
}

export function useProjectManagers() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProfileRow[]>({
    queryKey: ['profiles', 'pm', orgId],
    queryFn: () => repositories.profile.listProjectManagers(),
    enabled: Boolean(orgId),
  });
}

export interface UpdateProjectHeaderArgs {
  id: string;
  input: ProjectHeaderInput;
}

/**
 * #513: the mutation arg IS the DAL input — `taxTreatment`/`taxAmount` are required, so a caller
 * that omits the basis fails to compile. Re-exported as an alias rather than re-declared: a second
 * shape here is a second thing that can drift from 0197's P0001 gate.
 */
export type SetContractValueArgs = SetProjectContractValueInput;

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
  const { currentUser } = useAuth();
  // Invalidate the whole project family: the index lists AND the opportunity-by-id detail
  // query (keyed ['opportunity', …]) so a header/value edit re-reads everywhere. F1 (Wave 3):
  // also bust the project FK-picker cache (`['fk-options','project']`) so procurement/other forms
  // don't serve a stale, archived, or missing project name for the ~5-min query staleTime.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project-vat-editability'] });
    invalidateProjectProjections(qc, currentUser?.org_id);
    qc.invalidateQueries({ queryKey: ['fk-options', 'project'] });
    qc.invalidateQueries({ queryKey: ['fk-options', 'invoice-project'] });
    qc.invalidateQueries({ queryKey: ['financial-statements', 'mapped-project-name'] });
    qc.invalidateQueries({ queryKey: ['uxs40', 'references'] });
    // #758: a project write can change the end customer (and client/status), so the sales
    // pipeline and lost-deal queries must refetch or they retain a stale value after the write.
    qc.invalidateQueries({ queryKey: ['integrations', 'bindings', currentUser?.org_id] });
    qc.invalidateQueries({ queryKey: ['integrations', 'project-erp', currentUser?.org_id] });
    qc.invalidateQueries({ queryKey: ['integrations', 'setup', currentUser?.org_id] });
  };

  const startRecordFolder = useStartRecordFolder();
  const create = useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const row = await repositories.project.create(input);
      // #1020: link/create the project's SharePoint folder. Fire-and-forget (void, never awaited,
      // failures caught inside): a folder problem can neither delay nor fail the saved project.
      // No usable identifier (code and project number both empty) = nothing to name the folder by: skip silently.
      if (row.code?.trim() || row.pmo_project_number?.trim()) startRecordFolder({ kind: 'project', id: row.id });
      // PMO owns project creation. ERP setup is a background consequence; its network call must
      // never hold the create mutation (and therefore the create page) open. The project detail
      // exposes its existing match-review surface once the project is eligible for ERP linking.
      void synchronizeErpProject(row.id, currentUser?.org_id).catch(() => undefined);
      return { ...row, erpSetup: 'syncing' as 'syncing' | 'pending' | 'linked' | 'not-connected' };
    },
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
    mutationFn: (args: SetContractValueArgs) => repositories.project.setContractValue(args),
    onSuccess: invalidate,
  });

  return { create, updateHeader, archive, remove, setContractValue };
}
