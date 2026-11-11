import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportAllButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIncidentsPage, useIncidentsExportAll, useIncidentMutations } from '@/src/hooks/useIncidents';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { INCIDENTS_PAGE_SIZE, type IncidentRow, type IncidentStatus } from '@/src/lib/db/incidents';
import { formatDay } from '@/src/lib/format';
import { severityVariant } from '@/src/lib/status/statusVariants';
import { statusLabel } from '@/src/lib/status/statusMap';
import { NEXT_STATUS, TRANSITION_COPY, type AdvanceStatus } from '@/src/lib/incidents/transitions';
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
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { create, update, transition, remove } = useIncidentMutations();
  const exportAll = useIncidentsExportAll();

  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('All');
  const [page, setPage] = useState(1);

  // Search is applied 300 ms after the last keystroke; a new term or status starts at page 1.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(typed.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const { list, allTotal } = useIncidentsPage({
    page,
    pageSize: INCIDENTS_PAGE_SIZE,
    status: filter === 'All' ? undefined : filter,
    search: search || undefined,
  });
  const { data, isPending, isError, refetch } = list;
  const rows = data?.rows;
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / INCIDENTS_PAGE_SIZE));
  // Deleting the last row of the last page leaves an empty page behind: step back.
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
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
      header: 'Incident',
      cell: (i) => (
        <span className="truncate font-semibold" title={i.description ?? i.type}>
          {i.type}
        </span>
      ),
      exportValue: (i) => i.type,
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (i) => <StatusPill variant={severityVariant(i.severity)}>{i.severity}</StatusPill>,
      exportValue: (i) => i.severity,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => <StatusPill record="incident" state={i.status} />,
      exportValue: (i) => i.status,
    },
    {
      key: 'incident_date',
      header: 'Date',
      kind: 'date',
      cell: (i) => <span className="tabular text-muted-foreground">{formatDay(i.incident_date)}</span>,
      exportValue: (i) => i.incident_date,
      colClassName: 'hidden sm:table-cell',
    },
    {
      key: 'location',
      header: 'Location',
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
        label: TRANSITION_COPY[next].menu,
        onClick: () => setTransitionTarget({ incident: i, to: next }),
      });
    }
    if (canEdit) items.push({ label: 'Edit', onClick: () => setFormTarget({ incident: i }) });
    if (canDelete) items.push({ label: 'Delete', onClick: () => setDeleteTarget(i), danger: true });
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
        to === 'Closed' ? 'Incident closed' : 'Investigation started',
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
      toast('Incident deleted', target.type, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  const transitionCopy = transitionTarget ? TRANSITION_COPY[transitionTarget.to] : null;

  return (
    <ListPage
      title="Incidents"
      count={data ? total : undefined}
      total={data ? allTotal : undefined}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ incident: null })}>
            <Icon name="plus" />
            File incident
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          /* At phone width, wrap the full set into rows so every status stays visible without a sideways gesture. */
          <div data-testid="status-filter-scroll" className="min-w-0 max-w-full">
            <ViewToggle<StatusFilter>
              options={STATUS_FILTERS.map((f) => ({ value: f, label: f === 'All' ? 'All' : statusLabel('incident', f, tStatus) }))}
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
                trackFilterApplied('status', STATUS_FILTERS.length, 'incidents');
              }}
              ariaLabel="Filter by status"
              className="w-full flex-wrap"
            />
          </div>
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder="Search incidents…"
            aria-label="Search incidents"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            searchSurface="incidents-list"
            module="incidents"
            resultCount={total}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
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
            fetchRows={() => exportAll.mutateAsync({ status: filter === 'All' ? undefined : filter, search: search || undefined })}
          />
        )
      }
    >
      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" shape="table" columns={5} rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load incidents"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="alert"
          title="No incidents reported"
          sub="When something goes wrong on a project or site, file it here so it can be investigated and closed out."
          stateId="incidents-empty"
          role={realRole ?? undefined}
          module="incidents"
          action={
            canCreate
              ? { label: 'File incident', onClick: () => setFormTarget({ incident: null }) }
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
          rowLabel={(i) => `Open ${i.type}`}
          rowMenu={canRowWrite ? rowMenuOrNone : undefined}
          state={(rows ?? []).length === 0 ? 'empty' : undefined}
          emptyTitle="No incidents match your filters"
          emptySub="Try a different status or clear the search."
        tableId="incidents-table" />
      )}

      {state === undefined && total > INCIDENTS_PAGE_SIZE && (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3 text-control tabular-nums">
          <span>{(page - 1) * INCIDENTS_PAGE_SIZE + 1}–{Math.min(page * INCIDENTS_PAGE_SIZE, total)} of {total}</span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <Icon name="back" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <Icon name="chev" aria-hidden="true" />
            </Button>
          </span>
        </nav>
      )}

      {/* File / edit incident modal */}
      {formTarget && (
        <IncidentFormModal
          incident={formTarget.incident}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast('Incident filed', input.type, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast('Incident updated', input.type, 'success');
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
            : 'Advance incident?'
        }
        description={transitionCopy?.body ?? ''}
        confirmLabel={transitionCopy?.confirm ?? 'Confirm'}
        loading={transition.isPending}
        onConfirm={onTransitionConfirm}
        onCancel={() => setTransitionTarget(null)}
      />

      {/* Delete confirm (destructive tone) */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.type}?` : 'Delete incident?'}
        description="This permanently removes the incident report. This can't be undone; consider closing it instead to keep the audit trail."
        confirmLabel="Delete incident"
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

export default Incidents;
