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
  TextField,
  Combobox,
  FormSection,
  GateNotice,
  SectionHeader,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type ComboboxOption,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { useUsers, useUserMutations } from '@/src/hooks/useUsers';
import { useUsage } from '@/src/hooks/useUsage';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { roleVariant } from '@/src/lib/status/statusVariants';
import type { UserRow, UserRole } from '@/src/lib/db/adminUsers';
import { useAuth } from '@/src/auth/useAuth';
import { AdministrationUsage } from './AdministrationUsage';
import { AdministrationCredits } from './AdministrationCredits';
import { AdministrationFeatures } from './AdministrationFeatures';

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
 * The Credits/Usage/Features sections are composed onto this page in later slices (S5, S6).
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
  const isOperator = useIsOperator();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUsers();
  const { updateRole, assignManager, invite, setStatus } = useUserMutations();
  // S6 adds the Operator org-switcher; until then every Usage read targets the caller's own org
  // (org-Admin path) or ALL orgs (Operator path, no filter — operatorOrgId omitted).
  const usageQuery = useUsage();
  const { currentUser } = useAuth();
  const ownOrgId = currentUser?.org_id ?? '';

  const tableRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  // Active modal: { mode:'role', user } | { mode:'manager', user } | null.
  const [editTarget, setEditTarget] = useState<{ mode: 'role' | 'manager'; user: UserRow } | null>(null);
  // Pending high-impact role change awaiting the confirm step.
  const [pendingRole, setPendingRole] = useState<{ user: UserRow; role: UserRole } | null>(null);
  // Invite modal open/closed.
  const [inviteOpen, setInviteOpen] = useState(false);
  // Pending disable/re-enable awaiting the confirm step (disable only — re-enable is immediate,
  // non-destructive).
  const [pendingStatus, setPendingStatus] = useState<{ user: UserRow; status: 'disabled' } | null>(null);

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
  // Invite/disable affordances: Admin-in-org OR Operator (FR-INV-006, AC-OPR-003). An Operator may
  // invite/disable even if their profiles.role isn't 'Admin' — useIsOperator is the OR-clause.
  const canInvite = may('create', 'user') || isOperator;
  const canDisable = canManage || isOperator;

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
        <PageHead canInvite={false} onInvite={() => setInviteOpen(true)} />
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
      key: 'status',
      header: 'Status',
      cell: (u) =>
        u.status === 'disabled' ? (
          <StatusPill variant="warn">Disabled</StatusPill>
        ) : (
          <StatusPill variant="neutral">Active</StatusPill>
        ),
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

  const rowMenu = (u: UserRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canManage) {
      items.push(
        { label: 'Edit role', onClick: () => setEditTarget({ mode: 'role', user: u }) },
        { label: 'Change manager', onClick: () => setEditTarget({ mode: 'manager', user: u }) },
      );
    }
    if (canDisable) {
      if (u.status === 'disabled') {
        items.push({ label: 'Re-enable', onClick: () => void confirmSetStatus(u, 'active') });
      } else {
        items.push({ label: 'Disable', danger: true, onClick: () => setPendingStatus({ user: u, status: 'disabled' }) });
      }
    }
    return items;
  };

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

  // ── Disable/Re-enable (AC-INV-003/004): admin_set_user_status RPC re-asserts authority +
  // the caller-agnostic sole-/self-Admin lockout guard (P0001) server-side. ──
  const confirmSetStatus = async (user: UserRow, status: 'active' | 'disabled') => {
    try {
      await setStatus.mutateAsync({ id: user.id, status, orgId: user.org_id });
      toast(
        status === 'disabled' ? 'User disabled' : 'User re-enabled',
        status === 'disabled'
          ? `${user.full_name} can no longer sign in.`
          : `${user.full_name} can sign in again.`,
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
    if (!pendingStatus) return;
    void confirmSetStatus(pendingStatus.user, pendingStatus.status);
  };

  // ── Invite (FR-INV-004/005): admin-invite-user edge fn — Admin-in-org OR Operator. ──
  const submitInvite = async (email: string, role: UserRole, pOrgId: string | null) => {
    try {
      await invite.mutateAsync({ email, role, pOrgId });
      toast('Invite sent', `${email} has been invited as ${role}.`, 'success');
      setInviteOpen(false);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err, {
        DUPLICATE_EMAIL: "That person is already in your workspace.",
        INVITE_UNAUTHORIZED: "You don't have permission to invite users.",
        INVALID_ROLE: 'Choose a valid role.',
        UNKNOWN_ORG: "That organization doesn't exist.",
      });
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      <PageHead canInvite={canInvite} onInvite={() => setInviteOpen(true)} />

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
            rowMenu={canManage || canDisable ? rowMenu : undefined}
            state={filtered.length === 0 ? 'empty' : undefined}
            emptyTitle="No users match your search"
            emptySub="Try a different name or email."
          />
        </div>
      )}

      {/* Usage section (ops-admin-surface S5) — aggregates-only, sourced from the usage RPCs. */}
      <div className="mt-6">
        <SectionHeader title="Usage" />
        <AdministrationUsage
          rows={usageQuery.data ?? []}
          isPending={usageQuery.isPending}
          isError={usageQuery.isError}
          onRetry={() => void usageQuery.refetch()}
        />
      </div>

      {/* Credits section (ops-admin-surface S6) — org-pool balance + Operator grant. */}
      <div className="mt-6">
        <AdministrationCredits isOperator={isOperator} orgId={ownOrgId} />
      </div>

      {/* Features section (ops-admin-surface S6) — Operator toggles + org-Admin read-only. */}
      <div className="mt-6">
        <SectionHeader title="Features" />
        <AdministrationFeatures isOperator={isOperator} orgId={ownOrgId} />
      </div>

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

      {/* Disable confirm (destructive tone — AC-INV-004) */}
      <ConfirmDialog
        open={!!pendingStatus}
        tone="destructive"
        title={pendingStatus ? `Disable ${pendingStatus.user.full_name}?` : 'Disable user?'}
        description="They will no longer be able to sign in. You can re-enable them at any time."
        confirmLabel="Disable"
        loading={setStatus.isPending}
        onConfirm={confirmDisable}
        onCancel={() => setPendingStatus(null)}
      />

      {/* Invite modal (FR-INV-004/005/006) */}
      {inviteOpen && (
        <InviteFormModal
          isOperator={isOperator}
          loading={invite.isPending}
          onClose={() => setInviteOpen(false)}
          onSubmit={submitInvite}
        />
      )}
    </div>
  );
};

