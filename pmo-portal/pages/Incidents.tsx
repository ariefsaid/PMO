import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  FilterBar,
  useUrlFilters,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type FilterBarFilter,
} from '@/src/components/ui';
import { ExportAllButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIncidentsPage, useIncidentsExportAll, useIncidentMutations, useAssigneeOptions } from '@/src/hooks/useIncidents';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { INCIDENTS_PAGE_SIZE, type IncidentRow, type IncidentStatus } from '@/src/lib/db/incidents';
import { formatDay } from '@/src/lib/format';
import { severityVariant } from '@/src/lib/status/statusVariants';
import { statusLabel } from '@/src/lib/status/statusMap';
import { NEXT_STATUS, transitionCopy as getTransitionCopy, severityLabel, type AdvanceStatus } from '@/src/lib/incidents/transitions';
import { isIncidentOverdue, needsCloseProof } from '@/src/lib/incidents/overdue';
import { IncidentFormModal } from '@/components/IncidentFormModal';

/** Status filter segments: All + the three incident_status enum values. */
type StatusFilter = 'All' | IncidentStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Open', 'Investigating', 'Closed'];

// Severity (`severityVariant`) and workflow status (`workflowVariant`) tints come
// from the single status registry (`src/lib/status/statusVariants.ts`). Per the
// Freed-Blue Status Rule, Low = neutral, Medium/High = amber `warn`, Critical = red
// `lost`; Open = neutral grey `progress` (NOT the action-blue), Investigating =
// `progress`, Closed = neutral. The distinct LABEL carries identity (never colour-only).
//
// The workflow transition machinery (NEXT_STATUS / TRANSITION_COPY) lives in the shared
// `src/lib/incidents/transitions.ts` so the list and the `/incidents/:id` detail page (CW-4a)
// advance the lifecycle the same way; the File/Edit form is the shared `IncidentFormModal`.

/** Pending status transition (drives the confirm dialog). */
interface TransitionTarget {
  incident: IncidentRow;
  to: AdvanceStatus;
}

