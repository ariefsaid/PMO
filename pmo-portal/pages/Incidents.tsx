import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Toolbar,
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
import { ExportButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useIncidents, useIncidentMutations } from '@/src/hooks/useIncidents';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { IncidentRow, IncidentStatus } from '@/src/lib/db/incidents';
import { severityVariant, workflowVariant } from '@/src/lib/status/statusVariants';
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
  const may = usePermission();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useIncidents();
  const { create, update, transition, remove } = useIncidentMutations();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('All');

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

  const all = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((i) => filter === 'All' || i.status === filter)
      .filter(
        (i) =>
          !q ||
          i.type.toLowerCase().includes(q) ||
          (i.location ?? '').toLowerCase().includes(q),
      );
  }, [all, search, filter]);

  // ── States ──────────────────────────────────────────────────────────────
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  const columns: Column<IncidentRow>[] = [
    {
      key: 'type',
      header: 'Incident',
      cell: (i) => (
        <span className="truncate font-semibold" title={i.type}>
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
      cell: (i) => <StatusPill variant={workflowVariant(i.status)}>{i.status}</StatusPill>,
      exportValue: (i) => i.status,
    },
    {
      key: 'incident_date',
      header: 'Date',
      cell: (i) => <span className="tabular text-muted-foreground">{i.incident_date}</span>,
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
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Incidents</h1>
          <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
            The organisation incident register. Anyone can file an incident; managers
            investigate and close them.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ incident: null })}>
            <Icon name="plus" />
            File incident
          </Button>
        )}
      </div>

      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          {/* AC-2: scrollable so all status segments are reachable at 390px. */}
          <div
            data-testid="status-filter-scroll"
            className="overflow-x-auto scroll-fade-x"
          >
            <ViewToggle<StatusFilter>
              options={STATUS_FILTERS.map((f) => ({ value: f, label: f }))}
              value={filter}
              onChange={setFilter}
              ariaLabel="Filter by status"
            />
          </div>
          <SearchMini
            placeholder="Search incidents…"
            aria-label="Search incidents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
          <ExportButton rows={filtered} columns={columns} entity="Incidents" />
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
          action={
            canCreate
              ? { label: 'File incident', onClick: () => setFormTarget({ incident: null }) }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<IncidentRow>
          rows={filtered}
          columns={columns}
          rowKey={(i) => i.id}
          // CW-4a: rows now OPEN the routable `/incidents/:id` detail page (they were inert — a
          // functional dead-end). Create/edit-in-modal are unchanged; only the row-open behavior
          // is added. RLS scopes which records the detail page can read.
          onActivate={(i) => navigate(`/incidents/${i.id}`)}
          rowLabel={(i) => `Open ${i.type}`}
          rowMenu={canRowWrite ? rowMenuOrNone : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No incidents match your filters"
          emptySub="Try a different status or clear the search."
        />
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
    </div>
  );
};

export default Incidents;
