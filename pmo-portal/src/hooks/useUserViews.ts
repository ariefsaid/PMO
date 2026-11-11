import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { UserViewRow, UserViewListRow, UserViewInput } from '@/src/lib/db/userViews';
import { useAuth } from '@/src/auth/useAuth';
import { withTimeout } from '@/src/lib/withTimeout';

/**
 * Org-scoped saved-views list over the repository seam (ADR-0017, ADR-0036 §6). queryKey
 * includes org_id so the cache is tenant-scoped (FR-UV-013, no cross-tenant cache bleed);
 * disabled until an org resolves (and while `enabled` is false: the shell passes the user_views entitlement so an org without the module never pays the read). The list omits each view's `spec`. The DAL hides archived rows and applies owner-private RLS.
 */
export function useUserViews(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserViewListRow[]>({
    queryKey: ['user_views', orgId],
    queryFn: () => repositories.userView.list(),
    enabled: Boolean(orgId) && enabled,
  });
}

/**
 * A single saved view by id over the repository seam (ADR-0017). queryKey includes org_id so
 * the cache is tenant-scoped (FR-UV-014); disabled until both an org and an id are present.
 * Returns `null` when the record is absent or RLS-scoped out.
 */
export function useUserView(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserViewRow | null>({
    queryKey: ['user_view', orgId, id],
    queryFn: () => repositories.userView.get(id!),
    enabled: Boolean(orgId && id),
  });
}

export interface UpdateUserViewArgs {
  id: string;
  input: UserViewInput;
}

/**
 * Saved-view create / update / archive / delete mutations over the repository seam.
 * Each invalidates the `['user_views']` and `['user_view']` query families on success
 * (FR-UV-015) so open lists and record reads refetch. Errors propagate as `AppError`
 * (code preserved) for the caller to classify via `classifyMutationError`.
 *
 * Reference adoption (UI-freeze hardening, `docs/plans/2026-07-24-mutation-timeout-adoption.md`):
 * each `mutationFn` is raced against the shared `withTimeout` deadline so a stalled
 * request can never leave a confirm dialog's Cancel/Esc disabled forever — it settles as an
 * ordinary `classifyMutationError`-recognized "Request timed out" failure instead.
 */
export function useUserViewMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['user_views'] });
    qc.invalidateQueries({ queryKey: ['user_view'] });
  };

  const create = useMutation({
    mutationFn: (input: UserViewInput) =>
      withTimeout(repositories.userView.create(input)),
    // ⚑ onSettled, NOT onSuccess: on a TIMEOUT the outcome is UNKNOWN, not unchanged — the
    // server may have committed while the response was lost. Refetching the truth either way
    // keeps the surface self-correcting; it still never reports the write as succeeded.
    onSettled: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateUserViewArgs) =>
      withTimeout(repositories.userView.update(id, input)),
    onSettled: invalidate,
  });

  const archive = useMutation({
    mutationFn: (id: string) =>
      withTimeout(repositories.userView.archive(id)),
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      withTimeout(repositories.userView.delete(id)),
    onSettled: invalidate,
  });

  return { create, update, archive, remove };
}
