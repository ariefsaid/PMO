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
 * edit the header, soft-archive, and set the SoD-gated contract_value (via the scoped RPC,
 * ADR-0019). Each invalidates the `['projects', …]` query family on success so every cached
 * list + the project-detail view refetch. Errors propagate as `AppError` (code preserved) for
 * the caller to classify via `classifyMutationError`. RLS/RPC remain the enforcement authority.
 */
export function useProjectMutations() {
  const qc = useQueryClient();
  // Invalidate the whole project family: the index lists AND the opportunity-by-id detail
  // query (keyed ['opportunity', …]) so a header/value edit re-reads everywhere.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['opportunity'] });
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

  const setContractValue = useMutation({
    mutationFn: ({ id, value }: SetContractValueArgs) =>
      repositories.project.setContractValue(id, value),
    onSuccess: invalidate,
  });

  return { create, updateHeader, archive, setContractValue };
}
