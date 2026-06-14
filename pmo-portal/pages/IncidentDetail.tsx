import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  StatusPill,
  ListState,
  ConfirmDialog,
  RecordActionZone,
  Icon,
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useIncident, useIncidentMutations } from '@/src/hooks/useIncidents';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { severityVariant, workflowVariant } from '@/src/lib/status/statusVariants';
import { NEXT_STATUS, TRANSITION_COPY, type AdvanceStatus } from '@/src/lib/incidents/transitions';
import type { IncidentInput } from '@/src/lib/db/incidents';
import { formatDate } from '@/src/lib/format';
import { IncidentFormModal } from '@/components/IncidentFormModal';

/**
 * IncidentDetail — the routable `/incidents/:id` record page (CW-4a).
 *
 * Fixes the audit's "Incidents is a dead-end": an Engineer can File an incident, and now anyone
 * with read access can OPEN it to a real detail page to track and (managers) close it. Modeled on
 * the transactional record pattern (ProcurementDetails): the shared `RecordHeader` (page variant —
 * icon + type + severity/status pills via the CW-2 registry + the role-allowed header actions),
 * a `BackBar` "Back to Incidents", and read-only field sections with edit-in-modal. RLS is the
 * enforcement authority; `can()` (via `usePermission`) gates the affordances for clarity only.
 */
const IncidentDetail: React.FC = () => {
  const { incidentId } = useParams<{ incidentId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();

  const query = useIncident(incidentId);
  const { update, transition } = useIncidentMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [transitionTo, setTransitionTo] = useState<AdvanceStatus | null>(null);

  // Manager-only investigate/close + edit (FE clarity projection; the incident_reports RLS
  // role gate is the real authority — a non-manager attempt is rejected/hidden server-side).
  const canEdit = may('edit', 'incident');
  const canTransition = may('transition', 'incidentClose');

  const goBack = () => navigate('/incidents');

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label="Incidents" onBack={goBack} />
        <div data-testid="incident-loading">
          <ListState variant="loading" rows={5} />
        </div>
      </>
    );
  }

  // ── Error (a genuine transient failure — offer Retry) ─────────────────────
  if (query.isError) {
    return (
      <>
        <BackBar label="Incidents" onBack={goBack} />
        <ListState
          variant="error"
          title="Couldn't load incident"
          sub="Something went wrong fetching the incident report."
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  // ── Not found / no access — a calm empty state (RLS scoped it out, or a bad id) ──
  const incident = query.data;
  if (!incident) {
    return (
      <>
        <BackBar label="Incidents" onBack={goBack} />
        <div data-testid="incident-not-found">
          <ListState
            variant="empty"
            icon="alert"
            title="Incident not found"
            sub="This incident either doesn't exist or isn't visible to you. Return to the register to find it."
          />
        </div>
      </>
    );
  }

  const next = NEXT_STATUS[incident.status];
  const transitionCopy = transitionTo ? TRANSITION_COPY[transitionTo] : null;

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onTransitionConfirm = async () => {
    if (!transitionTo) return;
    try {
      await transition.mutateAsync({ id: incident.id, status: transitionTo });
      toast(
        transitionTo === 'Closed' ? 'Incident closed' : 'Investigation started',
        incident.type,
        'success',
      );
      setTransitionTo(null);
    } catch (err) {
      onMutationError(err);
    }
  };

  return (
    <div>
      {/* Mobile escape route — the top-bar breadcrumb owns desktop wayfinding, the rail
          collapses ≤920px so the BackBar is the only in-content escape there. */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label="Incidents" onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + type + severity/status pills (CW-2 registry) +
          the role-allowed header actions (Edit only; advance verbs go to RecordActionZone). */}
      <RecordHeader
        name={incident.type}
        iconColor="hsl(var(--primary))"
        icon={<Icon name="alert" />}
        status={
          <span className="flex items-center gap-2" data-testid="incident-pills" data-status={incident.status}>
            <StatusPill variant={severityVariant(incident.severity)}>{incident.severity}</StatusPill>
            <StatusPill variant={workflowVariant(incident.status)}>{incident.status}</StatusPill>
          </span>
        }
        meta={<span className="tabular">Reported {formatDate(incident.incident_date)}</span>}
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" data-testid="incident-edit" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          ) : undefined
        }
      />

      {/* RecordActionZone — advance/decide verb (DESIGN.md §7: advance verbs live here, not in the header).
          Sticky on desktop so the action is never below the fold. Only rendered when the user can transition
          AND a next state exists for this incident. */}
      {canTransition && next && (
        <RecordActionZone>
          <div className="flex flex-col gap-2 py-3">
            {/* Consistent zone chrome: a "Next action" label leads the verb, matching the
                procurement "Ready to advance" + pipeline "Next actions" record-action zones. */}
            <div className="text-[12px] font-semibold text-muted-foreground">Next action</div>
            <Button
              variant="primary"
              size="sm"
              data-testid="incident-advance"
              onClick={() => setTransitionTo(next)}
            >
              {TRANSITION_COPY[next].menu}
            </Button>
          </div>
        </RecordActionZone>
      )}

      {/* Body — the incident's fields (read-only; edit-in-modal). Shared Card primitives,
          DESIGN.md tokens (no raw hex). */}
      <Card className="mb-4">
        <CardHead>Incident detail</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Type" value={incident.type} />
            <Field label="Date" value={formatDate(incident.incident_date)} />
            <Field label="Severity" value={incident.severity} />
            <Field label="Status" value={incident.status} />
            <Field label="Location" value={incident.location || '—'} />
          </dl>
        </CardPad>
      </Card>

      <Card>
        <CardHead>Description</CardHead>
        <CardPad>
          {incident.description ? (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{incident.description}</p>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No description was recorded.</p>
          )}
        </CardPad>
      </Card>

      {/* Edit modal (managers only) — reuses the shared File/Edit form. */}
      {editOpen && (
        <IncidentFormModal
          incident={incident}
          onClose={() => setEditOpen(false)}
          // Create is unreachable from the detail page (incident is non-null); kept for the shared
          // contract.
          onCreate={async () => {}}
          onUpdate={async (id, input: IncidentInput) => {
            await update.mutateAsync({ id, input });
            toast('Incident updated', input.type, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Status transition confirm (default tone — a state-machine move, not destructive). */}
      <ConfirmDialog
        open={transitionTo !== null}
        tone="default"
        title={transitionCopy ? transitionCopy.title(incident.type) : 'Advance incident?'}
        description={transitionCopy?.body ?? ''}
        confirmLabel={transitionCopy?.confirm ?? 'Confirm'}
        loading={transition.isPending}
        onConfirm={onTransitionConfirm}
        onCancel={() => setTransitionTo(null)}
      />
    </div>
  );
};

/** A labelled read-only field (definition-list row) — body field primitive for the record page. */
const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {label}
    </dt>
    <dd className="text-[13.5px] text-foreground">{value}</dd>
  </div>
);

export default IncidentDetail;
