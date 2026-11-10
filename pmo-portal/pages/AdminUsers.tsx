import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConfirmDialog,
  type SubmitError,
  GateNotice,
  PageHeader,
  useToast,
  Button,
  Icon,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { useUsersPage, useActiveAdminCounts, useUserFocusPage, useManagerChoices, useUserMutations } from '@/src/hooks/useUsers';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { USER_DIRECTORY_PAGE_SIZE } from '@/src/lib/db/adminUsers';
import type { UserDirectoryRow, UserRole } from '@/src/lib/db/adminUsers';
import { useAuth } from '@/src/auth/useAuth';
import { useTranslation } from 'react-i18next';
import { UserDirectory } from './admin-users/UserDirectory';
import { InviteFormModal, RoleFormModal, ManagerFormModal } from './admin-users/UserForms';
import { useRoleLabels } from './admin-users/roleLabels';

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
  // The directory reads ONE server page (exact total, server search). The whole list is only
  // read lazily when the manager picker opens — a picker must offer everyone, not one page.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const directory = useUsersPage({ page, pageSize: USER_DIRECTORY_PAGE_SIZE, search });
  const { updateRole, assignManager, invite, setStatus } = useUserMutations();
  const { currentUser } = useAuth();
  // AC-JR-W3B-E1 manager jump: { userId, name, fromPage, fromSearch } while we are showing someone
  // else's page for a manager click; `null` when the directory is where the user left it. The
  // name is only a label for the in-flight/failed lookup — the TARGET is always the actual id.
  // `seq` identifies THIS explicit click: a repeated click on the same person is a new jump.
  const [focus, setFocus] = useState<{ userId: string; name: string; fromPage: number; fromSearch: string; seq: number } | null>(null);
  const focusLocation = useUserFocusPage(focus?.userId ?? null, USER_DIRECTORY_PAGE_SIZE);
  // Each jump's location is applied exactly once. Browsing or searching afterwards is the user's
  // own move and must not be undone by a jump that already happened.
  const jumpSeqRef = useRef(0);
  const appliedJumpRef = useRef<number | null>(null);

  // Active modal: { mode:'role', user } | { mode:'manager', user } | null.
  const [editTarget, setEditTarget] = useState<{ mode: 'role' | 'manager'; user: UserDirectoryRow } | null>(null);
  // Pending high-impact role change awaiting the confirm step.
  const [pendingRole, setPendingRole] = useState<{ user: UserDirectoryRow; role: UserRole } | null>(null);
  // Invite modal open/closed.
  const [inviteOpen, setInviteOpen] = useState(false);
  // #559 / AC-ERR-001: this page's forms fire-and-forget — the PAGE owns the mutation and its
  // rejection — so the error is held here and threaded into the dialog that caused it. One state
  // per dialog: a failed invite must not surface inside the role dialog.
  const [inviteError, setInviteError] = useState<SubmitError | null>(null);
  const [roleError, setRoleError] = useState<SubmitError | null>(null);

  // Pending disable/re-enable awaiting the confirm step (disable only — re-enable is immediate,
  // non-destructive).
  const [pendingStatus, setPendingStatus] = useState<{ user: UserDirectoryRow; status: 'disabled' } | null>(null);

  const canManage = may('edit', 'user'); // Admin only (policy.ts user.edit)
  const canView = canManage || may('view', 'user') || isOperator; // Exec read-only; Operators may manage users without an Admin role.
  // Invite/disable affordances: Admin-in-org OR Operator (FR-INV-006, AC-OPR-003). An Operator may
  // invite/disable even if their profiles.role isn't 'Admin' — useIsOperator is the OR-clause.
  const canInvite = may('create', 'user') || isOperator;
  const canDisable = canManage || isOperator;

  const rows = useMemo(() => directory.data?.rows ?? [], [directory.data]);
  const total = directory.data?.total ?? 0;

  // Everyone, for the manager picker only: a COMPLETE but minimal choice set (id, name, role),
  // read lazily while that dialog is open. A picker must not be limited to the visible page, and
  // the directory visit must not pay for the whole people list.
  const managerChoices = useManagerChoices({ enabled: editTarget?.mode === 'manager' });

  // Sole active Admin is counted server-side over each row's WHOLE org — independent of the
  // current page and search. `unknown` (query pending, a failed read/refetch, or an unresolved
  // count) is deliberately a third state: it must never be read as "not the sole admin", and a
  // cached count must not outrank a failed refresh. A zero count on a row that IS an active Admin
  // is an inconsistency, so it is unknown too — never "there are several admins".
  const orgIds = useMemo(() => [...new Set(rows.map((row) => row.org_id))], [rows]);
  const adminCounts = useActiveAdminCounts(orgIds);
  const adminCountsUnresolved = adminCounts.isPending || adminCounts.isError;
  const adminStateFor = (u: UserDirectoryRow): 'sole' | 'multiple' | 'unknown' | 'not-admin' => {
    if (u.role !== 'Admin' || u.status !== 'active') return 'not-admin';
    if (adminCountsUnresolved) return 'unknown';
    const count = adminCounts.data?.[u.org_id];
    if (count === undefined || count === null || count < 1) return 'unknown';
    return count === 1 ? 'sole' : 'multiple';
  };
  const isSoleAdmin = (u: UserDirectoryRow) => adminStateFor(u) === 'sole';
  const isAdminStateUnknown = (u: UserDirectoryRow) => adminStateFor(u) === 'unknown';

  // Where the focus target sits: pending / located / failed / not-readable. All four are rendered,
  // so a click is never a dead end — only `located` moves the page.
  const focusState: 'locating' | 'located' | 'error' | 'unavailable' | null = !focus
    ? null
    : focusLocation.isError
      ? 'error'
      : focusLocation.data === null
        ? 'unavailable'
        : focusLocation.data
          ? 'located'
          : 'locating';

  // Manager jump: once THIS jump's location resolves, drop the search (the manager may not match
  // the typed term) and move there. It is applied ONCE per explicit jump — re-applying it whenever
  // `page`/`search` changed used to pull the reader back to the manager's page and wipe whatever
  // they typed. The return control still restores the page AND search the user left. A failed or
  // unreadable lookup does NOT move anything and keeps its own recoverable notice.
  useEffect(() => {
    if (!focus || focusState !== 'located' || !focusLocation.data) return;
    if (appliedJumpRef.current === focus.seq) return;
    appliedJumpRef.current = focus.seq;
    if (search !== '') setSearch('');
    if (page !== focusLocation.data.page) setPage(focusLocation.data.page);
  }, [focus, focusState, focusLocation.data, page, search]);
  const onJumpToUser = (userId: string, name: string) => {
    jumpSeqRef.current += 1;
    setFocus({ userId, name, fromPage: page, fromSearch: search, seq: jumpSeqRef.current });
  };
  const onReturnFromFocus = () => {
    if (!focus) return;
    setPage(focus.fromPage);
    setSearch(focus.fromSearch);
    setFocus(null);
  };

  // Out-of-range correction: a deep link or a shrinking result set can point past the last page.
  useEffect(() => {
    if (directory.isFetching || !directory.data) return;
    if (directory.data.rows.length > 0 || directory.data.total === 0 || page <= 1) return;
    setPage(Math.max(1, Math.ceil(directory.data.total / USER_DIRECTORY_PAGE_SIZE)));
  }, [directory.data, directory.isFetching, page]);

  // A search change always returns to page 1 (page 7 of the old result set is meaningless).
  const onSearchChange = (next: string) => {
    setSearch(next);
    setPage(1);
  };

  const state: 'loading' | 'empty' | 'error' | undefined = directory.isPending
    ? 'loading'
    : directory.isError || !directory.data
      ? 'error'
      : total === 0 && search.trim() === ''
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
  const submitRole = (user: UserDirectoryRow, role: UserRole) => {
    if (role === user.role) {
      setEditTarget(null);
      return;
    }
    // Each staged attempt starts with a clean slate — an earlier failure must not resurface in
    // the confirm step or in a dialog opened for a different user (scoped per attempt).
    setRoleError(null);
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
      // The confirmation stays open on failure: the staged change is kept so the admin can retry
      // immediately or cancel deliberately, instead of losing the selected edit to a closed dialog.
      const { headline, detail } = classifyMutationError(err);
      setRoleError({ headline, detail });
      toast(headline, detail, 'warning');
    }
  };

  const submitManager = async (user: UserDirectoryRow, managerId: string | null) => {
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
  const confirmSetStatus = async (user: UserDirectoryRow, status: 'active' | 'disabled') => {
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
      const seatLimitOverrides = status === 'active' ? {
        PL001: t('administration:admin.users.statusError.seatLimit', 'Your plan has no seats left'),
      } : undefined;
      const seatLimitContext = status === 'active' ? {
        module: 'administration' as const,
        operation: 'update' as const,
        detailOverrides: {
          PL001: t(
            'administration:admin.users.statusError.seatLimitDetail',
            'Everyone on your plan already has a seat. Ask your Operator to upgrade the plan, then re-enable this user.',
          ),
        },
      } : undefined;
      const { headline, detail } = classifyMutationError(err, seatLimitOverrides, seatLimitContext);
      toast(headline, detail, 'warning');
      setPendingStatus(null);
    }
  };

  const confirmDisable = () => {
    if (!pendingStatus || pendingStatus.user.id === currentUser?.id || isSoleAdmin(pendingStatus.user) || isAdminStateUnknown(pendingStatus.user)) return;
    void confirmSetStatus(pendingStatus.user, pendingStatus.status);
  };

  // ── Invite (FR-INV-004/005): admin-invite-user edge fn — Admin-in-org OR Operator. ──
  const submitInvite = async (email: string, role: UserRole, pOrgId: string | null) => {
    // A fresh attempt starts clean — an earlier failure never resurfaces in a new dialog.
    setInviteError(null);
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
        // FR-PLN-010 / AC-PLN-009: the plan's seats are all in use (migration 0535's typed PL001).
        SEAT_LIMIT_REACHED: t('administration:admin.users.inviteError.seatLimit', 'Your plan has no seats left'),
      }, {
        module: 'administration',
        operation: 'create',
        detailOverrides: {
          SEAT_LIMIT_REACHED: t(
            'administration:admin.users.inviteError.seatLimitDetail',
            'Everyone on your plan already has a seat. Ask your Operator to upgrade the plan, then invite again.',
          ),
        },
      });
      setInviteError({ headline, detail });
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      <PageHead canInvite={canInvite} onInvite={() => { setInviteError(null); setInviteOpen(true); }} embedded={embedded} />

      {isExecReadOnly && (
        <GateNotice variant="blocked" className="mb-3.5">
          {t('admin.users.execReadOnly', 'You can view the user directory, but only an Admin can add, edit, or disable users.')}
        </GateNotice>
      )}

      {/* Directory body (CROSS-65): toolbar, states, columns, row menu and manager navigation
          live in admin-users/UserDirectory; this page keeps the gates, mutations and confirms. */}
      <UserDirectory
        rows={rows}
        total={total}
        page={page}
        pageSize={USER_DIRECTORY_PAGE_SIZE}
        search={search}
        onSearchChange={onSearchChange}
        onPageChange={setPage}
        state={state}
        onRetry={() => void directory.refetch()}
        busy={directory.isFetching}
        canManage={canManage}
        canDisable={canDisable}
        currentUserId={currentUser?.id}
        isSoleAdmin={isSoleAdmin}
        isAdminStateUnknown={isAdminStateUnknown}
        focus={
          focus && focusState
            ? {
                userId: focus.userId,
                name: focusLocation.data?.full_name ?? focus.name,
                state: focusState,
                onReturn: onReturnFromFocus,
                onRetry: () => void focusLocation.refetch(),
              }
            : null
        }
        onJumpToUser={onJumpToUser}
        onEditRole={(u) => { setRoleError(null); setEditTarget({ mode: 'role', user: u }); }}
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

      {/* Change-manager modal — the people list is complete but minimal and read only while this
          dialog is open; its loading/failure state is the form's, never an empty picker. */}
      {editTarget?.mode === 'manager' && (
        <ManagerFormModal
          user={editTarget.user}
          choices={managerChoices.data ?? []}
          choicesState={managerChoices.isPending ? 'loading' : managerChoices.isError ? 'error' : 'ready'}
          onRetryChoices={() => void managerChoices.refetch()}
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
    // The Administration tab already names this section; keep the name for assistive tech only.
    return (
      <div className="mb-[var(--space-group)] flex flex-wrap items-center justify-end gap-[var(--space-group)]">
        <h2 className="sr-only">{t('admin.nav.users', 'Users')}</h2>
        {inviteAction}
      </div>
    );
  }

  return <PageHeader title={t('admin.nav.title', 'Administration')} action={inviteAction} />;
};

export default AdminUsers;
