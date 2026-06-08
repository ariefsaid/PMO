import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { IncidentRow, IncidentStatus, IncidentInput } from '@/src/lib/db/incidents';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped Incidents list over the repository seam (ADR-0017). queryKey includes
 * org_id so the cache is tenant-scoped (FR-QRY); an optional `status` narrows to one
 * workflow state (Open / Investigating / Closed). Rows are returned newest-first by the DAL.
 */
export function useIncidents(status?: IncidentStatus) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncidentRow[]>({
    queryKey: ['incidents', orgId, status ?? 'all'],
    queryFn: () => repositories.incident.list(status ? { status } : undefined),
    enabled: Boolean(orgId),
  });
}

export interface UpdateIncidentArgs {
  id: string;
  input: IncidentInput;
}

export interface TransitionIncidentArgs {
  id: string;
  status: IncidentStatus;
}

/**
 * Incident create / update / status-transition / delete mutations over the repository
 * seam. Each invalidates the `['incidents', …]` query family on success so every list
 * (and any status-filtered variant) refetches. Errors propagate as `AppError`
 * (code preserved) for the caller to classify via `classifyMutationError`.
 */
export function useIncidentMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['incidents'] });

  const create = useMutation({
    mutationFn: (input: IncidentInput) => repositories.incident.create(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateIncidentArgs) => repositories.incident.update(id, input),
    onSuccess: invalidate,
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: TransitionIncidentArgs) =>
      repositories.incident.transition(id, status),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.incident.delete(id),
    onSuccess: invalidate,
  });

  return { create, update, transition, remove };
}
