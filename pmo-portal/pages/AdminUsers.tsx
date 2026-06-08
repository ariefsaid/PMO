import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  SelectField,
  Combobox,
  FormSection,
  GateNotice,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type StatusVariant,
  type ComboboxOption,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useUsers, useUserMutations } from '@/src/hooks/useUsers';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { UserRow, UserRole } from '@/src/lib/db/adminUsers';

/**
 * Administration › Users (CRUD+RBAC program, plan §9.10; rbac-visibility §J).
 * Admin-only management of the org's profiles: directory + edit role + assign manager.
 * To docs/design-mockups/crud-admin-users.html.
 *
 * Authority: `profiles_admin_write` RLS (migration 0002) is the enforcement boundary — the FE
 * gates affordances via can('edit','user') on the REAL JWT role (ADR-0016). Executive may VIEW a
 * read-only directory (§J); every other role reaching the route sees an Admin-only gate.
 *
 * Scope: creating an auth user requires the Supabase admin API (service-role key) which is not
 * available client-side, so the invite/create flow is flagged as a follow-up (an honest modal, not
 * a broken create path) — editing existing profiles' role + manager is fully wired.
 */

/** The five user_role enum values, ordered for the role <select>. */
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'Engineer', label: 'Engineer' },
  { value: 'Project Manager', label: 'Project Manager' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Executive', label: 'Executive' },
  { value: 'Admin', label: 'Admin' },
];

/**
 * Tinted role pill per user_role (crud-admin-users.html role-pill spec):
 * blue is reserved for interactive affordances (One-Blue) and red for destructive, so the
 * three lower-privilege/admin roles read as quiet NEUTRAL tints differentiated by their LABEL
 * (never color-only), while Executive = categorical violet and Finance = success green.
 */
const ROLE_PILL: Record<UserRole, StatusVariant> = {
  Admin: 'neutral',
  Executive: 'violet',
  'Project Manager': 'draft',
  Finance: 'won',
  Engineer: 'progress',
};

/** Deterministic two-letter initials for the avatar tile. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable avatar background from the existing categorical palette (token-driven hues only). */
const AVATAR_HUES = [
  'hsl(var(--primary))',
  'hsl(var(--violet))',
  'hsl(var(--success))',
  'hsl(var(--warning))',
  'hsl(var(--muted-foreground))',
];
function avatarHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

const Avatar: React.FC<{ user: UserRow; size?: number }> = ({ user, size = 30 }) => (
  <span
    aria-hidden
    className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
    style={{ width: size, height: size, background: avatarHue(user.id) }}
  >
    {initialsOf(user.full_name)}
  </span>
);

