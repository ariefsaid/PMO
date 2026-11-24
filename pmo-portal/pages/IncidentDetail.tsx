import { IncidentTaskLink } from '@/components/IncidentTaskLink';
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
import { usePermission } from '@/src/auth/usePermission';
import { can } from '@/src/auth/policy';
import { isLightAccount } from '@/src/auth/lightAccount';
import { useIncident, useIncidentMutations, useIncidentFiles, useIncidentEvidenceMutations, useAssigneeOptions, useSupervisorMayTask } from '@/src/hooks/useIncidents';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useProjectOptions } from '@/src/hooks/useFkOptions';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { severityVariant } from '@/src/lib/status/statusVariants';
import { statusLabel } from '@/src/lib/status/statusMap';
import { NEXT_STATUS, transitionCopy as getTransitionCopy, severityLabel, type AdvanceStatus } from '@/src/lib/incidents/transitions';
import type { IncidentInput } from '@/src/lib/db/incidents';
import { formatDay } from '@/src/lib/format';
import { isIncidentOverdue } from '@/src/lib/incidents/overdue';
import { IncidentFormModal } from '@/components/IncidentFormModal';
import { IncidentCloseDialog } from '@/components/IncidentCloseDialog';
import { IncidentEvidence } from '@/components/IncidentEvidence';
import { IncidentTasks } from '@/components/IncidentTasks';
import { IncidentRootCause } from '@/components/IncidentRootCause';

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
  const { t: tStatus } = useTranslation('status');
  const { t } = useTranslation('incidents');
  const may = usePermission();
  const { toast } = useToast();

  const query = useIncident(incidentId);
  const { update, transition } = useIncidentMutations();
  const { makeTask, addTask, saveRootCause } = useIncidentEvidenceMutations();
  const { currentUser } = useAuth();
  const { realRole, effectiveRole } = useEffectiveRole();
  const files = useIncidentFiles(incidentId);
  const { data: assigneeOptions } = useAssigneeOptions();
  const workOrders = useProjectWorkOrders(query.data?.project_id ?? '');
  // Project FK options (cached, org-scoped) resolve the linked project's display name for the
  // click-to-open link (ADR-0028). org_id is never threaded — RLS scopes the list.
  const { data: projectOptions } = useProjectOptions();

  const [editOpen, setEditOpen] = useState(false);
  const [rootCauseOpen, setRootCauseOpen] = useState(false);
  const [transitionTo, setTransitionTo] = useState<AdvanceStatus | null>(null);

  // Manager-only investigate/close + edit (FE clarity projection; the incident_reports RLS
  // role gate is the real authority — a non-manager attempt is rejected/hidden server-side).
  const canEdit = may('edit', 'incident');
  const canTransition = may('transition', 'incidentClose');

  // The person in charge may move their own issue forward (status, note, photos) — the database limits them to that.
  const isAssignee = Boolean(currentUser?.id && query.data?.assignee_id === currentUser.id);
  const reporterMayFollowUp = Boolean(currentUser?.id && query.data?.reported_by === currentUser.id
    && query.data?.status !== 'Closed' && !isLightAccount(currentUser) && realRole === effectiveRole);
  const canMakeTask = canEdit;
  // The Site Supervisor job role adds tasks to an issue on a work order it supervises (add_task_to_incident, 2041).
  const supervisorMayTask = useSupervisorMayTask(query.data?.id, !canEdit && currentUser?.built_in_role === 'site_supervisor'
    && realRole === effectiveRole);
  // The root cause may be written by a manager or the person in charge (the issue guard decides).
  const canEditRootCause = canEdit || isAssignee || reporterMayFollowUp;

  const goBack = () => navigate('/incidents');

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label={t('title', 'Incidents')} phoneOnly onBack={goBack} />
        <div data-testid="incident-loading">
          <ListState variant="loading" shape="detail" rows={5} />
        </div>
      </>
    );
  }

  // ── Error (a genuine transient failure — offer Retry) ─────────────────────
  if (query.isError) {
    return (
      <>
        <BackBar label={t('title', 'Incidents')} phoneOnly onBack={goBack} />
        <ListState
          variant="error"
          title={t('detail.errorTitle', "Couldn't load incident")}
          sub={t('detail.errorSub', 'Something went wrong fetching the incident report.')}
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
        <BackBar label={t('title', 'Incidents')} phoneOnly onBack={goBack} />
        <div data-testid="incident-not-found">
          <ListState
            variant="empty"
            icon="alert"
            title={t('detail.notFoundTitle', 'Incident not found')}
            sub={t('detail.notFoundSub', "This incident either doesn't exist or isn't visible to you. Return to the register to find it.")}
          />
        </div>
      </>
    );
  }

  const next = NEXT_STATUS[incident.status];
  const overdue = isIncidentOverdue(incident);
  const assigneeName = incident.assignee_id ? assigneeOptions?.find((o) => o.value === incident.assignee_id)?.label ?? '…' : null;
  const workOrder = incident.work_order_id ? workOrders.data?.find((w) => w.id === incident.work_order_id) : null;
  const canAddEvidence = canEdit || isAssignee || Boolean(currentUser?.id && incident.reported_by === currentUser.id);
  // The roles the closing rule allows (policy `incidentClose.transition`), named for the reader.
  const roleWords: Record<string, string> = {
    'Project Manager': t('nextSteps.rolePm', 'Project Manager'), Executive: t('nextSteps.roleExecutive', 'Executive'), Admin: t('nextSteps.roleAdmin', 'Admin'),
  };
  const closerNames = (['Project Manager', 'Executive', 'Admin'] as const).filter((r) => can('transition', 'incidentClose', { realRole: r })).map((r) => roleWords[r]);
  const closerRoles = closerNames.length > 1 ? `${closerNames.slice(0, -1).join(', ')} ${t('nextSteps.and', 'and')} ${closerNames[closerNames.length - 1]}` : (closerNames[0] ?? '');
  const transitionCopy = transitionTo ? getTransitionCopy(t, transitionTo) : null;

  // Resolve the linked project's name from the cached FK options (falls back to a generic
  // label until the list loads — the link still targets the correct /projects/:id).
  const linkedProjectName = incident.project_id
    ? projectOptions?.find((o) => o.value === incident.project_id)?.label ?? t('detail.viewProject', 'View project')
    : null;

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onTransitionConfirm = async () => {
    if (!transitionTo) return;
    try {
      await transition.mutateAsync({ id: incident.id, status: transitionTo });
      toast(
        transitionTo === 'Closed' ? t('toast.closed', 'Incident closed') : t('toast.started', 'Investigation started'),
        incident.type,
        'success',
      );
      setTransitionTo(null);
    } catch (err) {
      onMutationError(err);
    }
  };

  const onCloseWithProof = async (note: string) => {
    await transition.mutateAsync({ id: incident.id, status: 'Closed', ...(note.trim() ? { closeNote: note.trim() } : {}) });
    toast(t('toast.closed', 'Incident closed'), incident.type, 'success');
    setTransitionTo(null);
  };

  const taskLines = incident.incident_tasks ?? [];
  const showTaskList = taskLines.length > 0;
  // The form that takes a name, a person and a day is there from the start, not only once a first task exists.
  const canAddTask = may('act', 'incident', {record: {project_id: incident.project_id, status: incident.status, mayTaskIssue: supervisorMayTask, reporterMayFollowUp, viewOnly: realRole !== effectiveRole}});

  const onMakeTask = async () => {
    try {
      await makeTask.mutateAsync(incident.id);
      toast(t('toast.taskMade', 'Task created'), incident.type, 'success');
    } catch (err) {
      onMutationError(err);
    }
  };

  return (
    <div>
      {/* Mobile escape route — the top-bar breadcrumb owns desktop wayfinding, the rail
          collapses ≤920px so the BackBar is the only in-content escape there. */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label={t('title', 'Incidents')} onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + type + severity/status pills (CW-2 registry) +
          the role-allowed header actions (Edit only; advance verbs go to RecordActionZone). */}
      <RecordHeader
        name={incident.type}
        iconColor="hsl(var(--primary))"
        icon={<Icon name="alert" />}
        status={
          <span className="flex items-center gap-2" data-testid="incident-pills" data-status={incident.status}>
            <StatusPill variant={severityVariant(incident.severity)}>{severityLabel(t, incident.severity)}</StatusPill>
            <StatusPill record="incident" state={incident.status} />
            {overdue && <StatusPill variant="lost">{t('overdue', 'Overdue')}</StatusPill>}
          </span>
        }
        meta={<span className="tabular">{t('reported', 'Reported {{date}}', { date: formatDay(incident.incident_date) })}</span>}
        actions={
          canEdit || (canEditRootCause && !incident.root_cause) ? (
            <span className="flex items-center gap-2">
              {canEditRootCause && !incident.root_cause && !rootCauseOpen && (
                <Button variant="outline" size="sm" data-testid="incident-root-cause-add" onClick={() => setRootCauseOpen(true)}>
                  {t('rootCause.add', 'Record the root cause')}
                </Button>
              )}
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="incident-edit" onClick={() => setEditOpen(true)}>
                  {t('action.edit', 'Edit')}
                </Button>
              )}
            </span>
          ) : undefined
        }
      />

      {/* RecordActionZone — advance/decide verb (DESIGN.md §7: advance verbs live here, not in the header).
          Sticky on desktop so the action is never below the fold. Only rendered when the user can transition
          AND a next state exists for this incident. */}
      {(canTransition || isAssignee) && next && (
        <RecordActionZone>
          <div className="flex flex-col gap-2 py-3">
            {/* Consistent zone chrome: a "Next action" label leads the verb, matching the
                procurement "Ready to advance" + pipeline "Next actions" record-action zones. */}
            <div className="text-control font-semibold text-muted-foreground">{t('action.next', 'Next action')}</div>
            <Button
              variant="primary"
              size="sm"
              data-testid="incident-advance"
              onClick={() => setTransitionTo(next)}
            >
              {getTransitionCopy(t, next).menu}
            </Button>
          </div>
        </RecordActionZone>
      )}

      {incident.status !== 'Closed' && (
        <div role="status" data-testid="incident-next-steps" className="mb-4 space-y-1 rounded-lg border border-border bg-card p-3 text-control">
          <div className="font-semibold">{t('nextSteps.title', 'What happens next')}</div>
          <p>
            {assigneeName
              ? t('nextSteps.inCharge', { defaultValue: 'Person in charge: {{name}}.', name: assigneeName })
              : t('nextSteps.nobody', 'Nobody is in charge yet. The project manager picks the person in charge.')}
          </p>
          <p>
            {incident.action
              ? t('nextSteps.next', { defaultValue: 'Next: {{action}}.', action: incident.action })
              : incident.status === 'Open'
                ? t('nextSteps.nextOpen', 'Next: the person in charge starts looking into it.')
                : t('nextSteps.nextInvestigating', 'Next: the person in charge fixes it and closes it.')}
          </p>
          <p className="text-muted-foreground">
            {t('nextSteps.whoCloses', { defaultValue: '{{roles}} can close this issue, with proof.', roles: closerRoles })}
          </p>
        </div>
      )}

      {incident.escalated_at && incident.status !== 'Closed' && (
        <div role="status" data-testid="incident-escalated" className="mb-4 rounded-lg border border-border bg-card p-3 text-control">
          <span className="font-semibold">{t('detail.escalated', 'Escalated')}</span>{' '}
          {t('detail.escalatedBody', 'This issue passed its due time on {{date}}; the person in charge and the project manager were told.', { date: formatDay(incident.due_at ?? incident.escalated_at) })}
        </div>
      )}

      {/* Body — the incident's fields (read-only; edit-in-modal). Shared Card primitives,
          DESIGN.md tokens (no raw hex). */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('detail.section', 'Incident detail')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label={t('detail.type', 'Type')} value={incident.type} />
            <Field label={t('col.date', 'Date')} value={formatDay(incident.incident_date)} />
            <Field label={t('col.severity', 'Severity')} value={severityLabel(t, incident.severity)} />
            <Field label={t('col.status', 'Status')} value={statusLabel('incident', incident.status, tStatus)} />
            <Field label={t('col.location', 'Location')} value={incident.location || '—'} />
            <Field
              label={t('form.project', 'Project')}
              value={
                incident.project_id ? (
                  <ProjectNameLink projectId={incident.project_id} name={linkedProjectName} />
                ) : (
                  '—'
                )
              }
            />
            <Field label={t('form.assignee', 'Person in charge')} value={assigneeName ?? '—'} />
            <Field label={t('form.due', 'Fix by')} value={incident.due_at ? formatDay(incident.due_at) : '—'} />
            <Field label={t('form.workOrder', 'Work order')} value={workOrder ? (workOrder.wo_number ?? workOrder.title) : incident.work_order_id ? '…' : '—'} />
            <Field label={t('form.action', 'What must be done')} value={incident.action || '—'} />
            {incident.closed_at && <Field label={t('detail.closedOn', 'Closed on')} value={formatDay(incident.closed_at)} />}
            {incident.close_note && <Field label={t('close.note', 'Close note')} value={incident.close_note} />}
            {taskLines.length === 0 && (
              <Field
                label={t('detail.task', 'Task')}
                value={
                  incident.task_id ? (
                    <IncidentTaskLink taskId={incident.task_id} />
                  ) : canMakeTask && incident.project_id ? (
                    <Button variant="outline" size="sm" data-testid="incident-make-task" loading={makeTask.isPending} onClick={() => void onMakeTask()}>
                      {t('detail.makeTask', 'Make a task')}
                    </Button>
                  ) : canMakeTask && incident.status !== 'Closed' ? (
                    <span className="text-muted-foreground">{t('detail.needsProject', 'Choose a project for this issue before you make a task.')}</span>
                  ) : (
                    '—'
                  )
                }
              />
            )}
          </dl>
        </CardPad>
      </Card>

      {(showTaskList || canAddTask) && (
        <Card variant="bare" className="mb-4">
          <CardHead>{t('tasks.heading', 'Tasks')}</CardHead>
          <CardPad>
            <IncidentTasks
              lines={taskLines}
              assigneeOptions={assigneeOptions ?? []}
              canAdd={canAddTask}
              onAdd={async (input) => {
                await addTask.mutateAsync({ incidentId: incident.id, ...input });
                toast(t('toast.taskMade', 'Task created'), incident.type, 'success');
              }}
              onError={onMutationError}
            />
          </CardPad>
        </Card>
      )}

      {(incident.root_cause || rootCauseOpen) && (
        <Card variant="bare" className="mb-4">
          <CardHead>{t('rootCause.heading', 'Root cause')}</CardHead>
          <CardPad>
            <IncidentRootCause
              value={incident.root_cause ?? null}
              canEdit={canEditRootCause}
              startEditing={rootCauseOpen && !incident.root_cause}
              onDone={() => setRootCauseOpen(false)}
              onSave={async (text) => {
                await saveRootCause.mutateAsync({ id: incident.id, rootCause: text });
                toast(t('toast.updated', 'Incident updated'), incident.type, 'success');
              }}
              onError={onMutationError}
            />
          </CardPad>
        </Card>
      )}

      <Card variant="bare" className="mb-4">
        <CardHead>{t('detail.photos', 'Photos')}</CardHead>
        <CardPad>
          <IncidentEvidence incident={incident} files={files.data ?? []} canAdd={canAddEvidence && incident.status !== 'Closed'} />
        </CardPad>
      </Card>

      <Card variant="bare">
        <CardHead>{t('detail.description', 'Description')}</CardHead>
        <CardPad>
          {incident.description ? (
            <p className="whitespace-pre-wrap text-control leading-relaxed">{incident.description}</p>
          ) : (
            <p className="text-control text-muted-foreground">{t('detail.noDescription', 'No description was recorded.')}</p>
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
          onCreate={() => Promise.reject(new Error('create is not available from the detail page'))}
          onUpdate={async (id, input: IncidentInput) => {
            await update.mutateAsync({ id, input });
            toast(t('toast.updated', 'Incident updated'), input.type, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Status transition confirm (default tone — a state-machine move, not destructive). */}
      {transitionTo === 'Closed' && (
        <IncidentCloseDialog incident={incident} closeProofCount={(files.data ?? []).filter((f) => f.kind === 'at_close').length} onClose={onCloseWithProof} onCancel={() => setTransitionTo(null)} onError={onMutationError} />
      )}
      <ConfirmDialog
        open={transitionTo === 'Investigating'}
        tone="default"
        title={transitionCopy ? transitionCopy.title(incident.type) : t('transition.advance', 'Advance incident?')}
        description={transitionCopy?.body ?? ''}
        confirmLabel={transitionCopy?.confirm ?? t('transition.confirm', 'Confirm')}
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
    <dt className="text-control font-semibold text-muted-foreground">
      {label}
    </dt>
    <dd className="text-control text-foreground">{value}</dd>
  </div>
);

export default IncidentDetail;
