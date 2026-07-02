import React, { useMemo, useRef, useState } from 'react';
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
  type ComboboxOption,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useUsers, useUserMutations } from '@/src/hooks/useUsers';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { roleVariant } from '@/src/lib/status/statusVariants';
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
 * Scope (DEFERRED, plan §J): creating an auth user (invite/create) and disabling/Status both need
 * server-side capabilities not available client-side — invite/create needs the Supabase admin API
 * (service-role key); disable/Status needs a `profiles.status` column + an auth-admin call. Rather
 * than ship affordances that cannot succeed, "Add user" is a DISABLED control with a reason (an
 * honest deferred affordance, not a dead-end "coming soon" modal), and there is NO disable/Status
 * row action. Editing existing profiles' role + manager is fully wired.
 */

/** The five user_role enum values, ordered for the role <select>. */
const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'Engineer', label: 'Engineer' },
  { value: 'Project Manager', label: 'Project Manager' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Executive', label: 'Executive' },
  { value: 'Admin', label: 'Admin' },
];

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

  const tableRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  // Active modal: { mode:'role', user } | { mode:'manager', user } | null.
  const [editTarget, setEditTarget] = useState<{ mode: 'role' | 'manager'; user: UserRow } | null>(null);
  // Pending high-impact role change awaiting the confirm step.
  const [pendingRole, setPendingRole] = useState<{ user: UserRow; role: UserRole } | null>(null);

  /**
   * AD-1 (AC-JR-W3B-E1): scroll the table to the manager's row and highlight it
   * transiently (same-screen lever; no user-detail route exists yet).
   */
  const scrollToManager = (managerId: string) => {
    const manager = byId.get(managerId);
    if (!manager || !tableRef.current) return;
    // Find the <tr> or card element whose text contains the manager's name.
    // DataTable renders both a table branch (md+) and a card branch (<md).
    const container = tableRef.current;
    const allRows = [
      ...Array.from(container.querySelectorAll<HTMLElement>('tr[class]')),
      ...Array.from(container.querySelectorAll<HTMLElement>('[data-testid="dt-card-branch"] > div')),
    ];
    const target = allRows.find((el) => el.textContent?.includes(manager.full_name));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Transient highlight ring so the user sees which row was navigated to.
      target.style.outline = '2px solid hsl(var(--primary))';
      target.style.outlineOffset = '-2px';
      target.style.borderRadius = '4px';
      const timer = setTimeout(() => {
        target.style.outline = '';
        target.style.outlineOffset = '';
        target.style.borderRadius = '';
      }, 1600);
      return () => clearTimeout(timer);
    }
  };

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
      cell: (u) => <StatusPill variant={roleVariant(u.role)}>{u.role}</StatusPill>,
    },
    {
      key: 'manager',
      header: 'Manager',
      colClassName: 'hidden md:table-cell',
      // AD-1 (AC-JR-W3B-E1): clicking the manager name scrolls to that manager's
      // row in the same table (no user-detail route exists; keep small).
      cell: (u) => {
        const manager = u.manager_id ? byId.get(u.manager_id) : undefined;
        return manager ? (
          <button
            type="button"
            onClick={() => scrollToManager(manager.id)}
            className="truncate text-left text-[13px] underline-offset-2 hover:text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {manager.full_name}
          </button>
        ) : (
          <span className="text-muted-foreground">No manager</span>
        );
      },
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
      <PageHead canManage={canManage} />

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
        <div ref={tableRef}>
          <DataTable<UserRow>
            rows={filtered}
            columns={columns}
            rowKey={(u) => u.id}
            rowMenu={canManage ? rowMenu : undefined}
            state={filtered.length === 0 ? 'empty' : undefined}
            emptyTitle="No users match your search"
            emptySub="Try a different name or email."
          />
        </div>
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

/**
 * The short onboarding message copied to clipboard when the Admin clicks
 * "Copy invite instructions". This is an interim affordance (T26) while the
 * Supabase auth-admin invite API is not yet wired server-side.
 */
const INVITE_INSTRUCTIONS = `Hi,

You've been invited to the PMO workspace. To get started:

1. Visit the app URL your Admin provided.
2. Sign up with this email address using the "Sign up" option.
3. Your account will be set up automatically once you sign in for the first time.

Reach out to your Admin if you need help with access or your role.`;

const PageHead: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(INVITE_INSTRUCTIONS);
      setCopied(true);
      toast('Invite instructions copied', 'Paste this into an email to the new user.', 'success');
      // Reset "Copied" label after 2 s
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy failed', 'Select and copy the text manually.', 'warning');
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {/* B-8 (AC-W2-IA-003): <h1> is "Administration" — matches route /administration,
            rail item, and breadcrumb. "Users" is the section described below (the page will
            later hold more than just users, e.g. org settings). */}
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Administration</h1>
        <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
          Manage users&rsquo; role and reporting line. Administration is Admin-only; role
          changes are high-impact and recorded. To invite someone, copy the onboarding
          message below and email it to them — they sign up themselves and you set their role.
        </p>
      </div>
      {canManage && (
        /* T26: an HONEST working affordance — copies an onboarding message to clipboard
           so the Admin can email it to the new user. NO edge function, NO auth/service-role.
           Replaces the permanently-disabled "New user" dead-end (AC-PJ-ADMIN-001). */
        <Button variant="outline" onClick={() => void handleCopyInvite()}>
          <Icon name={copied ? 'check' : 'doc'} />
          {copied ? 'Copied!' : 'Copy invite instructions'}
        </Button>
      )}
    </div>
  );
};

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
            className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary-text hover:underline"
          >
            <Icon name="x" className="size-[13px]" />
            Clear manager
          </button>
        )}
      </FormSection>
    </EntityFormModal>
  );
};

export default AdminUsers;