const AdminUsers: React.FC = () => {
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUsers();
  const { updateRole, assignManager } = useUserMutations();

  const [search, setSearch] = useState('');
  // Active modal: 'add' | { mode:'role', user } | { mode:'manager', user } | null.
  const [editTarget, setEditTarget] = useState<{ mode: 'role' | 'manager'; user: UserRow } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Pending high-impact role change awaiting the confirm step.
  const [pendingRole, setPendingRole] = useState<{ user: UserRow; role: UserRole } | null>(null);

  const canManage = may('edit', 'user'); // Admin only (policy.ts user.edit)
  const canView = canManage || may('view', 'user'); // Exec read-only (policy.ts user.view = Admin·Exec)

  const all = useMemo(() => (data ?? []) as UserRow[], [data]);

  // Resolve manager_id -> full name for the directory.
  const byId = useMemo(() => {
    const m = new Map<string, UserRow>();
    all.forEach((u) => m.set(u.id, u));
    return m;
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [all, search]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  // ── Non-Admin, non-Exec reaching the route: a clean Admin-only gate, not the directory. ──
  // Executive (view-only) and Admin (full) proceed; everyone else is blocked here (Rail already
  // hides the nav; this guards a direct deep-link). RLS is the real authority regardless.
  const isExecReadOnly = !canManage && canView;
  const isBlocked = !canManage && !canView;

  if (isBlocked) {
    return (
      <div>
        <PageHead canManage={false} />
        <GateNotice variant="blocked" className="mt-2">
          Administration is an Admin-only area. You don&rsquo;t have access to user management.
        </GateNotice>
      </div>
    );
  }

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar user={u} />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold" title={u.full_name}>
              {u.full_name}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground" title={u.email}>
              {u.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (u) => <StatusPill variant={ROLE_PILL[u.role]}>{u.role}</StatusPill>,
    },
    {
      key: 'manager',
      header: 'Manager',
      colClassName: 'hidden md:table-cell',
      cell: (u) =>
        u.manager_id && byId.get(u.manager_id) ? (
          <span className="truncate">{byId.get(u.manager_id)!.full_name}</span>
        ) : (
          <span className="text-muted-foreground">No manager</span>
        ),
    },
  ];

  const rowMenu = (u: UserRow): RowMenuItem[] => [
    { label: 'Edit role', onClick: () => setEditTarget({ mode: 'role', user: u }) },
    { label: 'Change manager', onClick: () => setEditTarget({ mode: 'manager', user: u }) },
  ];

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
      toast('Role updated', `${user.full_name} is now ${role}.`, 'success');
      setPendingRole(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setPendingRole(null);
    }
  };

  const submitManager = async (user: UserRow, managerId: string | null) => {
    try {
      await assignManager.mutateAsync({ id: user.id, managerId });
      toast('Manager updated', `Updated the reporting line for ${user.full_name}.`, 'success');
      setEditTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      <PageHead canManage={canManage} onAdd={() => setAddOpen(true)} />

      {isExecReadOnly && (
        <GateNotice variant="blocked" className="mb-3.5">
          You can view the user directory, but only an Admin can add, edit, or disable users.
        </GateNotice>
      )}

      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          <span className="text-[13px] font-semibold">All users</span>
          {state === undefined && (
            <span className="text-[12.5px] text-muted-foreground tabular">{all.length}</span>
          )}
          <SearchMini
            placeholder="Search by name or email…"
            aria-label="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        </Toolbar>
      )}

      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load users"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="admin"
          title="No users yet"
          sub="People appear here once they are invited to the workspace."
        />
      )}

      {state === undefined && (
        <DataTable<UserRow>
          rows={filtered}
          columns={columns}
          rowKey={(u) => u.id}
          rowMenu={canManage ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No users match your search"
          emptySub="Try a different name or email."
        />
      )}

      {/* Edit-role modal */}
      {editTarget?.mode === 'role' && (
        <RoleFormModal
          user={editTarget.user}
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

      {/* Add user — invite flow flagged as a follow-up (no broken create path) */}
      {addOpen && <InviteFollowUpModal onClose={() => setAddOpen(false)} />}

      {/* High-impact role-change confirm (default tone, names the impact) */}
      <ConfirmDialog
        open={!!pendingRole}
        tone="default"
        title={
          pendingRole ? `Change ${pendingRole.user.full_name}'s role to ${pendingRole.role}?` : 'Change role?'
        }
        description="This changes what they can see and do across the whole workspace, effective immediately. The change is recorded against your account."
        confirmLabel="Change role"
        loading={updateRole.isPending}
        onConfirm={confirmRole}
        onCancel={() => setPendingRole(null)}
      />
    </div>
  );
};

// ── Page header ──────────────────────────────────────────────────────────────

const PageHead: React.FC<{ canManage: boolean; onAdd?: () => void }> = ({ canManage, onAdd }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">Users</h1>
      <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
        Manage who can sign in, their role, and reporting line. Administration is Admin-only; role
        changes are high-impact and recorded.
      </p>
    </div>
    {canManage && onAdd && (
      <Button variant="primary" onClick={onAdd}>
        <Icon name="plus" />
        Add user
      </Button>
    )}
  </div>
);

// ── Edit-role modal ────────────────────────────────────────────────────────

interface RoleFormValues {
  role: UserRole;
}

const RoleFormModal: React.FC<{
  user: UserRow;
  onClose: () => void;
  onSubmit: (user: UserRow, role: UserRole) => void;
}> = ({ user, onClose, onSubmit }) => {
  const form = useEntityForm<RoleFormValues>({
    initialValues: { role: user.role },
    idPrefix: 'role-form',
  });
  const roleField = form.fieldProps('role');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      onSubmit(user, values.role);
    });
  };

  return (
    <EntityFormModal
      open
      title="Edit role"
      subtitle={`Set the workspace role for ${user.full_name}`}
      submitLabel="Save role"
      onSubmit={handleSubmit}
      onClose={onClose}
      dirty={form.isDirty}
    >
      <FormSection legend="Role">
        <SelectField
          id={roleField.id}
          label="Role"
          required
          value={roleField.value}
          onChange={(v) => roleField.onChange(v as UserRole)}
          onBlur={roleField.onBlur}
          options={ROLE_OPTIONS}
          helper="Determines what this user can see and do. Changes take effect immediately and are confirmed first."
          fullWidth
        />
      </FormSection>
    </EntityFormModal>
  );
};

