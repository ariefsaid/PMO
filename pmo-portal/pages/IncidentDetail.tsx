import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
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
  ProjectNameLink,
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import WorkPageHeading from './WorkPageHeading';
import { usePermission } from '@/src/auth/usePermission';
import { useIncident, useIncidentMutations } from '@/src/hooks/useIncidents';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { severityVariant, workflowVariant } from '@/src/lib/status/statusVariants';
import { NEXT_STATUS, type AdvanceStatus } from '@/src/lib/incidents/transitions';
import type { IncidentInput } from '@/src/lib/db/incidents';
import { formatDateOnly } from '@/src/lib/format';
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
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();

  const query = useIncident(incidentId);
  const { update, transition } = useIncidentMutations();
  // Project FK options (cached, org-scoped) resolve the linked project's display name for the
  // click-to-open link (ADR-0028). org_id is never threaded — RLS scopes the list.
  const { data: projectOptions } = useProjectOptions();

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
        <BackBar label={t('work:incidents.title', 'Incidents')} phoneOnly onBack={goBack} />
        <WorkPageHeading title={t('work:incidents.detail.title', 'Incident')} scope={t('work:incidents.detail.scope', 'Incident report')} />
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
        <BackBar label={t('work:incidents.title', 'Incidents')} phoneOnly onBack={goBack} />
        <WorkPageHeading title={t('work:incidents.detail.title', 'Incident')} scope={t('work:incidents.detail.scope', 'Incident report')} />
        <ListState
          variant="error"
          title={t('work:incidents.detail.loadErrorTitle', "Couldn't load incident")}
          sub={t('work:incidents.detail.loadErrorSub', 'Something went wrong fetching the incident report.')}
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
        <BackBar label={t('work:incidents.title', 'Incidents')} phoneOnly onBack={goBack} />
        <WorkPageHeading title={t('work:incidents.detail.title', 'Incident')} scope={t('work:incidents.detail.scope', 'Incident report')} />
        <div data-testid="incident-not-found">
          <ListState
            variant="empty"
            icon="alert"
            title={t('work:incidents.detail.notFoundTitle', 'Incident not found')}
            sub={t('work:incidents.detail.notFoundSub', "This incident either doesn't exist or isn't visible to you. Return to the register to find it.")}
          />
        </div>
      </>
    );
  }

  const next = NEXT_STATUS[incident.status];
  const transitionKey = transitionTo === 'Closed' ? 'closed' : 'investigating';
  const transitionCopy = transitionTo ? {
    menu: t(`incidents.detail.transition.${transitionKey}.menu`, transitionTo === 'Closed' ? 'Close incident' : 'Start investigating'),
    confirm: t(`incidents.detail.transition.${transitionKey}.confirm`, transitionTo === 'Closed' ? 'Close incident' : 'Start investigating'),
    title: t(`incidents.detail.transition.${transitionKey}.title`, transitionTo === 'Closed' ? 'Close {{type}}?' : 'Start investigating {{type}}?', { type: incident.type }),
    body: t(`incidents.detail.transition.${transitionKey}.body`, transitionTo === 'Closed'
      ? 'This marks the incident Closed. Closed is the final state; reopen by filing a follow-up if new information emerges.'
      : 'This moves the incident to Investigating so the team can record findings. You can close it once the investigation is complete.'),
  } : null;

  // Resolve the linked project's name from the cached FK options (falls back to a generic
  // label until the list loads — the link still targets the correct /projects/:id).
  const linkedProjectName = incident.project_id
    ? projectOptions?.find((o) => o.value === incident.project_id)?.label ?? t('work:incidents.viewProject', 'View project')
    : null;
  const severityLabels = {
    Critical: t('work:incidents.severity.critical', 'Critical'),
    High: t('work:incidents.severity.high', 'High'),
    Medium: t('work:incidents.severity.medium', 'Medium'),
    Low: t('work:incidents.severity.low', 'Low'),
  };
  const statusLabels = {
    Open: t('work:incidents.status.open', 'Open'),
    Investigating: t('work:incidents.status.investigating', 'Investigating'),
    Closed: t('work:incidents.status.closed', 'Closed'),
  };

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onTransitionConfirm = async () => {
    if (!transitionTo) return;
    try {
      await transition.mutateAsync({ id: incident.id, status: transitionTo });
      toast(
        transitionTo === 'Closed'
          ? t('work:incidents.detail.toast.closed', 'Incident closed')
          : t('work:incidents.detail.toast.investigating', 'Investigation started'),
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
        <BackBar label={t('work:incidents.title', 'Incidents')} onBack={goBack} />
      </div>

      {/* Identity, date and project scope sit together above the incident evidence. */}
      <RecordHeader
        sharedPageHeading
        name={incident.type}
        iconColor="hsl(var(--muted-foreground))"
        icon={<Icon name="alert" />}
        status={
          <span className="flex items-center gap-2" data-testid="incident-pills" data-status={incident.status}>
            <StatusPill variant={severityVariant(incident.severity)}>{severityLabels[incident.severity]}</StatusPill>
            <StatusPill variant={workflowVariant(incident.status)}>{statusLabels[incident.status]}</StatusPill>
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular">
            <span>{t('work:incidents.detail.reported', 'Reported {{date}}', { date: formatDateOnly(incident.incident_date) })}</span>
            <span aria-hidden="true">·</span>
            {incident.project_id && (
              <ProjectNameLink projectId={incident.project_id} name={linkedProjectName} />
            ) || <span>{t('work:incidents.unlinked', 'Unlinked')}</span>}
          </span>
        }
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" data-testid="incident-edit" onClick={() => setEditOpen(true)}>
              {t('work:incidents.actions.edit', 'Edit')}
            </Button>
          ) : undefined
        }
      />

      {/* Location and reported description are the evidence before a lifecycle action. */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('work:incidents.detail.evidence', 'Incident evidence')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label={t('work:incidents.columns.location', 'Location')} value={incident.location || t('work:incidents.notRecorded', 'Not recorded')} />
          </dl>
          <div className="mt-4 border-t border-border pt-4">
            <h2 className="text-xl font-bold text-foreground">{t('work:incidents.detail.description', 'Description')}</h2>
          {incident.description ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{incident.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('work:incidents.detail.noDescription', 'No description was recorded.')}</p>
          )}
          </div>
        </CardPad>
      </Card>

      {canTransition && next && (
        <RecordActionZone>
          <div className="flex flex-col gap-2 py-3">
            <div className="text-xs font-semibold text-muted-foreground">{t('work:incidents.detail.nextAction', 'Next action')}</div>
            <Button
              variant="primary"
              size="sm"
              data-testid="incident-advance"
              onClick={() => setTransitionTo(next)}
            >
              {t(`incidents.detail.transition.${next === 'Closed' ? 'closed' : 'investigating'}.menu`, next === 'Closed' ? 'Close incident' : 'Start investigating')}
            </Button>
          </div>
        </RecordActionZone>
      )}

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
            toast(t('work:incidents.detail.toast.updated', 'Incident updated'), input.type, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Status transition confirm (default tone — a state-machine move, not destructive). */}
      <ConfirmDialog
        open={transitionTo !== null}
        tone="default"
        title={transitionCopy?.title ?? t('work:incidents.detail.confirmFallbackTitle', 'Advance incident?')}
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
    <dt className="text-xs font-semibold text-muted-foreground">
      {label}
    </dt>
    <dd className="text-sm text-foreground">{value}</dd>
  </div>
);

export default IncidentDetail;
