import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIncidents, useIncidentMutations } from '@/src/hooks/useIncidents';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type {
  IncidentRow,
  IncidentSeverity,
  IncidentStatus,
  IncidentInput,
} from '@/src/lib/db/incidents';

/** Status filter segments: All + the three incident_status enum values. */
type StatusFilter = 'All' | IncidentStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Open', 'Investigating', 'Closed'];

/**
 * Severity → tinted pill. Four DISTINCT treatments that read apart by hue AND
 * label (never color-only): Low = quiet neutral; Medium = informational blue
 * (`open`); High = amber `warn`; Critical = the red `lost` tint. Each carries a
 * darkened-AA text + leading dot from the shared StatusPill tokens. Severity is
 * non-interactive categorization, so the warn/destructive tints are sanctioned
 * here (no solid fill behind body text).
 */
const SEVERITY_PILL: Record<IncidentSeverity, StatusVariant> = {
  Low: 'neutral',
  Medium: 'open',
  High: 'warn',
  Critical: 'lost',
};

/**
 * Workflow status → tinted pill: Open = blue `open`; Investigating = quiet
 * in-flight `progress`; Closed = neutral (terminal, de-emphasised).
 */
const STATUS_PILL: Record<IncidentStatus, StatusVariant> = {
  Open: 'open',
  Investigating: 'progress',
  Closed: 'neutral',
};

const SEVERITY_OPTIONS = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Critical', label: 'Critical' },
];

/** A status the workflow can transition TO (Open is only an initial state). */
type AdvanceStatus = 'Investigating' | 'Closed';

/** The next workflow step for a status (Closed is terminal → null). */
const NEXT_STATUS: Record<IncidentStatus, AdvanceStatus | null> = {
  Open: 'Investigating',
  Investigating: 'Closed',
  Closed: null,
};

/** Human verb-object label + confirm copy for a status transition. */
const TRANSITION_COPY: Record<
  'Investigating' | 'Closed',
  { menu: string; confirm: string; title: (t: string) => string; body: string }
> = {
  Investigating: {
    menu: 'Start investigating',
    confirm: 'Start investigating',
    title: (t) => `Start investigating ${t}?`,
    body: 'This moves the incident to Investigating so the team can record findings. You can close it once the investigation is complete.',
  },
  Closed: {
    menu: 'Close incident',
    confirm: 'Close incident',
    title: (t) => `Close ${t}?`,
    body: 'This marks the incident Closed. Closed is the final state; reopen by filing a follow-up if new information emerges.',
  },
};

interface FormValues {
  incident_date: string;
  type: string;
  severity: IncidentSeverity;
  location: string;
  description: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.incident_date.trim()) errors.incident_date = 'Incident date is required.';
  if (!v.type.trim()) errors.type = 'Incident type is required.';
  return errors;
};

/** Pending status transition (drives the confirm dialog). */
interface TransitionTarget {
  incident: IncidentRow;
  to: AdvanceStatus;
}

const Incidents: React.FC = () => {
  const may = usePermission();
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
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (i) => <StatusPill variant={SEVERITY_PILL[i.severity]}>{i.severity}</StatusPill>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => <StatusPill variant={STATUS_PILL[i.status]}>{i.status}</StatusPill>,
    },
    {
      key: 'incident_date',
      header: 'Date',
      cell: (i) => <span className="tabular text-muted-foreground">{i.incident_date}</span>,
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

// ── File / edit incident form modal ─────────────────────────────────────────

/**
 * Today as a LOCAL-date `YYYY-MM-DD` string (the <input type="date"> value format,
 * matching the `date` — not timestamptz — column). Built from local
 * getFullYear/getMonth/getDate to avoid the UTC-midnight off-by-one that
 * `toISOString().slice(0,10)` would introduce in negative-UTC-offset zones.
 */
function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface IncidentFormModalProps {
  incident: IncidentRow | null;
  onClose: () => void;
  onCreate: (input: IncidentInput) => Promise<void>;
  onUpdate: (id: string, input: IncidentInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const IncidentFormModal: React.FC<IncidentFormModalProps> = ({
  incident,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const isEdit = !!incident;
  const form = useEntityForm<FormValues>({
    initialValues: {
      // AC-W6-IXD-INCDATE (B-5): the dominant case is filing a same-day incident, so the
      // create form defaults the date to TODAY. Built from local getFullYear/Month/Date
      // (NOT toISOString, which is UTC and off-by-one near midnight) to match the `date`
      // (not timestamptz) column. Edit keeps the stored value.
      incident_date: incident?.incident_date ?? todayLocalISO(),
      type: incident?.type ?? '',
      severity: incident?.severity ?? 'Low',
      location: incident?.location ?? '',
      description: incident?.description ?? '',
    },
    validate,
    idPrefix: 'incident-form',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required date + type are present.
    requiredFields: ['incident_date', 'type'],
  });

  const dateField = form.fieldProps('incident_date');
  const typeField = form.fieldProps('type');
  const severityField = form.fieldProps('severity');
  const locationField = form.fieldProps('location');
  const descriptionField = form.fieldProps('description');

  const errorSummary = [
    form.errors.incident_date ? { fieldId: dateField.id, message: form.errors.incident_date } : null,
    form.errors.type ? { fieldId: typeField.id, message: form.errors.type } : null,
  ].filter((x): x is { fieldId: string; message: string } => x !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: IncidentInput = {
        incident_date: values.incident_date,
        type: values.type.trim(),
        severity: values.severity,
        location: values.location.trim() || undefined,
        description: values.description.trim() || undefined,
      };
      try {
        if (isEdit && incident) await onUpdate(incident.id, input);
        else await onCreate(input);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit incident' : 'File incident'}
      subtitle={
        isEdit
          ? 'Update this incident report'
          : 'Record what happened. You will be stamped as the reporter.'
      }
      submitLabel={isEdit ? 'Save incident' : 'File incident'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend="What happened">
        <FormGrid>
          <TextField
            id={dateField.id}
            label="Date"
            type="date"
            required
            value={dateField.value}
            onChange={dateField.onChange}
            onBlur={dateField.onBlur}
            error={dateField.error}
          />
          <SelectField
            id={severityField.id}
            label="Severity"
            required
            value={severityField.value}
            onChange={(v) => severityField.onChange(v as IncidentSeverity)}
            onBlur={severityField.onBlur}
            options={SEVERITY_OPTIONS}
          />
          <TextField
            id={typeField.id}
            label="Type"
            required
            value={typeField.value}
            onChange={typeField.onChange}
            onBlur={typeField.onBlur}
            error={typeField.error}
            placeholder="e.g. Near Miss, Equipment Damage, Spill"
            fullWidth
          />
          <TextField
            id={locationField.id}
            label="Location"
            value={locationField.value}
            onChange={locationField.onChange}
            onBlur={locationField.onBlur}
            placeholder="e.g. Regional Site B"
            fullWidth
          />
          <TextArea
            id={descriptionField.id}
            label="Description"
            value={descriptionField.value}
            onChange={descriptionField.onChange}
            onBlur={descriptionField.onBlur}
            placeholder="What happened, who was involved, and any immediate action taken."
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default Incidents;
