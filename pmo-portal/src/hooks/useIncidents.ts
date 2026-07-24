import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { IncidentRow, IncidentStatus, IncidentInput } from '@/src/lib/db/incidents';
import { useAuth } from '@/src/auth/useAuth';
import { withTimeout, DEFAULT_MUTATION_TIMEOUT_MS } from '@/src/lib/withTimeout';

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

/**
 * Single incident by id over the repository seam (ADR-0017) — backs the routable
 * `/incidents/:id` detail page (CW-4a). queryKey is org-scoped (['incident', orgId, id])
 * so the cache is tenant-scoped; disabled until both orgId and id resolve (a cold deep-link
 * never fires an `id=undefined` query). Returns `null` when the record isn't readable under
 * RLS / doesn't exist — the page renders a calm not-found state for that.
 */
export function useIncident(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncidentRow | null>({
    queryKey: ['incident', orgId, id],
    queryFn: () => repositories.incident.get(id!),
    enabled: Boolean(orgId && id),
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
 * seam. Each invalidates the `['incidents', …]` list family AND the single-record
 * `['incident', …]` family on success, so every list (and any status-filtered variant)
 * plus an open `/incidents/:id` detail page refetch. Errors propagate as `AppError`
 * (code preserved) for the caller to classify via `classifyMutationError`.
 *
 * Reference adoption (UI-freeze hardening, `docs/plans/2026-07-24-mutation-timeout-adoption.md`):
 * each `mutationFn` is raced against `DEFAULT_MUTATION_TIMEOUT_MS` via `withTimeout` so a stalled
 * request can never leave a confirm dialog's Cancel/Esc disabled forever — it settles as an
 * ordinary `classifyMutationError`-recognized "Request timed out" failure instead.
 */
export function useIncidentMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['incidents'] });
    qc.invalidateQueries({ queryKey: ['incident'] });
  };

  const create = useMutation({
    mutationFn: (input: IncidentInput) =>
      withTimeout(repositories.incident.create(input), DEFAULT_MUTATION_TIMEOUT_MS),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateIncidentArgs) =>
      withTimeout(repositories.incident.update(id, input), DEFAULT_MUTATION_TIMEOUT_MS),
    onSuccess: invalidate,
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: TransitionIncidentArgs) =>
      withTimeout(repositories.incident.transition(id, status), DEFAULT_MUTATION_TIMEOUT_MS),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      withTimeout(repositories.incident.delete(id), DEFAULT_MUTATION_TIMEOUT_MS),
    onSuccess: invalidate,
  });

  return { create, update, transition, remove };
}
