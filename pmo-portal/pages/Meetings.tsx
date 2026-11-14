import { projectDisplayName, sortProjectOptions } from '@/src/lib/projectDisplayName';
import React, { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  FilterBar,
  useUrlFilters,
  ListState,
  DataTable,
  ConfirmDialog,
  useToast,
  Button,
  Icon,
  StatusPill,
  Switch,
  type Column,
  type RowMenuItem,
  type FilterBarFilter,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useMeetingsPages, useMeetingMutations } from '@/src/hooks/useMeetings';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { useListReturn } from '@/src/hooks/useListReturn';
import { formatClockTime, formatDay } from '@/src/lib/format';
import type { MeetingListItem } from '@/src/lib/db/meetings';

/**
 * Meetings — the reverse-chronological list (#526, FR-MTG-028..030).
 *
 * Reads are RLS-scoped (attendance ∪ author ∪ grant ∪ Admin — FR-MTG-031): this list shows only
 * the meetings the caller may read, so an empty list is a normal state for a member who attends
 * few meetings, not an error. EVERY role may create a meeting (OD-MTG-1, Engineer included).
 * Search runs server-side over the `notes_search` projection (DD-MTG-5 — notes are the primary
 * find mechanism, so a client-side title filter would fail the ticket).
 */

const Meetings: React.FC = () => {
  const { t } = useTranslation();
  const { t: tMeetings } = useTranslation('meetings');
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  const { toast } = useToast();

  const { values, setFilter, clear } = useUrlFilters(['q', 'project', 'archived']);
  const projectFilter = values.project;
  const showArchived = values.archived === '1';
  const search = values.q;
  const deferredSearch = useDeferredValue(search);

  const { data, total: exactTotal, isPartial, isPending, isError, isPlaceholderData, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useMeetingsPages({
    projectId: !projectFilter || projectFilter === 'All' ? undefined : projectFilter,
    search: deferredSearch.trim() || undefined,
    includeArchived: showArchived,
  });
  const rows = useMemo(() => data?.pages.flatMap((page) => page.rows) ?? [], [data]);
  // A search whose full-text leg failed loaded only the substring matches: an exact count would
  // promise rows this list cannot reach, so the footer falls back to "x loaded, more available".
  const total = !isPlaceholderData && !isPartial ? exactTotal : undefined;
  // A filter/search change keeps the PREVIOUS query's rows on screen (placeholderData in the
  // hook). A kept-previous EMPTY result says nothing about the new query — e.g. right after Clear
  // filters it would read as "No meetings yet" — so the body shows loading until it lands.
  const awaitingRows = Boolean(isPlaceholderData) && rows.length === 0;
  // A Back return restores scroll only onto THIS query's settled rows — never onto a placeholder.
  const { openRecord } = useListReturn({
    list: 'meetings',
    contentReady: !isPending && !isError && !isPlaceholderData,
  });
  const { data: projects } = useProjectPickerOptions();
  const { archive, restore, remove } = useMeetingMutations();
  const [archiveTarget, setArchiveTarget] = useState<MeetingListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingListItem | null>(null);

  const canCreate = may('create', 'meeting');


  const projectOptions = useMemo(
    () => sortProjectOptions(projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })),
    [projects],
  );
  // Spec decision 6: a `?project=` naming no project this user can see stays the ACTIVE choice —
  // the control agrees with the URL and the zero-match state offers Clear filters — rather than
  // the select silently showing "All projects". Filter-only: the create form never offers it.
  const projectFilterOptions = useMemo(() => {
    const options = [...projectOptions];
    if (projectFilter && projectFilter !== 'All' && !options.some((o) => o.value === projectFilter)) {
      options.push({
        value: projectFilter,
        // Until the projects have loaded the choice may yet resolve, so it is not called unavailable.
        label: projects ? t('meetings.filters.unavailableProject', 'Unavailable project') : '…',
      });
    }
    return options;
  }, [projectFilter, projectOptions, projects, t]);

  const filters: FilterBarFilter[] = useMemo(() => [
    {
      key: 'project',
      label: t('meetings.filters.projectLabel', 'Filter by project'),
      kind: 'select',
      options: projectFilterOptions,
    },
  ], [projectFilterOptions, t]);

  const handleFilterChange = (key: string, value: string) => {
    setFilter(key, value);
    if (key === 'project') {
      trackFilterApplied('project', (projects ?? []).length + 1, 'meetings');
    }
  };

  // Filter/search state changes keep the previous rows on screen (placeholderData in the hook),
  // so 'loading' (which also hides the toolbar) is only the true first load; a kept-previous empty
  // result is `awaitingRows` — a body-only skeleton with the toolbar left mounted.
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : awaitingRows
        ? undefined
          : rows.length === 0 && !search.trim() && (!projectFilter || projectFilter === 'All')
          ? 'empty'
          : undefined;

  // AC-LRC-012: the DataTable's `empty` branch (with `clearFilters`) only renders when
  // `state === undefined` (the collection-empty case is the `state === 'empty'` branch below), so
  // a zero-match result there is always a filtered zero-match.

  const columns: Column<MeetingListItem>[] = [
    {
      key: 'title',
      header: t('meetings.columns.title', 'Meeting'),
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-2" title={m.title}>
          <span className={m.archived_at ? 'truncate font-semibold text-muted-foreground' : 'truncate font-semibold'}>
            {m.title}
          </span>
          {m.archived_at && <StatusPill variant="neutral">{tMeetings('pill.archived', 'Archived')}</StatusPill>}
        </span>
      ),
      exportValue: (m) => m.title,
    },
    {
      key: 'occurred_at',
      header: t('meetings.columns.when', 'When'),
      cell: (m) => <span className={m.archived_at ? 'whitespace-nowrap text-muted-foreground' : 'whitespace-nowrap'}>{formatDay(m.occurred_at)}, {formatClockTime(new Date(m.occurred_at))}</span>,
      exportValue: (m) => m.occurred_at,
    },
    {
      key: 'project',
      header: t('meetings.columns.project', 'Project'),
      cell: (m) => <span className={m.archived_at ? 'truncate text-muted-foreground' : 'truncate'} title={m.project?.name}>{m.project ? projectDisplayName(m.project) : '—'}</span>,
      exportValue: (m) => m.project?.name ?? '',
    },
    {
      key: 'location',
      header: t('meetings.columns.location', 'Location'),
      cell: (m) => <span className={m.archived_at ? 'truncate text-muted-foreground' : 'truncate'}>{m.location ?? '—'}</span>,
      exportValue: (m) => m.location ?? '',
    },
  ];

  const rowMenu = (m: MeetingListItem): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    // M13: Open is NAVIGATION, not a write — every viewer who can see the row may open it
    // (RLS already scoped the row set to what they can read). Never gate it on edit rights.
    items.push({
      label: t('meetings.actions.open', 'Open'),
      onClick: () => openRecord(`/meetings/${m.id}`),
    });
    const mayArchive = may('archive', 'meeting', {
      currentUserId,
      record: { created_by_id: m.created_by_id },
    });
    if (mayArchive && m.archived_at) {
      items.push({
        label: restore.isPending
          ? tMeetings('actions.restoring', 'Restoring…')
          : tMeetings('actions.restore', 'Restore'),
        disabled: restore.isPending,
        onClick: () => void onRestore(m),
      });
    } else if (mayArchive) {
      items.push({
        label: t('meetings.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(m),
      });
    } else {
      // C13 (DS meetings #6): the rule is known, so state it. A silently absent Archive leaves the
      // reader unable to tell "not allowed" from "not built" — the item explains itself instead.
      items.push({
        label: tMeetings('actions.archiveRestricted', 'Archive — author or Admin only'),
        disabled: true,
        onClick: () => undefined,
      });
    }
    if (may('delete', 'meeting'))
      items.push({
        label: t('meetings.actions.delete', 'Delete'),
        onClick: () => setDeleteTarget(m),
        danger: true,
      });
    return items;
  };

  const onRestore = async (meeting: MeetingListItem) => {
    try {
      await restore.mutateAsync(meeting.id);
      toast(tMeetings('toast.restored', 'Meeting restored'), meeting.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast(t('meetings.toast.archived', 'Meeting archived'), target.title, 'success');
      setArchiveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast(t('meetings.toast.deleted', 'Meeting deleted'), target.title, 'success');
      setDeleteTarget(null);
    } catch (err) {
      // 23503 (FR-MTG-016): tasks minuted out of this meeting FK-block the hard delete —
      // classifyMutationError surfaces it as "in use"; archiving is the recovery path.
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  return (
    <ListPage
      title={t('meetings.title', 'Meetings')}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => openRecord('/meetings/new')}>
            <Icon name="plus" />
            {t('meetings.actions.new', 'New meeting')}
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          <FilterBar
            searchKey="q"
            searchLabel={t('meetings.search.ariaLabel', 'Search meetings')}
            searchPlaceholder={t('meetings.search.placeholder', 'Search notes and titles…')}
            filters={filters}
            values={values}
            onChange={handleFilterChange}
            onClear={clear}
            shown={rows.length}
            total={total}
            labels={{
              all: t('meetings.filters.allProjects', 'All projects'),
              clear: 'Clear all',
            }}
          />
        )
      }
      secondaryFilter={
        state !== 'loading' && (
          <div className="inline-flex min-h-11 items-center gap-2">
            <span id="meetings-show-archived-label" className="text-control font-medium">
              {tMeetings('filters.showArchived', 'Show archived')}
            </span>
            <Switch
              checked={showArchived}
              onChange={(archived) => setFilter('archived', archived ? '1' : '')}
              labelledBy="meetings-show-archived-label"
            />
          </div>
        )
      }
    >
      {(state === 'loading' || (state === undefined && awaitingRows)) && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={6} rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('meetings.states.errorTitle', "Couldn't load meetings")}
          sub={t('meetings.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="cal"
          title={showArchived
            ? tMeetings('states.archivedEmptyTitle', 'No meetings to show')
            : t('meetings.states.emptyTitle', 'No meetings yet')}
          stateId="meetings-empty"
          role={realRole ?? undefined}
          module="meetings"
        />
      )}

      {state === undefined && !awaitingRows && (
        <DataTable<MeetingListItem>
          rows={rows}
          columns={columns}
          rowKey={(m) => m.id}
          // list-working-set-return (#683, AC-LRC-008): capture the current filtered/searched
          // Meetings URL + scroll position as return context instead of a bare navigate.
          onActivate={(m) => openRecord(`/meetings/${m.id}`)}
          // M12: interpolated key — safe now that test/setup.ts initialises i18next, so the
          // options bag interpolates in unit tests exactly as it does at runtime.
          rowLabel={(m) => t('meetings.table.rowLabel', 'Open {{title}}', { title: m.title })}
          rowMenu={rowMenu}
          total={total}
          hasMore={Boolean(hasNextPage && !isPlaceholderData)}
          isLoadingMore={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          loadMoreLabel={t('list.loadMore', { ns: 'meetings', defaultValue: 'Load more' })}
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('meetings.table.emptyTitle', 'No meetings match')}
          emptyAction={{ label: t('meetings.table.clearFilters', 'Clear filters'), onClick: clear }}
        tableId="meetings-table" />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        title={
          archiveTarget
            ? t('meetings.confirm.archiveTitleNamed', 'Archive {{title}}?', {
                title: archiveTarget.title,
              })
            : t('meetings.confirm.archiveTitle', 'Archive meeting?')
        }
        description={t(
          'meetings.confirm.archiveDescription',
          "It will be hidden from the default list. Its minutes, attendees and action items stay intact. You can restore it any time.",
        )}
        confirmLabel={t('meetings.confirm.archiveConfirm', 'Archive meeting')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? t('meetings.confirm.deleteTitleNamed', 'Delete {{title}}?', {
                title: deleteTarget.title,
              })
            : t('meetings.confirm.deleteTitle', 'Delete meeting?')
        }
        description={t(
          'meetings.confirm.deleteDescription',
          'This permanently removes the meeting and its minutes. A meeting whose action items still exist as tasks cannot be deleted; archive it instead.',
        )}
        confirmLabel={t('meetings.confirm.deleteConfirm', 'Delete meeting')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

export default Meetings;
