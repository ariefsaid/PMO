import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ListPage,
  MobileToolbarDisclosure,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  useToast,
  Button,
  Icon,
  SelectField,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIncidents, useIncidentMutations } from '@/src/hooks/useIncidents';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { IncidentRow, IncidentStatus } from '@/src/lib/db/incidents';
import { severityVariant, workflowVariant } from '@/src/lib/status/statusVariants';
import { NEXT_STATUS, type AdvanceStatus } from '@/src/lib/incidents/transitions';
import { formatDateOnly } from '@/src/lib/format';
import { useProjects } from '@/src/hooks/useProjects';
import { IncidentFormModal } from '@/components/IncidentFormModal';

/** Status filter segments: All + the three incident_status enum values. */
type StatusFilter = 'All' | IncidentStatus;
const STATUS_FILTERS: StatusFilter[] = ['All', 'Open', 'Investigating', 'Closed'];
type SeverityFilter = 'All' | IncidentRow['severity'];
const SEVERITY_FILTERS: SeverityFilter[] = ['All', 'Critical', 'High', 'Medium', 'Low'];
type IncidentSort = 'priority' | 'date';
const SEVERITY_RANK: Record<IncidentRow['severity'], number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

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
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useIncidents();
  const { data: projects } = useProjects();
  const projectNames = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project.name])), [projects]);
  const { create, update, transition, remove } = useIncidentMutations();

  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const rawStatus = searchParams.get('status') as StatusFilter | null;
  const filter = rawStatus && STATUS_FILTERS.includes(rawStatus) ? rawStatus : 'All';
  const rawSeverity = searchParams.get('severity') as SeverityFilter | null;
  const severity = rawSeverity && SEVERITY_FILTERS.includes(rawSeverity) ? rawSeverity : 'All';
  const rawSort = searchParams.get('sort') as IncidentSort | null;
  const sort = rawSort === 'date' ? rawSort : 'priority';

  const setFilterParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ['q', 'status', 'severity'].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

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
      .filter((i) => severity === 'All' || i.severity === severity)
      .filter(
        (i) =>
          !q ||
          i.type.toLowerCase().includes(q) ||
          (i.location ?? '').toLowerCase().includes(q) ||
          (i.description ?? '').toLowerCase().includes(q),
      );
  }, [all, search, filter, severity]);

  const statusLabels: Record<StatusFilter, string> = {
    All: t('work:incidents.status.all', 'All'),
    Open: t('work:incidents.status.open', 'Open'),
    Investigating: t('work:incidents.status.investigating', 'Investigating'),
    Closed: t('work:incidents.status.closed', 'Closed'),
  };
  const severityLabels: Record<SeverityFilter, string> = {
    All: t('work:incidents.severity.all', 'All severities'),
    Critical: t('work:incidents.severity.critical', 'Critical'),
    High: t('work:incidents.severity.high', 'High'),
    Medium: t('work:incidents.severity.medium', 'Medium'),
    Low: t('work:incidents.severity.low', 'Low'),
  };
  const transitionCopyFor = (to: AdvanceStatus, type: string) => {
    const key = to === 'Closed' ? 'closed' : 'investigating';
    const defaults = to === 'Closed'
      ? {
          menu: 'Close incident',
          title: 'Close {{type}}?',
          body: 'This marks the incident Closed. Closed is the final state; reopen by filing a follow-up if new information emerges.',
          confirm: 'Close incident',
        }
      : {
          menu: 'Start investigating',
          title: 'Start investigating {{type}}?',
          body: 'This moves the incident to Investigating so the team can record findings. You can close it once the investigation is complete.',
          confirm: 'Start investigating',
        };
    return {
      menu: t(`incidents.detail.transition.${key}.menu`, defaults.menu),
      title: t(`incidents.detail.transition.${key}.title`, defaults.title, { type }),
      body: t(`incidents.detail.transition.${key}.body`, defaults.body),
      confirm: t(`incidents.detail.transition.${key}.confirm`, defaults.confirm),
    };
  };

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const activeA = a.status === 'Closed' ? 1 : 0;
    const activeB = b.status === 'Closed' ? 1 : 0;
    if (activeA !== activeB) return activeA - activeB;
    if (sort === 'priority' && SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    const byDate = b.incident_date.localeCompare(a.incident_date);
    return byDate || a.id.localeCompare(b.id);
  }), [filtered, sort]);

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
      header: t('work:incidents.columns.incident', 'Incident'),
      cell: (i) => (
        <span className="break-words font-semibold">
          {i.type}
        </span>
      ),
      exportValue: (i) => i.type,
    },
    {
      key: 'project',
      header: t('work:incidents.columns.project', 'Project'),
      cell: (i) => i.project_id
        ? <Link className="block whitespace-normal break-words font-medium text-foreground hover:underline" to={`/projects/${i.project_id}`}>{projectNames.get(i.project_id) ?? t('work:incidents.projectUnavailable', 'Project unavailable')}</Link>
        : <span className="text-muted-foreground">{t('work:incidents.unlinked', 'Unlinked')}</span>,
      exportValue: (i) => i.project_id ?? '',
    },
    {
      key: 'severity',
      header: t('work:incidents.columns.severity', 'Severity'),
      cell: (i) => <StatusPill variant={severityVariant(i.severity)}>{severityLabels[i.severity]}</StatusPill>,
      exportValue: (i) => i.severity,
    },
    {
      key: 'status',
      header: t('work:incidents.columns.status', 'Status'),
      cell: (i) => <StatusPill variant={workflowVariant(i.status)}>{statusLabels[i.status]}</StatusPill>,
      exportValue: (i) => i.status,
    },
    {
      key: 'incident_date',
      header: t('work:incidents.columns.date', 'Date'),
      cell: (i) => <span className="tabular text-muted-foreground">{formatDateOnly(i.incident_date)}</span>,
      exportValue: (i) => i.incident_date,
    },
    {
      key: 'location',
      header: t('work:incidents.columns.location', 'Location'),
      cell: (i) => (
        <details className="group">
          <summary className="min-h-11 cursor-pointer break-words font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t('work:incidents.rowDetails', 'More details')}
          </summary>
          <span className="block break-words text-muted-foreground">
            {i.location || t('work:incidents.notRecorded', 'Not recorded')}
          </span>
        </details>
      ),
      exportValue: (i) => i.location ?? '',
      colClassName: 'hidden lg:table-cell',
    },
  ];

  const mobileColumns: Column<IncidentRow>[] = [{
    ...columns[0],
    cell: (incident) => (
      <div className="space-y-2">
        <Link className="block min-h-11 break-words text-xl font-bold text-foreground hover:underline" to={`/incidents/${incident.id}`}>{incident.type}</Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusPill variant={severityVariant(incident.severity)}>{severityLabels[incident.severity]}</StatusPill>
          <StatusPill variant={workflowVariant(incident.status)}>{statusLabels[incident.status]}</StatusPill>
          <span className="text-sm font-normal tabular text-muted-foreground">{formatDateOnly(incident.incident_date)}</span>
        </div>
        {incident.project_id ? (
          <Link className="block break-words text-sm font-normal text-primary-text hover:underline" to={`/projects/${incident.project_id}`}>
            {projectNames.get(incident.project_id) ?? t('work:incidents.projectUnavailable', 'Project unavailable')}
          </Link>
        ) : <span className="block text-sm font-normal text-muted-foreground">{t('work:incidents.unlinked', 'Unlinked')}</span>}
        <details>
          <summary className="min-h-11 text-xs font-semibold">{t('work:incidents.rowDetails', 'More details')}</summary>
          <p className="break-words text-sm font-normal text-muted-foreground">{incident.location || t('work:incidents.notRecorded', 'Not recorded')}</p>
        </details>
      </div>
    ),
  }];

  const rowMenu = (i: IncidentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    const next = NEXT_STATUS[i.status];
    if (canTransition && next) {
      items.push({
        label: transitionCopyFor(next, i.type).menu,
        onClick: () => setTransitionTarget({ incident: i, to: next }),
      });
    }
    if (canEdit) items.push({ label: t('work:incidents.actions.edit', 'Edit'), onClick: () => setFormTarget({ incident: i }) });
    if (canDelete) items.push({ label: t('work:incidents.actions.delete', 'Delete'), onClick: () => setDeleteTarget(i), danger: true });
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
        to === 'Closed'
          ? t('work:incidents.detail.toast.closed', 'Incident closed')
          : t('work:incidents.detail.toast.investigating', 'Investigation started'),
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
      toast(t('work:incidents.detail.toast.deleted', 'Incident deleted'), target.type, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  const transitionCopy = transitionTarget ? transitionCopyFor(transitionTarget.to, transitionTarget.incident.type) : null;

  return (
    <ListPage
      title={t('work:incidents.title', 'Incidents')}
      description={t('work:incidents.description', 'Organization incident register for reporting, investigation and closure.')}
      filters={
        state !== 'loading' && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchMini
              placeholder={t('work:incidents.search.placeholder', 'Search incidents…')}
              aria-label={t('work:incidents.search.ariaLabel', 'Search incidents')}
              value={search}
              onChange={(e) => setFilterParam('q', e.target.value, '')}
              searchSurface="incidents-list"
              module="incidents"
              resultCount={sorted.length}
              className="min-h-11"
              containerClassName="min-h-11 w-full min-w-0 sm:w-auto sm:min-w-[220px]"
            />
            <div className="min-w-0">
              <ViewToggle<StatusFilter>
                className="max-w-full flex-wrap"
                options={STATUS_FILTERS.map((value) => ({ value, label: statusLabels[value] }))}
                value={filter}
                onChange={(value) => {
                  setFilterParam('status', value, 'All');
                  trackFilterApplied('status', STATUS_FILTERS.length, 'incidents');
                }}
                ariaLabel={t('work:incidents.filters.status', 'Filter by status')}
              />
            </div>
            <SelectField
              label={t('work:incidents.filters.severity', 'Filter by severity')}
              hideLabel
              value={severity}
              onChange={(value) => setFilterParam('severity', value, 'All')}
              options={SEVERITY_FILTERS.map((value) => ({ value, label: severityLabels[value] }))}
            className="min-h-11 min-w-[150px] sm:min-h-8"
            />
            <SelectField
              label={t('work:incidents.filters.sort', 'Sort incidents')}
              hideLabel
              value={sort}
              onChange={(value) => setFilterParam('sort', value, 'priority')}
              options={[
                { value: 'priority', label: t('work:incidents.sort.priority', 'Severity first') },
                { value: 'date', label: t('work:incidents.sort.date', 'Newest first') },
              ]}
              className="min-h-11 min-w-[150px] sm:min-h-8"
            />
            <MobileToolbarDisclosure label={t('work:incidents.moreActions', 'More')} className="sm:hidden">
              <ExportButton rows={sorted} columns={columns} entity="Incidents" className="w-full justify-start" />
            </MobileToolbarDisclosure>
            <div className="hidden sm:block"><ExportButton rows={sorted} columns={columns} entity="Incidents" /></div>
            {canCreate && (
              <Button
                variant="primary"
                className="touch-target h-8"
                onClick={() => setFormTarget({ incident: null })}
              >
                <Icon name="plus" />
                {t('work:incidents.actions.file', 'File incident')}
              </Button>
            )}
          </div>
        )
      }
    >
      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('work:incidents.states.errorTitle', "Couldn't load incidents")}
          sub={t('work:incidents.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="alert"
          title={t('work:incidents.states.emptyTitle', 'No incidents reported')}
          sub={t('work:incidents.states.emptySub', 'When something goes wrong on a project or site, file it here so it can be investigated and closed out.')}
          stateId="incidents-empty"
          role={realRole ?? undefined}
          module="incidents"
          action={
            canCreate
              ? { label: t('work:incidents.actions.file', 'File incident'), onClick: () => setFormTarget({ incident: null }) }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<IncidentRow>
          rows={sorted}
          columns={isDesktop ? columns : mobileColumns}
          rowKey={(i) => i.id}
          // CW-4a: rows now OPEN the routable `/incidents/:id` detail page (they were inert — a
          // functional dead-end). Create/edit-in-modal are unchanged; only the row-open behavior
          // is added. RLS scopes which records the detail page can read.
          onActivate={(i) => navigate(`/incidents/${i.id}`)}
          rowLabel={isDesktop ? (i) => t('work:incidents.detail.rowOpen', 'Open {{type}}', { type: i.type }) : undefined}
          rowMenu={canRowWrite ? rowMenuOrNone : undefined}
          state={sorted.length === 0 ? 'empty' : undefined}
          emptyTitle={t('work:incidents.table.emptyTitle', 'No incidents match')}
          emptySub={t('work:incidents.table.emptySub', 'Try a different severity, status or search.')}
          emptyAction={{ label: t('work:incidents.table.clearFilters', 'Clear filters'), onClick: clearFilters }}
        tableId="incidents-table" />
      )}

      {/* File / edit incident modal */}
      {formTarget && (
        <IncidentFormModal
          incident={formTarget.incident}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast(t('work:incidents.detail.toast.filed', 'Incident filed'), input.type, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('work:incidents.detail.toast.updated', 'Incident updated'), input.type, 'success');
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
            ? transitionCopy.title
            : t('work:incidents.detail.confirmFallbackTitle', 'Advance incident?')
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
        title={deleteTarget
          ? t('work:incidents.detail.deleteTitle', 'Delete {{type}}?', { type: deleteTarget.type })
          : t('work:incidents.detail.deleteFallbackTitle', 'Delete incident?')}
        description={t('work:incidents.detail.deleteDescription', "This permanently removes the incident report. This can't be undone; consider closing it instead to keep the audit trail.")}
        confirmLabel={t('work:incidents.detail.deleteConfirm', 'Delete incident')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

export default Incidents;
