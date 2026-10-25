/**
 * My Views list page — /views (I4, FR-VB-010..016).
 * Lists the current user's non-archived views; open / edit / archive affordances.
 * Follows Companies.tsx CRUD/RBAC pattern (ADR-0016/0017/0018).
 * I5: "Compose with AI" entry point (FR-AS-014, AC-AS-011/012).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@/src/lib/format';
import { useNavigate, Link, useSearchParams } from 'react-router';
import {
  ListPage,
  ListState,
  DataTable,
  ConfirmDialog,
  Button,
  SearchMini,
  SelectField,
  useToast,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { useUserViews, useUserViewMutations } from '@/src/hooks/useUserViews';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { UserViewRow } from '@/src/lib/db/userViews';
import { isFeatureEnabled } from '@/src/lib/features';
import AIComposerModal from '@/src/components/builder/AIComposerModal';
import type { CompositionSpec } from '@/src/lib/viewspec/types';
import { useUrlSearchInput } from '@/src/hooks/useListWorkingSet';

const MyViewsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUserViews();
  const { archive } = useUserViewMutations();
  const { currentUser } = useAuth();
  const realRole = useOptionalRealRole();
  const [searchParams, setSearchParams] = useSearchParams();

  const [archiveTarget, setArchiveTarget] = useState<UserViewRow | null>(null);
  const [aiComposerOpen, setAIComposerOpen] = useState(false);

  const showAIComposer =
    isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer');

  const canCreate = may('create', 'userView');
  const sort = searchParams.get('sort') === 'name-desc' ? 'name-desc' : 'name-asc';
  const query = searchParams.get('q') ?? '';
  const commitSearch = useCallback((nextQuery: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextQuery.trim()) next.set('q', nextQuery.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [search, setSearch] = useUrlSearchInput(query, commitSearch);

  const updateSort = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'name-asc') next.delete('sort');
    else next.set('sort', value);
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('q');
    setSearchParams(next, { replace: true });
    setSearch('');
  };

  const rows = useMemo(() => (data ?? [])
    .filter((row) => !search.trim() || `${row.name} ${row.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const order = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return (sort === 'name-desc' ? -order : order) || a.id.localeCompare(b.id);
    }), [data, search, sort]);

  const scopeLabel = (row: UserViewRow) => row.user_id === currentUser?.id
    ? t('financeCopy.mine', 'Mine')
    : t('financeCopy.sharedWithMe', 'Shared with me');

  const columns: Column<UserViewRow>[] = [
    {
      key: 'name',
      header: t('financeCopy.name', "Name"),
      cell: (row) => (
        <Link to={`/views/${row.id}`} className="font-medium text-foreground hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'scope',
      header: t('financeCopy.scope', 'Scope'),
      cell: (row) => <span className="text-muted-foreground">{scopeLabel(row)}</span>,
    },
    {
      key: 'description',
      header: t('financeCopy.description', "Description"),
      cell: (row) => (
        <span className="text-muted-foreground">{row.description ?? '—'}</span>
      ),
    },
    {
      key: 'updated_at',
      header: t('financeCopy.updated', "Updated"),
      cell: (row) => (
          <span className="text-muted-foreground">{formatRelativeTime(row.updated_at)}</span>
      ),
    },
  ];

  const rowMenu = (row: UserViewRow): RowMenuItem[] => {
    const canManage = row.user_id === currentUser?.id || realRole === 'Admin';
    return canManage ? [
      { label: t('financeCopy.edit', 'Edit'), onClick: () => navigate(`/views/${row.id}/edit`) },
      ...(may('archive', 'userView') ? [{ label: t('financeCopy.archive', 'Archive'), onClick: () => setArchiveTarget(row) }] : []),
    ] : [];
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync(archiveTarget.id);
      toast(t('financeCopy.viewArchived', 'View archived'), archiveTarget.name, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    } finally {
      setArchiveTarget(null);
    }
  };

  // AI Composer: navigate to /views/new with the composed spec in router state (FR-AS-014)
  const handleComposed = (spec: CompositionSpec) => {
    setAIComposerOpen(false);
    navigate('/views/new', { state: { composedSpec: spec } });
  };

  return (
    <ListPage
      title={t('financeCopy.savedViews', 'Saved views')}
      description={t('financeCopy.savedViewsScope', 'Mine and shared with me')}
      search={
        <div data-testid="views-toolbar" className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchMini
            placeholder={t('financeCopy.searchViews', 'Search saved views…')}
            aria-label={t('financeCopy.searchViews', 'Search saved views')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            searchSurface="views-list"
            module="views"
            resultCount={rows.length}
            containerClassName="w-full min-w-0 sm:min-w-[190px] sm:flex-1"
          />
          <SelectField
            id="views-sort"
            label={t('financeCopy.sortViews', 'Sort saved views')}
            hideLabel
            value={sort}
            onChange={updateSort}
            className="min-h-11 w-full sm:w-auto"
            options={[
              { value: 'name-asc', label: t('financeCopy.nameAsc', 'Name A–Z') },
              { value: 'name-desc', label: t('financeCopy.nameDesc', 'Name Z–A') },
            ]}
          />
          {showAIComposer && (
            <Button variant="outline" className="min-h-11" onClick={() => setAIComposerOpen(true)} aria-label={t('financeCopy.composeViewWithAI', 'Compose view with AI')}>
              {t('financeCopy.composeWithAI', 'Compose with AI')}
            </Button>
          )}
          {canCreate && <Button variant="primary" className="min-h-11" onClick={() => navigate('/views/new')}>{t('financeCopy.newView', 'New view')}</Button>}
        </div>
      }
    >
      {isError ? (
        <ListState
          variant="error"
          title={t('financeCopy.couldNotLoadViews', "Could not load views.")}
          sub={t('financeCopy.aNetworkOrServerErrorOccurred', "A network or server error occurred.")}
          onRetry={refetch}
        />
      ) : isPending ? (
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          state="loading"
        tableId="myviewspage-1-table" />
      ) : (data ?? []).length === 0 ? (
        <ListState
          variant="empty"
          title={t('financeCopy.noViewsYet', 'No saved views yet')}
          sub={t('financeCopy.noViewsYetSub', 'Save a view when you need the same scoped answer again.')}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowMenu={rowMenu}
          onActivate={(row) => navigate(`/views/${row.id}`)}
          rowLabel={(row) => t('financeCopy.openSavedView', 'Open {{name}}', { name: row.name })}
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('financeCopy.noViewsMatch', 'No saved views match these filters')}
          emptySub={t('financeCopy.noViewsMatchSub', 'Try a different search or scope, or clear the filters.')}
          emptyAction={{ label: t('financeCopy.clearFilters', 'Clear filters'), onClick: clearFilters }}
        tableId="myviewspage-2-table" />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        tone="destructive"
        title={t('financeCopy.archiveThisView', "Archive this view?")}
        description={t('financeCopy.archiveViewDescription', '"{{name}}" will be archived and removed from your list.', { name: archiveTarget?.name ?? '' })}
        confirmLabel={t('financeCopy.archive', "Archive")}
        cancelLabel={t('financeCopy.keep', "Keep")}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
        loading={archive.isPending}
      />

      {/* AI Composer modal — navigates to builder with composed spec on success (FR-AS-014) */}
      {showAIComposer && (
        <AIComposerModal
          open={aiComposerOpen}
          onClose={() => setAIComposerOpen(false)}
          onComposed={handleComposed}
        />
      )}
    </ListPage>
  );
};

export default MyViewsPage;