// ── Page header ──────────────────────────────────────────────────────────────

const PageHead: React.FC<{ canInvite: boolean; onInvite: () => void }> = ({ canInvite, onInvite }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      {/* B-8 (AC-W2-IA-003): <h1> is "Administration" — matches route /administration,
          rail item, and breadcrumb. "Users" is the section described below (the page will
          later hold more than just users, e.g. org settings). */}
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">Administration</h1>
      <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
        Manage users&rsquo; role, status, and reporting line. Administration is Admin-only;
        role changes are high-impact and recorded.
      </p>
    </div>
    {canInvite && (
      /* FR-INV-004/006: a real, working invite affordance (admin-invite-user edge fn) —
         replaces the interim "Copy invite instructions" clipboard workaround. Create-verb
         consistency (DESIGN.md §7): button / modal title / submit all say "Invite user". */
      <Button variant="primary" onClick={onInvite}>
        <Icon name="plus" />
        Invite user
      </Button>
    )}
  </div>
);

// ── Edit-role modal ────────────────────────────────────────────────────────

interface RoleFormValues {
  role: UserRole;
}

// ── Invite modal (FR-INV-004/005) ────────────────────────────────────────────

interface InviteFormValues {
  email: string;
  role: UserRole;
}

const validateInvite = (v: InviteFormValues): Partial<Record<keyof InviteFormValues, string>> => {
  const errors: Partial<Record<keyof InviteFormValues, string>> = {};
  const email = v.email.trim();
  if (!email) errors.email = 'Email is required.';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email address.';
  return errors;
};

const InviteFormModal: React.FC<{
  isOperator: boolean;
  loading: boolean;
  onClose: () => void;
  onSubmit: (email: string, role: UserRole, pOrgId: string | null) => void;
}> = ({ isOperator, loading, onClose, onSubmit }) => {
  const form = useEntityForm<InviteFormValues>({
    initialValues: { email: '', role: 'Engineer' },
    validate: validateInvite,
    idPrefix: 'invite-form',
    requiredFields: ['email'],
  });
  const emailField = form.fieldProps('email');
  const roleField = form.fieldProps('role');

  const errorSummary = form.errors.email
    ? [{ fieldId: emailField.id, message: form.errors.email }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      // The Operator cross-org path (p_org_id) is added when the org-switcher lands (S5);
      // for now every invite (Operator or org-Admin) targets the caller's own org.
      onSubmit(values.email.trim(), values.role, null);
    });
  };

  return (
    <EntityFormModal
      open
      title="Invite user"
      subtitle={
        isOperator
          ? "Invite someone by email — they'll set their own password and role takes effect immediately."
          : "Invite someone to your workspace by email — they'll set their own password."
      }
      submitLabel="Invite user"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={form.isDirty}
      errorSummary={errorSummary}
    >
      <FormSection legend="Invite details">
        <TextField
          id={emailField.id}
          label="Email"
          type="email"
          required
          value={emailField.value}
          onChange={emailField.onChange}
          onBlur={emailField.onBlur}
          error={form.errors.email}
          fullWidth
        />
        <SelectField
          id={roleField.id}
          label="Role"
          required
          value={roleField.value}
          onChange={(v) => roleField.onChange(v as UserRole)}
          onBlur={roleField.onBlur}
          options={ROLE_OPTIONS}
          helper="Determines what this person can see and do once they sign in."
          fullWidth
        />
      </FormSection>
    </EntityFormModal>
  );
};

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
