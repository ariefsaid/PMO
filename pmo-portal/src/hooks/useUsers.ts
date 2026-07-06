import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { UserRow, UserRole, InviteUserInput, SetUserStatusInput } from '@/src/lib/db/adminUsers';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped Administration › Users list over the repository seam (ADR-0017).
 * queryKey includes org_id so the cache is tenant-scoped (FR-QRY). RLS
 * (profiles_select) scopes the rows; org_id is never sent.
 */
export function useUsers() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<UserRow[]>({
    queryKey: ['users', orgId],
    queryFn: () => repositories.profile.listUsers(),
    enabled: Boolean(orgId),
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
 * Each invalidates the `['users', …]` query family on success so the directory refetches. Errors
 * propagate as `AppError` (code preserved — Postgres codes like `42501`/`P0001`, or the
 * admin-invite-user edge fn's `DUPLICATE_EMAIL`/`INVITE_UNAUTHORIZED`/etc.) for the caller to
 * classify via `classifyMutationError`.
 */
export function useUserMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

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
