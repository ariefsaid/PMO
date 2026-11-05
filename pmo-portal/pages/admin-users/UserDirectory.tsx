import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ListState,
  DataTable,
  StatusPill,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import { roleVariant } from '@/src/lib/status/statusVariants';
import { formatNumberWhole } from '@/src/lib/format';
import type { UserDirectoryRow } from '@/src/lib/db/adminUsers';
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
  /** The visible server page (never the whole org). */
  rows: UserDirectoryRow[];
  /** Exact count of people matching the current search, over the WHOLE org. */
  total: number;
  page: number;
  pageSize: number;
  /** The committed (debounced) search term the current page was read with. */
  search: string;
  onSearchChange: (search: string) => void;
  onPageChange: (page: number) => void;
  state: 'loading' | 'empty' | 'error' | undefined;
  onRetry: () => void;
  /** True while a page/search change is in flight; the previous page stays visible. */
  busy?: boolean;
  canManage: boolean;
  canDisable: boolean;
  currentUserId: string | undefined;
  isSoleAdmin: (u: UserDirectoryRow) => boolean;
  /** True when the sole-Admin count could not be resolved — never treated as "not sole". */
  isAdminStateUnknown: (u: UserDirectoryRow) => boolean;
  /**
   * The manager jump target. `userId` is the identity that is highlighted (never a name match);
   * `state` distinguishes a lookup still running / succeeded / failed / person-not-readable so
   * every case can be shown and recovered from.
   */
  focus: {
    userId: string;
    name: string;
    state: 'locating' | 'located' | 'error' | 'unavailable';
    onReturn: () => void;
    onRetry: () => void;
  } | null;
  /** Move the directory to the page holding this person (bounded exact-person lookup). */
  onJumpToUser: (userId: string, name: string) => void;
  onEditRole: (u: UserDirectoryRow) => void;
  onChangeManager: (u: UserDirectoryRow) => void;
  onSetStatus: (u: UserDirectoryRow, status: 'active' | 'disabled') => void;
}

