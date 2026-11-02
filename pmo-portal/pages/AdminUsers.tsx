import React, { useMemo, useState } from 'react';
import {
  ConfirmDialog,
  type SubmitError,
  GateNotice,
  SectionHeader,
  useToast,
  Button,
  Icon,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { useUsers, useUserMutations } from '@/src/hooks/useUsers';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { UserRow, UserRole } from '@/src/lib/db/adminUsers';
import { useAuth } from '@/src/auth/useAuth';
import { useTranslation } from 'react-i18next';
import { UserDirectory } from './admin-users/UserDirectory';
import { InviteFormModal, RoleFormModal, ManagerFormModal } from './admin-users/UserForms';
import { useRoleLabels } from './admin-users/userPresentation';

// CROSS-65: the presentation helpers and the directory moved to admin-users/; the AVATAR_HUES
// export stays reachable from this module for the existing contrast tests.
export { AVATAR_HUES } from './admin-users/userPresentation';

/**
 * Administration › Users (CRUD+RBAC program, plan §9.10; rbac-visibility §J; ops-admin-surface
 * S4, ADR-0049). Admin-in-org or platform-Operator management of the org's profiles: directory +
 * invite + edit role + assign manager + disable/re-enable. To docs/design-mockups/crud-admin-users.html.
 *
 * Authority: `profiles_admin_write` RLS is the write authority for role/manager edits; the
 * `admin-invite-user` edge fn (Admin-in-org OR Operator, service-role issuance) is the invite
 * authority; the `admin_set_user_status` RPC (Admin-in-org OR Operator, caller-agnostic sole-/
 * self-Admin lockout guard) is the disable/re-enable authority. The FE gates affordances via
 * `can('edit'|'create','user')` OR `useIsOperator()` on the REAL JWT role (ADR-0016) — `useIsOperator`
 * is a CLARITY PROJECTION ONLY, every Operator power is re-asserted server-side. Executive may VIEW
 * a read-only directory (§J); every other non-Admin, non-Operator role reaching the route sees an
 * Admin-only gate. Role pills are intentionally neutral-only: the label carries identity; no single
 * role is visually singled out as a category accent.
 *
 * This component owns only the Users destination; the route-backed Administration shell composes
 * the other destinations so unrelated queries and panels stay unmounted.
 */

const AdminUsers: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const may = usePermission();
  const isOperator = useIsOperator();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUsers();
  const { updateRole, assignManager, invite, setStatus } = useUserMutations();
  const { currentUser } = useAuth();

  // Active modal: { mode:'role', user } | { mode:'manager', user } | null.
  const [editTarget, setEditTarget] = useState<{ mode: 'role' | 'manager'; user: UserRow } | null>(null);
  // Pending high-impact role change awaiting the confirm step.
  const [pendingRole, setPendingRole] = useState<{ user: UserRow; role: UserRole } | null>(null);
  // Invite modal open/closed.
  const [inviteOpen, setInviteOpen] = useState(false);
  // #559 / AC-ERR-001: this page's forms fire-and-forget — the PAGE owns the mutation and its
  // rejection — so the error is held here and threaded into the dialog that caused it. One state
  // per dialog: a failed invite must not surface inside the role dialog.
  const [inviteError, setInviteError] = useState<SubmitError | null>(null);
  const [roleError, setRoleError] = useState<SubmitError | null>(null);

  // Pending disable/re-enable awaiting the confirm step (disable only — re-enable is immediate,
  // non-destructive).
  const [pendingStatus, setPendingStatus] = useState<{ user: UserRow; status: 'disabled' } | null>(null);

  const canManage = may('edit', 'user'); // Admin only (policy.ts user.edit)
  const canView = canManage || may('view', 'user') || isOperator; // Exec read-only; Operators may manage users without an Admin role.
  // Invite/disable affordances: Admin-in-org OR Operator (FR-INV-006, AC-OPR-003). An Operator may
  // invite/disable even if their profiles.role isn't 'Admin' — useIsOperator is the OR-clause.
  const canInvite = may('create', 'user') || isOperator;
  const canDisable = canManage || isOperator;

  const all = useMemo(() => (data ?? []) as UserRow[], [data]);

  // The API caps the directory at 1,000 rows; only infer completeness below that cap.
  const isSoleAdmin = (u: UserRow) =>
    !isPending && !isError && !!data && data.length < 1000 &&
    u.role === 'Admin' && u.status === 'active' &&
    all.filter((candidate) => candidate.org_id === u.org_id && candidate.role === 'Admin' && candidate.status === 'active').length === 1;

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  // ── A direct deep-link still needs its own gate. Admin, Executive, and platform Operator
  // proceed; RLS and the server-side Operator RPCs remain the authority for each action.
  const isExecReadOnly = !canManage && canView && !isOperator;
  const isBlocked = !canView;

  if (isBlocked) {
    return (
      <div>
        <PageHead canInvite={false} onInvite={() => setInviteOpen(true)} />
        <GateNotice variant="blocked" className="mt-2">
          {t('admin.users.blocked', 'Administration is an Admin-only area. You don’t have access to user management.')}
        </GateNotice>
      </div>
    );
  }

  // ── Role change: a high-impact change is staged then confirmed. ──
  const submitRole = (user: UserRow, role: UserRole) => {
    if (role === user.role) {
      setEditTarget(null);
      return;
    }
    // Stage the change; the confirm step commits it (high-impact, named in the confirm copy).
    setPendingRole({ user, role });
    setEditTarget(null);
  };

  const confirmRole = async () => {
    if (!pendingRole) return;
    const { user, role } = pendingRole;
    try {
      await updateRole.mutateAsync({ id: user.id, role });
      toast(
        t('admin.users.toast.roleUpdated', 'Role updated'),
        t('admin.users.toast.roleUpdatedDetail', {
          defaultValue: '{{name}} is now {{role}}.',
          name: user.full_name,
          role: roleNames.label(role),
        }),
        'success',
      );
      setPendingRole(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setRoleError({ headline, detail });
      toast(headline, detail, 'warning');
      setPendingRole(null);
    }
  };

  const submitManager = async (user: UserRow, managerId: string | null) => {
    try {
      await assignManager.mutateAsync({ id: user.id, managerId });
      toast(
        t('admin.users.toast.managerUpdated', 'Manager updated'),
        t('admin.users.toast.managerUpdatedDetail', {
          defaultValue: 'Updated the reporting line for {{name}}.',
          name: user.full_name,
        }),
        'success',
      );
      setEditTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // ── Disable/Re-enable (AC-INV-003/004): admin_set_user_status RPC re-asserts authority +
  // the caller-agnostic sole-/self-Admin lockout guard (P0001) server-side. ──
  const confirmSetStatus = async (user: UserRow, status: 'active' | 'disabled') => {
    try {
      await setStatus.mutateAsync({ id: user.id, status, orgId: user.org_id });
      toast(
        status === 'disabled'
          ? t('admin.users.toast.disabled', 'User disabled')
          : t('admin.users.toast.reEnabled', 'User re-enabled'),
        status === 'disabled'
          ? t('admin.users.toast.disabledDetail', {
              defaultValue: '{{name}} can no longer sign in.',
              name: user.full_name,
            })
          : t('admin.users.toast.reEnabledDetail', {
              defaultValue: '{{name}} can sign in again.',
              name: user.full_name,
            }),
        'success',
      );
      setPendingStatus(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setPendingStatus(null);
    }
  };

  const confirmDisable = () => {
    if (!pendingStatus || pendingStatus.user.id === currentUser?.id || isSoleAdmin(pendingStatus.user)) return;
    void confirmSetStatus(pendingStatus.user, pendingStatus.status);
  };

  // ── Invite (FR-INV-004/005): admin-invite-user edge fn — Admin-in-org OR Operator. ──
  const submitInvite = async (email: string, role: UserRole, pOrgId: string | null) => {
    try {
      await invite.mutateAsync({ email, role, pOrgId });
      toast(
        t('admin.users.toast.inviteSent', 'Invite sent'),
        t('admin.users.toast.inviteSentDetail', {
          defaultValue: '{{email}} has been invited as {{role}}.',
          email,
          role: roleNames.label(role),
        }),
        'success',
      );
      setInviteOpen(false);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, {
        DUPLICATE_EMAIL: t('admin.users.inviteError.duplicateEmail', 'That person is already in your workspace.'),
        INVITE_UNAUTHORIZED: t('admin.users.inviteError.unauthorized', "You don't have permission to invite users."),
        INVALID_ROLE: t('admin.users.inviteError.invalidRole', 'Choose a valid role.'),
        UNKNOWN_ORG: t('admin.users.inviteError.unknownOrg', "That organization doesn't exist."),
      });
      setInviteError({ headline, detail });
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      <PageHead canInvite={canInvite} onInvite={() => setInviteOpen(true)} embedded={embedded} />

      {isExecReadOnly && (
        <GateNotice variant="blocked" className="mb-3.5">
          {t('admin.users.execReadOnly', 'You can view the user directory, but only an Admin can add, edit, or disable users.')}
        </GateNotice>
      )}

      {/* Directory body (CROSS-65): toolbar, states, columns, row menu and manager navigation
          live in admin-users/UserDirectory; this page keeps the gates, mutations and confirms. */}
      <UserDirectory
        rows={all}
        state={state}
        onRetry={() => refetch()}
        canManage={canManage}
        canDisable={canDisable}
        currentUserId={currentUser?.id}
        isSoleAdmin={isSoleAdmin}
        onEditRole={(u) => setEditTarget({ mode: 'role', user: u })}
        onChangeManager={(u) => setEditTarget({ mode: 'manager', user: u })}
        onSetStatus={(u, status) => {
          if (status === 'active') void confirmSetStatus(u, 'active');
          else setPendingStatus({ user: u, status });
        }}
      />

      {/* Edit-role modal */}
      {editTarget?.mode === 'role' && (
        <RoleFormModal
          user={editTarget.user}
          submitError={roleError}
          onClose={() => setEditTarget(null)}
          onSubmit={submitRole}
        />
      )}

      {/* Change-manager modal */}
      {editTarget?.mode === 'manager' && (
        <ManagerFormModal
          user={editTarget.user}
          candidates={all}
          loading={assignManager.isPending}
          onClose={() => setEditTarget(null)}
          onSubmit={submitManager}
        />
      )}

      {/* High-impact role-change confirm (default tone, names the impact) */}
      <ConfirmDialog
        open={!!pendingRole}
        tone="default"
        title={
          pendingRole
            ? t('admin.users.roleConfirm.title', {
                defaultValue: "Change {{name}}'s role to {{role}}?",
                name: pendingRole.user.full_name,
                role: roleNames.label(pendingRole.role),
              })
            : t('admin.users.roleConfirm.fallbackTitle', 'Change role?')
        }
        description={t(
          'admin.users.roleConfirm.description',
          'This changes what they can see and do across the whole workspace, effective immediately. The change is recorded against your account.',
        )}
        confirmLabel={t('admin.users.roleConfirm.confirm', 'Change role')}
        loading={updateRole.isPending}
        onConfirm={confirmRole}
        onCancel={() => setPendingRole(null)}
      />

      {/* Disable confirm (destructive tone — AC-INV-004) */}
      <ConfirmDialog
        open={!!pendingStatus}
        tone="destructive"
        title={
          pendingStatus
            ? t('admin.users.disableConfirm.title', {
                defaultValue: 'Disable {{name}}?',
                name: pendingStatus.user.full_name,
              })
            : t('admin.users.disableConfirm.fallbackTitle', 'Disable user?')
        }
        description={t(
          'admin.users.disableConfirm.description',
          'They will no longer be able to sign in. You can re-enable them at any time.',
        )}
        confirmLabel={t('admin.users.disableConfirm.confirm', 'Disable')}
        loading={setStatus.isPending}
        onConfirm={confirmDisable}
        onCancel={() => setPendingStatus(null)}
      />

      {/* Invite modal (FR-INV-004/005/006) */}
      {inviteOpen && (
        <InviteFormModal
          isOperator={isOperator}
          loading={invite.isPending}
          submitError={inviteError}
          onClose={() => setInviteOpen(false)}
          onSubmit={submitInvite}
        />
      )}
    </div>
  );
};

// ── Page header ──────────────────────────────────────────────────────────────

const PageHead: React.FC<{ canInvite: boolean; onInvite: () => void; embedded?: boolean }> = ({
  canInvite,
  onInvite,
  embedded = false,
}) => {
  const { t } = useTranslation();
  const inviteAction = canInvite ? (
    /* FR-INV-004/006: a real, working invite affordance (admin-invite-user edge fn) —
       replaces the interim "Copy invite instructions" clipboard workaround. Create-verb
       consistency (DESIGN.md §7): button / modal title / submit all say "Invite user". */
    <Button variant="primary" onClick={onInvite}>
      <Icon name="plus" />
      {t('admin.users.invite', 'Invite user')}
    </Button>
  ) : undefined;

  if (embedded) {
    return <SectionHeader title={t('admin.nav.users', 'Users')} action={inviteAction} />;
  }

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {/* B-8 (AC-W2-IA-003): the standalone compatibility composition keeps the
            Administration heading aligned with its route and breadcrumb. The route-backed shell
            uses the embedded Users section header above instead. */}
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('admin.nav.title', 'Administration')}</h1>
        <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
          {t(
            'admin.users.page.description',
            'Manage users’ role, status, and reporting line. Administration is Admin-only; role changes are high-impact and recorded.',
          )}
        </p>
      </div>
      {inviteAction}
    </div>
  );
};

export default AdminUsers;