// ── Change-manager modal ─────────────────────────────────────────────────────

interface ManagerFormValues {
  managerId: string | null;
}

const ManagerFormModal: React.FC<{
  user: UserRow;
  candidates: UserRow[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (user: UserRow, managerId: string | null) => void;
}> = ({ user, candidates, loading, onClose, onSubmit }) => {
  const form = useEntityForm<ManagerFormValues>({
    initialValues: { managerId: user.manager_id ?? null },
    idPrefix: 'manager-form',
  });
  const managerId = form.values.managerId;

  // The manager picker offers everyone EXCEPT the user themselves (no self-management).
  const loadOptions = async (): Promise<ComboboxOption[]> =>
    candidates
      .filter((c) => c.id !== user.id)
      .map((c) => ({
        value: c.id,
        label: c.full_name,
        sub: c.role,
        initials: initialsOf(c.full_name),
        color: avatarHue(c.id),
      }));

  const selectedOption: ComboboxOption | null = managerId
    ? (() => {
        const m = candidates.find((c) => c.id === managerId);
        return m
          ? { value: m.id, label: m.full_name, sub: m.role, initials: initialsOf(m.full_name), color: avatarHue(m.id) }
          : null;
      })()
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      onSubmit(user, values.managerId);
    });
  };

  return (
    <EntityFormModal
      open
      title="Change manager"
      subtitle={`Set the line manager for ${user.full_name}`}
      submitLabel="Save manager"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={form.isDirty}
    >
      <FormSection legend="Reporting line">
        <Combobox
          label="Manager"
          noun="person"
          value={managerId}
          selectedOption={selectedOption}
          onChange={(v) => form.setValue('managerId', v)}
          loadOptions={loadOptions}
          placeholder="Assign a manager…"
          searchPlaceholder="Search people…"
        />
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Used for timesheet-approval routing.
        </p>
        {managerId && (
          <button
            type="button"
            onClick={() => form.setValue('managerId', null)}
            className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline"
          >
            <Icon name="x" className="size-[13px]" />
            Clear manager
          </button>
        )}
      </FormSection>
    </EntityFormModal>
  );
};

// ── Add user — invite follow-up ──────────────────────────────────────────────

/**
 * Inviting a brand-new auth user needs the Supabase admin API (service-role key), which is
 * server-side only — so rather than ship a create form that can't succeed, this honest modal
 * explains the follow-up. Editing existing users' role + manager is fully wired (above).
 */
const InviteFollowUpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <ConfirmDialog
    open
    tone="default"
    title="Inviting users is coming soon"
    description="Sending an invitation creates a new sign-in account, which runs on the server. That flow is a follow-up. For now you can manage existing users' roles and reporting lines from the directory."
    confirmLabel="Got it"
    cancelLabel="Close"
    onConfirm={onClose}
    onCancel={onClose}
  />
);

export default AdminUsers;