export const UserDirectory: React.FC<UserDirectoryProps> = ({
  rows,
  total,
  page,
  pageSize,
  search,
  onSearchChange,
  onPageChange,
  state,
  onRetry,
  busy = false,
  canManage,
  canDisable,
  currentUserId,
  isSoleAdmin,
  isAdminStateUnknown,
  focus,
  onJumpToUser,
  onEditRole,
  onChangeManager,
  onSetStatus,
}) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const tableRef = useRef<HTMLDivElement>(null);
  // The input stays local and responsive; the SERVER query is only issued after the person stops
  // typing (300 ms), so one keystroke never becomes one whole-org read.
  const [typed, setTyped] = useState(search);
  useEffect(() => { setTyped(search); }, [search]);
  useEffect(() => {
    const next = typed.trim();
    if (next === search) return;
    const timer = setTimeout(() => onSearchChange(next), 300);
    return () => clearTimeout(timer);
  }, [typed, search, onSearchChange]);

  const byId = useMemo(() => {
    const m = new Map<string, UserDirectoryRow>();
    rows.forEach((u) => m.set(u.id, u));
    return m;
  }, [rows]);

  /**
   * AD-1 (AC-JR-W3B-E1): a manager click resolves the manager's actual PAGE (bounded exact-person
   * lookup) and highlights that row. Both the same-page and the other-page case go through the
   * person's ID: a name is not an identity in a directory (two people can share one, and an earlier
   * row's manager cell can contain the same name).
   */
  const rowDomId = (userId: string) => `admin-user-row-${userId}`;

  // Manager jump landed: bring the TARGET ROW into view and ring it once, by id.
  useEffect(() => {
    if (focus?.state !== 'located') return;
    const container = tableRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[id="${rowDomId(focus.userId)}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.style.outline = '2px solid hsl(var(--primary))';
    target.style.outlineOffset = '-2px';
    target.style.borderRadius = '4px';
    const timer = setTimeout(() => {
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.borderRadius = '';
    }, 1600);
    return () => clearTimeout(timer);
  }, [focus?.state, focus?.userId, rows]);

  const columns: Column<UserDirectoryRow>[] = [
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
      // AD-1 (AC-JR-W3B-E1): clicking the manager name shows that person: their page (bounded
      // exact-person lookup), their row highlighted, and a way back. The manager's NAME comes from
      // the row's server-side embed, so it is correct even when the manager sits on another page;
      // the TARGET is always the real id.
      cell: (u) => {
        const manager = u.manager_id ? byId.get(u.manager_id) : undefined;
        const name = manager?.full_name ?? u.manager?.full_name ?? null;
        if (!name || !u.manager_id) return <span className="text-muted-foreground">{t('admin.users.noManager', 'No manager')}</span>;
        return (
          <button
            type="button"
            onClick={() => onJumpToUser(u.manager_id as string, name)}
            className="truncate text-left text-[13px] underline-offset-2 hover:text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {name}
          </button>
        );
      },
    },
  ];

  const rowMenu = (u: UserDirectoryRow): RowMenuItem[] => {
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
      } else if (!isSelf && !isSoleAdmin(u) && !isAdminStateUnknown(u)) {
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
            <span className="text-[12.5px] text-muted-foreground tabular" data-testid="admin-users-total">{formatNumberWhole(total)}</span>
          )}
          <SearchMini
            placeholder={t('admin.users.search.placeholder', 'Search by name or email…')}
            aria-label={t('admin.users.search.label', 'Search users')}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
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
        <>
          {focus && (
            <div role="status" data-testid="admin-users-focus" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
              <span>
                {focus.state === 'locating'
                  ? t('administration:admin.users.focus.locating', 'Finding {{name}}…', { name: focus.name })
                  : focus.state === 'error'
                    ? t('administration:admin.users.focus.error', "Couldn't find where {{name}} is in the directory.", { name: focus.name })
                    : focus.state === 'unavailable'
                      ? t('administration:admin.users.focus.unavailable', '{{name}} is no longer in your directory.', { name: focus.name })
                      : t('administration:admin.users.focus.showing', 'Showing {{name}} — the person you followed from your page.', { name: focus.name })}
              </span>
              <span className="flex gap-2">
                {focus.state === 'error' && (
                  <Button variant="ghost" size="sm" onClick={focus.onRetry}>{t('administration:admin.users.focus.retry', 'Retry')}</Button>
                )}
                <Button variant="ghost" size="sm" onClick={focus.onReturn}>{t('administration:admin.users.focus.return', 'Back to your page')}</Button>
              </span>
            </div>
          )}
          <div ref={tableRef} aria-busy={busy || undefined}>
            <DataTable<UserDirectoryRow>
              rows={rows}
              columns={columns}
              rowKey={(u) => u.id}
              rowTarget={(u) => rowDomId(u.id)}
              rowMenu={canManage || canDisable ? rowMenu : undefined}
              state={rows.length === 0 ? 'empty' : undefined}
              emptyTitle={t('admin.users.noMatch.title', 'No users match your search')}
              emptySub={t('admin.users.noMatch.sub', 'Try a different name or email.')}
            tableId="adminusers-table" />
          </div>
          {total > 0 && (
            <nav aria-label={t('administration:admin.users.pager.label', 'Pages')} className="mt-3 flex items-center justify-between gap-3 text-[13px] tabular-nums">
              <span data-testid="admin-users-range" aria-live="polite" aria-atomic="true">
                {t('administration:admin.users.pager.range', '{{from}}–{{to}} of {{total}}', {
                  from: formatNumberWhole((page - 1) * pageSize + 1),
                  to: formatNumberWhole(Math.min(page * pageSize, total)),
                  total: formatNumberWhole(total),
                })}
              </span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPageChange(page - 1)} aria-label={t('administration:admin.users.pager.prev', 'Previous page')}><Icon name="back" aria-hidden="true" /></Button>
                <Button variant="outline" size="sm" disabled={page * pageSize >= total || busy} onClick={() => onPageChange(page + 1)} aria-label={t('administration:admin.users.pager.next', 'Next page')}><Icon name="chev" aria-hidden="true" /></Button>
              </span>
            </nav>
          )}
        </>
      )}
    </>
  );
};