const Incidents: React.FC = () => {
  const { t: tStatus } = useTranslation('status');
  const { t } = useTranslation('incidents');
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { create, update, transition, remove } = useIncidentMutations();
  const exportAll = useIncidentsExportAll();
  const { data: assigneeOptions } = useAssigneeOptions();

  // R2: page joins q/status in the URL so Back/refresh return to the same page; page 1 (the
  // default) stays out of the URL. Filter resets ride the filter's own history entry (replace)
  // and batch with the filter write — react-router 8 does not queue same-tick param writes.
  const { values, setFilter, setFilters, clear } = useUrlFilters(['q', 'status', 'due', 'page', 'project']);
  const statusFilter = values.status as IncidentStatus | '';
  const search = values.q;
  const overdueOnly = values.due === 'overdue';
  const page = Math.max(1, Number.parseInt(values.page || '1', 10) || 1);
  const setPage = (next: number, options?: { replace?: boolean }) =>
    setFilter('page', next > 1 ? String(next) : '', options);

  const { list, allTotal } = useIncidentsPage({
    page,
    pageSize: INCIDENTS_PAGE_SIZE,
    status: statusFilter || undefined,
    search: search.trim() || undefined,
    overdue: overdueOnly || undefined,
    projectId: values.project || undefined,
  });
  const { data, isPending, isError, refetch } = list;
  const rows = data?.rows;
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / INCIDENTS_PAGE_SIZE));
  // Deleting the last row of the last page leaves an empty page behind: step back (a correction,
  // not a choice — it replaces so Back keeps the page the user actually came from). setPage's
  // identity changes every render by design (URL-backed filter setters are render-local); the
  // guard stops the write once page ≤ lastPage, so a per-render re-run is harmless.
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setPage's identity changes every render by design (URL-backed filter setters are render-local); the guard stops the write once page ≤ lastPage, so a per-render re-run is harmless.
  }, [data, page, lastPage]);

  // Modal: null = closed; { incident: null } = create; { incident } = edit.
  const [formTarget, setFormTarget] = useState<{ incident: IncidentRow | null } | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<TransitionTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IncidentRow | null>(null);

  // ANY member may file (reporter server-stamped). Manager-only investigate/close + edit.
  const canCreate = may('create', 'incident');
  const canEdit = may('edit', 'incident');
  const canTransition = may('transition', 'incidentClose');
  const canDelete = may('delete', 'incident');
  const canRowWrite = canEdit || canTransition || canDelete;

  // ── States ──────────────────────────────────────────────────────────────
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : allTotal === 0
        ? 'empty'
        : undefined;

  const columns: Column<IncidentRow>[] = [
    {
      key: 'type',
      header: t('col.incident', 'Incident'),
      cell: (i) => (
        <span className="truncate font-semibold" title={i.description ?? i.type}>
          {i.type}
        </span>
      ),
      exportValue: (i) => i.type,
    },
    {
      key: 'severity',
      header: t('col.severity', 'Severity'),
      cell: (i) => <StatusPill variant={severityVariant(i.severity)}>{severityLabel(t, i.severity)}</StatusPill>,
      exportValue: (i) => i.severity,
    },
    {
      key: 'status',
      header: t('col.status', 'Status'),
      cell: (i) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill record="incident" state={i.status} />
          {isIncidentOverdue(i) && <StatusPill variant="lost">{t('overdue', 'Overdue')}</StatusPill>}
        </span>
      ),
      exportValue: (i) => i.status,
    },
    {
      key: 'assignee',
      header: t('col.assignee', 'Person in charge'),
      cell: (i) => <span className="truncate text-muted-foreground">{i.assignee_id ? assigneeOptions?.find((o) => o.value === i.assignee_id)?.label ?? '…' : '—'}</span>,
      exportValue: (i) => assigneeOptions?.find((o) => o.value === i.assignee_id)?.label ?? '',
      colClassName: 'hidden md:table-cell',
    },
    {
      key: 'incident_date',
      header: t('col.date', 'Date'),
      kind: 'date',
      cell: (i) => <span className="tabular text-muted-foreground">{formatDay(i.incident_date)}</span>,
      exportValue: (i) => i.incident_date,
      colClassName: 'hidden sm:table-cell',
    },
    {
      key: 'location',
      header: t('col.location', 'Location'),
      cell: (i) => (
        <span className="truncate text-muted-foreground" title={i.location ?? ''}>
          {i.location || '—'}
        </span>
      ),
      exportValue: (i) => i.location ?? '',
      colClassName: 'hidden lg:table-cell',
    },
  ];

  const rowMenu = (i: IncidentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    const next = NEXT_STATUS[i.status];
    if (canTransition && next) {
      items.push({
        label: getTransitionCopy(t, next).menu,
        // A High or Critical issue closes with a photo: open its page, where the close form takes one.
        onClick: () => (next === 'Closed' && needsCloseProof(i.severity) ? navigate(`/incidents/${i.id}`) : setTransitionTarget({ incident: i, to: next })),
      });
    }
    if (canEdit) items.push({ label: t('action.edit', 'Edit'), onClick: () => setFormTarget({ incident: i }) });
    if (canDelete) items.push({ label: t('action.delete', 'Delete'), onClick: () => setDeleteTarget(i), danger: true });
    return items;
  };

  // A row only carries a menu when THIS row has at least one permitted action;
  // a Closed incident for a non-Admin manager has none → no empty `⋯`.
  const rowMenuOrNone = (i: IncidentRow): RowMenuItem[] | undefined => {
    const items = rowMenu(i);
    return items.length ? items : undefined;
  };

  const onTransitionConfirm = async () => {
    if (!transitionTarget) return;
    const { incident, to } = transitionTarget;
    try {
      await transition.mutateAsync({ id: incident.id, status: to });
      toast(
        to === 'Closed' ? t('toast.closed', 'Incident closed') : t('toast.started', 'Investigation started'),
        incident.type,
        'success',
      );
      setTransitionTarget(null);
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
      toast(t('toast.deleted', 'Incident deleted'), target.type, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  const transitionCopy = transitionTarget ? getTransitionCopy(t, transitionTarget.to) : null;

  const filters: FilterBarFilter[] = useMemo(() => [
    {
      key: 'status',
      label: t('filterByStatus', 'Filter by status'),
      kind: 'segment',
      semantics: 'tabs',
      options: ['Open', 'Investigating', 'Closed'].map((s) => ({
        value: s,
        label: statusLabel('incident', s as IncidentStatus, tStatus),
      })),
    },
    {
      key: 'due',
      label: t('filterByDue', 'Filter by due time'),
      kind: 'segment',
      semantics: 'toggle',
      options: [{ value: 'overdue', label: t('overdue', 'Overdue') }],
    },
  ], [tStatus, t]);

  const handleFilterChange = (key: string, value: string) => {
    // One batched write (react-router 8 does not queue same-tick setSearchParams calls): the
    // new filter value pushes its own history entry and the reset to page 1 rides along.
    setFilters({ [key]: value, page: '' });
    if (key === 'status') {
      trackFilterApplied('status', STATUS_FILTERS.length, 'incidents');
    }
  };

  return (
    <ListPage
      title={t('title', 'Incidents')}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ incident: null })}>
            <Icon name="plus" />
            {t('file', 'File incident')}
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          <FilterBar
            searchKey="q"
            searchLabel={t('search', 'Search incidents')}
            // search_used analytics (2026-07-13 wiring plan): c002a54a4's FilterBar adoption
            // dropped these two props; restored so the incidents search reports again.
            searchSurface="incidents-list"
            module="incidents"
            filters={filters}
            values={values}
            onChange={handleFilterChange}
            onClear={() => {
              // clear() removes every URL key including `page`, so the reset is implied.
              clear();
            }}
            shown={data ? total : 0}
            total={data ? (allTotal ?? total) : 0}
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          // #1991: the page holds ONE server page; Export still delivers EVERY incident matching
          // the current status/search, read at click time.
          <ExportAllButton
            entity="Incidents"
            columns={columns}
            hasRows={total > 0}
            fetchRows={() => exportAll.mutateAsync({ status: statusFilter || undefined, search: search.trim() || undefined, overdue: overdueOnly || undefined, projectId: values.project || undefined })}
          />
        )
      }
    >
      {values.project && (
        <div className="mb-4 flex items-center justify-between gap-3 text-control">
          <span>{t('projectScope', 'Project incidents')}</span>
          <Button variant="ghost" size="sm" onClick={() => setFilters({ project: '', page: '' })}>
            {t('allIncidents', 'All incidents')}
          </Button>
        </div>
      )}
      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={5} rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('error.title', "Couldn't load incidents")}
          sub={t('error.sub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="alert"
          title={t('empty.title', 'No incidents reported')}
          sub={t('empty.sub', 'When something goes wrong on a project or site, file it here so it can be investigated and closed out.')}
          stateId="incidents-empty"
          role={realRole ?? undefined}
          module="incidents"
          action={
            canCreate
              ? { label: t('file', 'File incident'), onClick: () => setFormTarget({ incident: null }) }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<IncidentRow>
          rows={rows ?? []}
          columns={columns}
          rowKey={(i) => i.id}
          // CW-4a: rows now OPEN the routable `/incidents/:id` detail page (they were inert — a
          // functional dead-end). Create/edit-in-modal are unchanged; only the row-open behavior
          // is added. RLS scopes which records the detail page can read.
          onActivate={(i) => navigate(`/incidents/${i.id}`)}
          rowHref={(i) => `/incidents/${i.id}`}
          rowLabel={(i) => t('openRow', 'Open {{type}}', { type: i.type })}
          rowMenu={canRowWrite ? rowMenuOrNone : undefined}
          state={(rows ?? []).length === 0 ? 'empty' : undefined}
          emptyTitle={t('empty.noMatchTitle', 'No incidents match your filters')}
          emptySub={t('empty.noMatchSub', 'Try a different status or clear the search.')}
          emptyAction={{ label: t('action.clearFilters', 'Clear filters'), onClick: () => clear() }}
        tableId="incidents-table" />
      )}

      {state === undefined && total > INCIDENTS_PAGE_SIZE && (
        <nav aria-label={t('pager.label', 'Pages')} className="mt-3 flex items-center justify-between gap-3 text-control tabular-nums">
          <span>{t('pager.range', '{{from}}–{{to}} of {{total}}', { from: (page - 1) * INCIDENTS_PAGE_SIZE + 1, to: Math.min(page * INCIDENTS_PAGE_SIZE, total), total })}</span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t('pager.prev', 'Previous page')}>
              <Icon name="back" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)} aria-label={t('pager.next', 'Next page')}>
              <Icon name="chev" aria-hidden="true" />
            </Button>
          </span>
        </nav>
      )}

      {/* File / edit incident modal */}
      {formTarget && (
        <IncidentFormModal
          incident={formTarget.incident}
          defaultProjectId={values.project || undefined}
          onClose={() => setFormTarget(null)}
          onCreate={(input) => create.mutateAsync(input)}
          onCreated={(_row, input) => {
            toast(t('toast.filed', 'Incident filed'), input.type, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('toast.updated', 'Incident updated'), input.type, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Status transition confirm (default tone — a state-machine move, not destructive) */}
      <ConfirmDialog
        open={!!transitionTarget}
        tone="default"
        title={
          transitionTarget && transitionCopy
            ? transitionCopy.title(transitionTarget.incident.type)
            : t('transition.advance', 'Advance incident?')
        }
        description={transitionCopy?.body ?? ''}
        confirmLabel={transitionCopy?.confirm ?? t('transition.confirm', 'Confirm')}
        loading={transition.isPending}
        onConfirm={onTransitionConfirm}
        onCancel={() => setTransitionTarget(null)}
      />

      {/* Delete confirm (destructive tone) */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? t('delete.title', 'Delete {{type}}?', { type: deleteTarget.type }) : t('delete.titleFallback', 'Delete incident?')}
        description={t('delete.body', "This permanently removes the incident report. This can't be undone; consider closing it instead to keep the audit trail.")}
        confirmLabel={t('delete.confirm', 'Delete incident')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

export default Incidents;
