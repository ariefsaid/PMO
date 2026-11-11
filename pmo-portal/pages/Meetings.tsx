import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  SearchMini,
  SelectField,
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
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useMeetings, useMeetingMutations } from '@/src/hooks/useMeetings';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { useListSearchWorkingSet } from '@/src/hooks/useListSearchWorkingSet';
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

  // list-working-set-return (#683): `project`/`q` are URL-owned (AC-LRC-008). Search stays LOCAL
  // text (`search`, updated immediately per keystroke — see useUrlSearchInput's search contract)
  // and is written to the URL only after a pause, so a copied link reproduces the same query.
  // The SERVER query still derives from the LOCAL text deferred via useDeferredValue — exactly the
  // prior timing — never from the debounced URL value, which would double the query's lag.
  const { workingSet, setWorkingSet, search, setSearch, clearFilters } =
    useListSearchWorkingSet('meetings');
  const projectFilter = workingSet.project;
  const showArchived = workingSet.archived;
  const deferredSearch = useDeferredValue(search);

  const { data, isPending, isError, isPlaceholderData, refetch } = useMeetings({
    projectId: projectFilter === 'All' ? undefined : projectFilter,
    search: deferredSearch.trim() || undefined,
    includeArchived: showArchived,
  });
  const rows = useMemo(() => data ?? [], [data]);
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
    () => [
      { value: 'All', label: t('meetings.filters.allProjects', 'All projects') },
      ...(projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })),
    ],
    [projects, t],
  );
  // Spec decision 6: a `?project=` naming no project this user can see stays the ACTIVE choice —
  // the control agrees with the URL and the zero-match state offers Clear filters — rather than
  // the select silently showing "All projects". Filter-only: the create form never offers it.
  const projectFilterOptions = useMemo(() => {
    if (projectFilter === 'All' || projectOptions.some((o) => o.value === projectFilter)) {
      return projectOptions;
    }
    return [
      ...projectOptions,
      {
        value: projectFilter,
        // Until the projects have loaded the choice may yet resolve, so it is not called unavailable.
        label: projects ? t('meetings.filters.unavailableProject', 'Unavailable project') : '…',
      },
    ];
  }, [projectFilter, projectOptions, projects, t]);

  // Filter/search state changes keep the previous rows on screen (placeholderData in the hook),
  // so 'loading' (which also hides the toolbar) is only the true first load; a kept-previous empty
  // result is `awaitingRows` — a body-only skeleton with the toolbar left mounted.
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : awaitingRows
        ? undefined
          : rows.length === 0 && !search.trim() && projectFilter === 'All'
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
      count={data ? rows.length : undefined}
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
          <div className="flex flex-wrap items-center gap-3">
            <SelectField
              label={t('meetings.filters.projectLabel', 'Filter by project')}
              hideLabel
              value={projectFilter}
              onChange={(v) => {
                setWorkingSet((ws) => ({ ...ws, project: v }));
                trackFilterApplied('project', projectOptions.length, 'meetings');
              }}
              options={projectFilterOptions}
            />
            <div className="inline-flex min-h-11 items-center gap-2">
              <span id="meetings-show-archived-label" className="text-control font-medium">
                {tMeetings('filters.showArchived', 'Show archived')}
              </span>
              <Switch
                checked={showArchived}
                onChange={(archived) => setWorkingSet((ws) => ({ ...ws, archived }))}
                labelledBy="meetings-show-archived-label"
              />
            </div>
          </div>
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('meetings.search.placeholder', 'Search notes and titles…')}
            aria-label={t('meetings.search.ariaLabel', 'Search meetings')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="meetings-list"
            module="meetings"
            resultCount={rows.length}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto sm:min-w-[220px]"
          />
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
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('meetings.table.emptyTitle', 'No meetings match')}
          emptyAction={{ label: t('meetings.table.clearFilters', 'Clear filters'), onClick: clearFilters }}
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
