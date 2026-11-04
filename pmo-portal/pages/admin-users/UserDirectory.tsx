import React, { useMemo, useRef, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ListState,
  DataTable,
  StatusPill,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import { roleVariant } from '@/src/lib/status/statusVariants';
import type { UserRow } from '@/src/lib/db/adminUsers';
import { Avatar } from './userPresentation';
import { useRoleLabels } from './roleLabels';

/**
 * The Administration › Users directory (CROSS-65 / XG01-002): the body block — toolbar + search,
 * the load/empty/error states, the columns, the per-row action menu and the same-screen manager
 * navigation — moved off AdminUsers. The PAGE stays the authorization and mutation coordinator:
 * it resolves permissions and owns every mutation, confirm and modal; this component receives the
 * resolved facts and callbacks, and decides only how the directory presents and which row
 * affordances a resolved permission set exposes.
 */
export interface UserDirectoryProps {
  rows: UserRow[];
  state: 'loading' | 'empty' | 'error' | undefined;
  onRetry: () => void;
  canManage: boolean;
  canDisable: boolean;
  currentUserId: string | undefined;
  isSoleAdmin: (u: UserRow) => boolean;
  onEditRole: (u: UserRow) => void;
  onChangeManager: (u: UserRow) => void;
  onSetStatus: (u: UserRow, status: 'active' | 'disabled') => void;
}

export const UserDirectory: React.FC<UserDirectoryProps> = ({
  rows,
  state,
  onRetry,
  canManage,
  canDisable,
  currentUserId,
  isSoleAdmin,
  onEditRole,
  onChangeManager,
  onSetStatus,
}) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const tableRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');

  const byId = useMemo(() => {
    const m = new Map<string, UserRow>();
    rows.forEach((u) => m.set(u.id, u));
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [rows, search]);

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

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: t('admin.users.columns.user', 'User'),
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar user={u} />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold" title={u.full_name}>
              {u.full_name}
            </span>
            <span className="truncate text-[12px] text-muted-foreground" title={u.email}>
              {u.email}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('admin.users.columns.role', 'Role'),
      cell: (u) => <StatusPill variant={roleVariant(u.role)}>{roleNames.label(u.role)}</StatusPill>,
    },
    {
      key: 'status',
      header: t('admin.users.columns.status', 'Status'),
      cell: (u) =>
        u.status === 'disabled' ? (
          <StatusPill variant="warn">{t('admin.users.status.disabled', 'Disabled')}</StatusPill>
        ) : (
          <span>
            <StatusPill variant="neutral">{t('admin.users.status.active', 'Active')}</StatusPill>
            {isSoleAdmin(u) && <span className="ml-2 text-muted-foreground">{t('administration:onlyActiveAdmin', 'The only active Admin cannot be disabled')}</span>}
          </span>
        ),
    },
    {
      key: 'manager',
      header: t('admin.users.columns.manager', 'Manager'),
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
          <span className="text-muted-foreground">{t('admin.users.noManager', 'No manager')}</span>
        );
      },
    },
  ];

  const rowMenu = (u: UserRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    // 0179 (profiles_hierarchy_write): the write RLS denies an Admin editing their OWN
    // role or manager_id. Gate the two self-edit affordances off on the caller's own row
    // (UX-only per ADR-0016 — `can()` may be stricter than RLS; RLS stays the authority) so
    // the action surfaces as an omitted control. The status RPC retains its lockout guard. The page
    // convention for an unavailable action is to omit it (RowMenuItem has no disabled field).
    const isSelf = !!currentUserId && currentUserId === u.id;
    if (canManage && !isSelf) {
      items.push(
        { label: t('admin.users.menu.editRole', 'Edit role'), onClick: () => onEditRole(u) },
        { label: t('admin.users.menu.changeManager', 'Change manager'), onClick: () => onChangeManager(u) },
      );
    }
    if (canDisable) {
      if (u.status === 'disabled') {
        items.push({ label: t('admin.users.menu.reEnable', 'Re-enable'), onClick: () => onSetStatus(u, 'active') });
      } else if (!isSelf && !isSoleAdmin(u)) {
        items.push({ label: t('admin.users.menu.disable', 'Disable'), danger: true, onClick: () => onSetStatus(u, 'disabled') });
      }
    }
    return items;
  };

  return (
    <>
      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          <span className="text-[13px] font-semibold">{t('admin.users.allUsers', 'All users')}</span>
          {state === undefined && (
            <span className="text-[12.5px] text-muted-foreground tabular">{rows.length}</span>
          )}
          <SearchMini
            placeholder={t('admin.users.search.placeholder', 'Search by name or email…')}
            aria-label={t('admin.users.search.label', 'Search users')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        </Toolbar>
      )}

      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={7} rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('admin.users.error.title', "Couldn't load users")}
          sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          retryLabel={t('admin.retry', 'Retry')}
          onRetry={onRetry}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="admin"
          title={t('admin.users.empty.title', 'No users yet')}
          sub={t('admin.users.empty.sub', 'People appear here once they are invited to the workspace.')}
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
            emptyTitle={t('admin.users.noMatch.title', 'No users match your search')}
            emptySub={t('admin.users.noMatch.sub', 'Try a different name or email.')}
          tableId="adminusers-table" />
        </div>
      )}
    </>
  );
};
