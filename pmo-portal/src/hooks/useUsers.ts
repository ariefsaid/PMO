import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { UserRow, UserRole, InviteUserInput, SetUserStatusInput, UserManagerChoice } from '@/src/lib/db/adminUsers';
import type { UserDirectoryPage } from '@/src/lib/db/adminUsers';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped Administration › Users list over the repository seam (ADR-0017).
 * queryKey includes org_id so the cache is tenant-scoped (FR-QRY). RLS
 * (profiles_select) scopes the rows; org_id is never sent.
 *
 * This is the WHOLE-list read and stays the source for pickers (project manager, claimant,
 * approver, equipment operator) and for the manager picker. The directory itself reads a server
 * page through `useUsersPage` below.
 */
export function useUsers(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserRow[]>({
    queryKey: ['users', orgId],
    queryFn: () => repositories.profile.listUsers(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/**
 * ONE server page of the users directory. The key carries every criterion (page, page size,
 * search) plus org_id, so a page/filter change is its own cache entry and a tenant switch can
 * never serve another org's page. `keepPreviousData` keeps the previous page on screen while the
 * next one loads (no blank-table flash); the total comes from the server's exact count, never
 * from the page length.
 */
export function useUsersPage(input: { page: number; pageSize: number; search?: string }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserDirectoryPage>({
    queryKey: ['users', orgId, 'page', input.page, input.pageSize, input.search ?? ''],
    queryFn: () => repositories.profile.listUsersPage(input),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });
}

/**
 * The change-manager picker's COMPLETE choice set (id, name, role), read LAZILY: `enabled` is false
 * until the dialog opens, so browsing the directory never pays for the whole org. The key sits in
 * the `['users', …]` family, so a successful invite/role/manager/status write invalidates it with
 * the rest of the user data (a newly invited colleague is immediately assignable).
 */
export function useManagerChoices(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserManagerChoice[]>({
    queryKey: ['users', orgId, 'manager-choices'],
    queryFn: () => repositories.profile.listManagerChoices(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/**
 * Active Admins per org (HEAD counts), the sole-Admin lockout predicate. Keyed by the sorted org
 * set so a page showing another org's rows gets its own entry; a value of `null` means the count
 * could not be resolved (never "zero admins"). Invalidated by the `['users']` mutation family.
 */
export function useActiveAdminCounts(orgIds: readonly string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const key = [...new Set(orgIds.filter(Boolean))].sort();
  return useQuery<Record<string, number | null>>({
    queryKey: ['users', orgId, 'active-admin-counts', key],
    queryFn: () => repositories.profile.countActiveAdminsByOrg(key),
    enabled: Boolean(orgId) && key.length > 0,
  });
}

/**
 * The bounded page location of ONE person in the directory order, for the manager jump. Only
 * runs while a focus target is set; cached per target + page size.
 */
export function useUserFocusPage(userId: string | null, pageSize: number) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['users', orgId, 'focus-location', userId, pageSize],
    queryFn: () => repositories.profile.findUserPage({ userId: userId as string, pageSize }),
    enabled: Boolean(orgId && userId),
  });
}

export interface UpdateRoleArgs {
  id: string;
  role: UserRole;
}

export interface AssignManagerArgs {
  id: string;
  managerId: string | null;
}

/**
 * Admin user-management mutations over the repository seam: change a role, assign a manager,
 * invite a new user (FR-INV-004), and disable/re-enable a user (FR-INV-002/003, AC-INV-003/004).
 * Each invalidates the `['users', …]` query family on success so the directory refetches, and
 * (HKA-019) also invalidates the org-profile and project-manager picker families — the task
 * assignee picker (`['org-profiles', …]`) and the PM picker (`['profiles', 'pm', …]`) cache their
 * own profile lists with a five-minute stale window, so a role/manager/status change that only
 * busted `['users']` left those pickers serving stale people. Errors propagate as `AppError`
 * (code preserved — Postgres codes like `42501`/`P0001`, or the admin-invite-user edge fn's
 * `DUPLICATE_EMAIL`/`INVITE_UNAUTHORIZED`/etc.) for the caller to classify via
 * `classifyMutationError`.
 */
export function useUserMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['org-profiles'] });
    qc.invalidateQueries({ queryKey: ['profiles', 'pm'] });
  };

  const updateRole = useMutation({
    mutationFn: ({ id, role }: UpdateRoleArgs) => repositories.profile.updateUserRole(id, role),
    onSuccess: invalidate,
  });

  const assignManager = useMutation({
    mutationFn: ({ id, managerId }: AssignManagerArgs) =>
      repositories.profile.assignUserManager(id, managerId),
    onSuccess: invalidate,
  });

  const invite = useMutation({
    mutationFn: (input: InviteUserInput) => repositories.profile.inviteUser(input),
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: (input: SetUserStatusInput) => repositories.profile.setUserStatus(input),
    onSuccess: invalidate,
  });

  return { updateRole, assignManager, invite, setStatus };
}
