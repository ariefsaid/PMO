import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { IncidentRow, IncidentDetailRow, IncidentStatus, IncidentInput, IncidentFileRow, IncidentFileKind } from '@/src/lib/db/incidents';
import type { ComboboxOption } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { withTimeout } from '@/src/lib/withTimeout';

/**
 * Org-scoped Incidents list over the repository seam (ADR-0017). queryKey includes
 * org_id so the cache is tenant-scoped (FR-QRY); an optional `status` narrows to one
 * workflow state (Open / Investigating / Closed). Rows are returned newest-first by the DAL.
 */
export function useIncidents(status?: IncidentStatus, opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncidentRow[]>({
    queryKey: ['incidents', orgId, status ?? 'all'],
    queryFn: () => repositories.incident.list(status ? { status } : undefined),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/**
 * One server page of the Incidents register (#1991) plus the unfiltered total for "Showing x of y".
 * Both keys sit under `['incidents', orgId, …]` so every incident mutation's invalidation refetches
 * them. The previous page stays on screen while the next loads. The unfiltered count is only fetched
 * while a filter is active; unfiltered, the page total IS the denominator.
 */
export function useIncidentsPage(args: { page: number; pageSize: number; status?: IncidentStatus; search?: string; overdue?: boolean; projectId?: string }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const filtered = Boolean(args.status || args.search || args.overdue || args.projectId);
  const list = useQuery({
    queryKey: ['incidents', orgId, 'page', args.status ?? 'all', args.search ?? '', args.overdue ? 'overdue' : 'any', args.projectId ?? '', args.page, args.pageSize],
    queryFn: () => repositories.incident.listPage(args),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });
  const all = useQuery({
    queryKey: ['incidents', orgId, 'count'],
    queryFn: () => repositories.incident.count(),
    enabled: Boolean(orgId) && filtered,
  });
  return { list, allTotal: filtered ? all.data : list.data?.total };
}

/** Every incident matching the current status/search, read only when the user exports (the page holds one server page). */
export function useIncidentsExportAll() {
  return useMutation({
    mutationFn: (params?: { status?: IncidentStatus; search?: string; overdue?: boolean; projectId?: string }) => repositories.incident.list(params),
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
  return useQuery<IncidentDetailRow | null>({
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
  /** Written with the closing update (optional). */
  closeNote?: string;
}

/**
 * Incident create / update / status-transition / delete mutations over the repository
 * seam. Each invalidates the `['incidents', …]` list family AND the single-record
 * `['incident', …]` family on success, so every list (and any status-filtered variant)
 * plus an open `/incidents/:id` detail page refetch. Errors propagate as `AppError`
 * (code preserved) for the caller to classify via `classifyMutationError`.
 *
 * Reference adoption (UI-freeze hardening, `mutation-timeout-adoption plan (2026-07-24, in git history)`):
 * each `mutationFn` is raced against the shared `withTimeout` deadline so a stalled
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
      withTimeout(repositories.incident.create(input)),
    // ⚑ onSettled, NOT onSuccess: on a TIMEOUT the outcome is UNKNOWN, not unchanged — the
    // server may have committed while the response was lost. Refetching the truth either way
    // keeps the surface self-correcting; it still never reports the write as succeeded.
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateIncidentArgs) =>
      withTimeout(repositories.incident.update(id, input)),
    onSettled: invalidate,
  });

  const transition = useMutation({
    mutationFn: ({ id, status, closeNote }: TransitionIncidentArgs) =>
      withTimeout(
        closeNote === undefined
          ? repositories.incident.transition(id, status)
          : repositories.incident.transition(id, status, closeNote),
      ),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      withTimeout(repositories.incident.delete(id)),
    onSettled: invalidate,
  });

  return { create, update, transition, remove };
}

/** The live attachments of one issue (#2521). Keyed under `['incident', …]` so every incident mutation refetches it. */
export function useIncidentFiles(incidentId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncidentFileRow[]>({
    queryKey: ['incident', orgId, incidentId, 'files'],
    queryFn: () => repositories.incident.listFiles(incidentId!),
    enabled: Boolean(orgId && incidentId),
  });
}

/** Upload one photo/PDF for an issue, and make a task from an issue (#2521). */
export function useIncidentEvidenceMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['incident'] });
    qc.invalidateQueries({ queryKey: ['incidents'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const upload = useMutation({
    mutationFn: (args: { incident: Pick<IncidentRow, 'id' | 'org_id'>; kind: IncidentFileKind; file: File }) =>
      repositories.incident.uploadFile(args),
    onSettled: invalidate,
  });
  const makeTask = useMutation({
    mutationFn: (incidentId: string) => withTimeout(repositories.incident.createTask(incidentId)),
    onSettled: invalidate,
  });
  const addTask = useMutation({
    mutationFn: (args: { incidentId: string; name: string; assigneeId?: string | null; dueDate?: string | null }) =>
      withTimeout(repositories.incident.addTask(args.incidentId, { name: args.name, assigneeId: args.assigneeId, dueDate: args.dueDate })),
    onSettled: invalidate,
  });
  const saveRootCause = useMutation({
    mutationFn: (args: { id: string; rootCause: string }) => withTimeout(repositories.incident.setRootCause(args.id, args.rootCause)),
    onSettled: invalidate,
  });
  return { upload, makeTask, addTask, saveRootCause };
}

/** Active members of the org as assignee options (RLS scopes the list; org_id only keys the cache). */
export function useAssigneeOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ComboboxOption[]>({
    queryKey: ['fk-options', 'incident-assignee', orgId],
    queryFn: async () => (await repositories.profile.listOrgProfiles())
      .filter((p) => p.status === 'active')
      .map((p) => ({ value: p.id, label: p.full_name ?? p.email ?? p.id, sub: p.role })),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}
