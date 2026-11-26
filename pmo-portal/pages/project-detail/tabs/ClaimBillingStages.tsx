import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ReasonDialog } from '@/src/components/ui/ReasonDialog';
import { SelectField, TextField, FieldError } from '@/src/components/ui/FormFields';
import { DateField } from '@/src/components/ui/DateField';
import { usePermission } from '@/src/auth/usePermission';
import { useBillingStageMutations, useClaimBillingTrace } from '@/src/hooks/useBillingStages';
import { useDocuments } from '@/src/hooks/useDocuments';
import { currentStageIndex, nextInvoiceDeadline, stageAgeDays, stageDaysPastTargetDate, stageOverdue } from '@/src/lib/billingStages';
import { formatIsoDay, formatNumberExact, formatTableMoney } from '@/src/lib/format';
import { orgDayNow } from '@/src/hooks/useOrgToday';
import { RetentionReleases } from './RetentionReleases';
import { ClaimStepsPanel } from './ClaimStepsPanel';
import { ClaimWorkOrderSteps } from './ClaimWorkOrderSteps';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import type { ClaimBillingStage } from '@/src/lib/db/billingStages';

/**
 * A progress claim's billing stages (#2522): each stage in order with its age, its document checklist and — for a step done
 * in the client's own system — the client's document number. The current stage is recorded here; the database decides
 * (order, required documents, dates, who may record) and refuses an invoice while any stage is open (FR-BST-020).
 * Also shows the project's next monthly invoice deadline and the retention the claim holds (ADR-0105).
 */
export interface ClaimBillingStagesProps {
  claimId: string;
  projectId: string;
  currency: string;
  invoiced: boolean;
  withdrawn: boolean;
  /** The claim's work order: its billing step list is linked from here, never copied (billing-steps.spec.md). */
  workOrderId?: string | null;
  /** The organisation's calendar day; the server re-checks dates on its own calendar. */
  today?: string;
}

const REFUSALS: Record<string, [string, string]> = {
  'stage-documents-missing': ['projectDetail.billing.stages.refusal.documentsMissing', 'Attach every required document before completing this stage.'],
  'stage-out-of-order': ['projectDetail.billing.stages.refusal.outOfOrder', 'Complete the earlier stages first.'],
  'stage-date-future': ['projectDetail.billing.stages.refusal.dateFuture', 'The completion date cannot be in the future.'],
  'stage-date-before-previous': ['projectDetail.billing.stages.refusal.dateBeforePrevious', 'A stage cannot complete before the previous one.'],
  'client-reference-missing': ['projectDetail.billing.stages.refusal.referenceMissing', "Enter the client's document number."],
  'stage-already-completed': ['projectDetail.billing.stages.refusal.alreadyCompleted', 'This stage is already completed.'],
  'stage-already-skipped': ['projectDetail.billing.stages.refusal.alreadySkipped', 'This stage was marked not needed.'],
  'stage-not-skippable': ['projectDetail.billing.stages.refusal.notSkippable', 'This stage cannot be marked not needed.'],
  'skip-reason-invalid': ['projectDetail.billing.stages.refusal.skipReason', 'Give a reason of 3 to 500 characters.'],
  'claim-withdrawn': ['projectDetail.billing.stages.refusal.withdrawn', 'This claim was withdrawn.'],
  'document-not-issued': ['projectDetail.billing.stages.refusal.notIssued', 'Only an issued or approved document can be attached.'],
  'document-without-file': ['projectDetail.billing.stages.refusal.noFile', 'The document has no file.'],
  'document-other-project': ['projectDetail.billing.stages.refusal.otherProject', "The document must be one of this project's documents."],
};

/** The reason dialog for marking an optional stage not needed (#2592). The database re-checks role, order and the reason. */
const SkipStageDialog: React.FC<{ claimId: string; projectId: string; stage: ClaimBillingStage; onClose: () => void }> = ({ claimId, projectId, stage, onClose }) => {
  const { t } = useTranslation('project');
  const { skipStage } = useBillingStageMutations(claimId, projectId);
  const [error, setError] = useState<string | null>(null);
  const confirm = async (reason: string) => {
    setError(null);
    try {
      await skipStage.mutateAsync({ stageId: stage.id, reason });
      onClose();
    } catch (err) {
      const known = REFUSALS[(err as { code?: string } | null)?.code ?? ''];
      setError(known ? t(known[0], known[1]) : t('projectDetail.billing.stages.refusal.generic', 'The stage could not be saved. Try again.'));
    }
  };
  return <ReasonDialog open kind="return" maxLength={500} loading={skipStage.isPending} error={error}
    title={t('projectDetail.billing.stages.skipTitle', 'Mark {{stage}} as not needed', { stage: stage.name })}
    label={t('projectDetail.billing.stages.skipLabel', 'Reason')}
    helper={t('projectDetail.billing.stages.skipHelp', 'Kept with the claim. The invoice no longer waits for this stage, and it cannot be undone.')}
    confirmLabel={t('projectDetail.billing.stages.skipConfirm', 'Mark not needed')}
    onConfirm={(reason) => void confirm(reason)} onCancel={onClose} />;
};

export const ClaimBillingStages: React.FC<ClaimBillingStagesProps> = ({ claimId, projectId, currency, invoiced, withdrawn, workOrderId, today = orgDayNow() }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const roles = useRoleOptions();
  const traceQuery = useClaimBillingTrace(claimId, projectId);
  const documents = useDocuments(projectId);
  const { attachDocument, completeStage } = useBillingStageMutations(claimId, projectId);
  const [skipping, setSkipping] = useState<ClaimBillingStage | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [completedOn, setCompletedOn] = useState(today);
  const [reference, setReference] = useState('');
  const [referenceError, setReferenceError] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (traceQuery.isError) {
    return <section className="border-t border-border p-4 text-sm" role="status">
      <p className="text-muted-foreground">{t('projectDetail.billing.stages.loadError', 'The billing stages could not be loaded.')}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => void traceQuery.refetch()}>{t('projectDetail.billing.stages.retry', 'Retry')}</Button>
    </section>;
  }
  const trace = traceQuery.data;
  if (!trace) return null;

  const open = !invoiced && !withdrawn;
  const canRecord = open && may('transition', 'billingStage');
  const canSkip = open && may('edit', 'billingStage');
  const current = currentStageIndex(trace.stages);
  const done = trace.stages.filter((s) => s.completedOn || s.skippedOn).length;
  const hasOpenStages = trace.stages.length === 0 || done < trace.stages.length;
  const deadline = open && hasOpenStages && trace.deadline ? nextInvoiceDeadline(today, trace.deadline.day, trace.deadline.warnDays) : null;
  const hasRetention = Boolean(trace.retention && (trace.retention.pct > 0 || trace.retention.amount > 0));
  // A claim made before the billing terms has no steps; whoever edits the list can still load them from a template (#2680).
  const canLoadSteps = open && may('edit', 'billingStage');
  if (trace.stages.length === 0 && !deadline && !hasRetention && !canLoadSteps) return null;
  const eligible = (documents.data ?? []).filter((d) => (d.status === 'Issued' || d.status === 'Approved') && Boolean(d.file_path));
  const titleOf = (id: string) => (documents.data ?? []).find((d) => d.id === id)?.title ?? t('projectDetail.billing.evidence.document', 'Evidence document');

  const explain = (err: unknown) => {
    const code = (err as { code?: string } | null)?.code ?? '';
    const known = REFUSALS[code];
    setRefusal(known ? t(known[0], known[1]) : t('projectDetail.billing.stages.refusal.generic', 'The stage could not be saved. Try again.'));
  };
  const attach = async (itemId: string) => {
    const documentId = picked[itemId];
    if (!documentId) return;
    setRefusal(null);
    try { await attachDocument.mutateAsync({ itemId, documentId }); } catch (err) { explain(err); }
  };
  const complete = async (stage: ClaimBillingStage) => {
    setRefusal(null);
    const ref = reference.trim();
    if (stage.clientSide && !ref) { setReferenceError(true); return; }
    setReferenceError(false);
    try {
      await completeStage.mutateAsync({ stageId: stage.id, completedOn, clientReference: stage.clientSide ? ref : null, note: null });
      setReference('');
    } catch (err) { explain(err); }
  };

  return <section aria-labelledby={`billing-stages-${claimId}`} className="border-t border-border p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id={`billing-stages-${claimId}`} className="text-group font-semibold">{trace.stages.length > 0 ? t('projectDetail.billing.stages.title', 'Billing stages') : t('projectDetail.billing.terms.title', 'Billing terms')}</h3>
      {trace.stages.length > 0 && <span className="text-sm tabular-nums text-muted-foreground">
        {t('projectDetail.billing.stages.progress', '{{done}} of {{total}} complete', { done: formatNumberExact(done), total: formatNumberExact(trace.stages.length) })}
      </span>}
    </div>
    {deadline && <p className="mt-1 text-sm">
      <StatusPill variant={deadline.warn ? 'warn' : 'neutral'} wrap={false}>
        {t('projectDetail.billing.stages.deadline', 'Invoice deadline {{date}} · {{count}} days left', { date: formatIsoDay(deadline.date), count: deadline.daysLeft })}
      </StatusPill>
    </p>}
    {trace.retention && hasRetention && <p className="mt-1 text-sm text-muted-foreground">
      {t('projectDetail.billing.stages.retentionHeld', 'Retention held: {{amount}} ({{pct}}%)', {
        amount: formatTableMoney(trace.retention.held, currency) ?? '', pct: formatNumberExact(trace.retention.pct),
      })}
    </p>}
    {trace.retention && hasRetention && <p className="mt-1 text-sm text-muted-foreground">
      {t('projectDetail.billing.releases.totals', 'Scheduled total (including released): {{scheduled}} · Released: {{released}}', {
        scheduled: formatTableMoney(trace.retention.scheduled, currency) ?? '', released: formatTableMoney(trace.retention.released, currency) ?? '',
      })}
    </p>}
    {trace.retention && trace.retention.amount > 0 && <RetentionReleases claimId={claimId} projectId={projectId} currency={currency} today={today} withdrawn={withdrawn} />}
    {open && current !== null && <p className="mt-1 text-sm text-muted-foreground">
      {t('projectDetail.billing.stages.gate', 'Complete every stage before raising the invoice.')}
    </p>}
    {refusal && <p role="alert" className="mt-2 text-sm text-destructive">{refusal}</p>}

    {trace.stages.length > 0 && <ol aria-label={t('projectDetail.billing.stages.title', 'Billing stages')} className="mt-3 divide-y divide-border">
      {trace.stages.map((stage, index) => {
        const age = stageAgeDays(stage, today);
        const isCurrent = index === current;
        const overdue = open ? stageOverdue({ ...stage, targetDays: stage.targetOn ? null : stage.targetDays }, today) : null;
        const pastDate = open ? stageDaysPastTargetDate(stage, today) : null;
        const skipped = Boolean(stage.skippedOn);
        return <li key={stage.id} aria-label={stage.name} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              <span className="mr-2 tabular-nums text-muted-foreground">{formatNumberExact(stage.position)}</span>{stage.name}
              {stage.clientSide && <span className="ml-2 text-sm font-normal text-muted-foreground">{t('projectDetail.billing.stages.clientSide', "In the client's system")}</span>}
            </span>
            <span className="flex items-center gap-2 text-sm">
              {age !== null && !skipped && !overdue && pastDate === null && <span className="tabular-nums text-muted-foreground">{t('projectDetail.billing.stages.age', '{{count}} days', { count: age })}</span>}
              {overdue && <StatusPill variant="overdue" wrap={false}>
                {t('projectDetail.billing.stages.overdue', 'Overdue')} · {t('projectDetail.billing.stages.overdueDetail', '{{age}} days, target {{target}}', { age: overdue.age, target: overdue.target })}
              </StatusPill>}
              {pastDate !== null && <StatusPill variant="overdue" wrap={false}>
                {t('projectDetail.billing.stages.overdue', 'Overdue')} · {t('projectDetail.billing.steps.pastTargetDate', '{{count}} days past the target date', { count: pastDate })}
              </StatusPill>}
              <StatusPill variant={stage.completedOn ? 'won' : isCurrent ? 'progress' : 'neutral'} wrap={false}>
                {stage.completedOn
                  ? t('projectDetail.billing.stages.completed', 'Completed {{date}}', { date: formatIsoDay(stage.completedOn) })
                  : skipped ? t('projectDetail.billing.stages.skipped', 'Not needed {{date}}', { date: formatIsoDay(stage.skippedOn as string) })
                  : isCurrent ? t('projectDetail.billing.stages.current', 'Current') : t('projectDetail.billing.stages.waiting', 'Waiting')}
              </StatusPill>
            </span>
          </div>
          {(stage.ownerRole || stage.targetOn) && <p className="mt-1 text-sm text-muted-foreground">
            {[
              stage.ownerRole ? t('projectDetail.billing.steps.ownerLine', 'Owner: {{role}}', { role: roles.label(stage.ownerRole) }) : null,
              stage.targetOn ? t('projectDetail.billing.steps.targetLine', 'Target date {{date}}', { date: formatIsoDay(stage.targetOn) }) : null,
            ].filter(Boolean).join(' · ')}
          </p>}
          {skipped && stage.skippedReason && <p className="mt-1 text-sm text-muted-foreground">
            {t('projectDetail.billing.stages.skippedReason', 'Reason: {{reason}}', { reason: stage.skippedReason })}
          </p>}
          {stage.clientReference && <p className="mt-1 text-sm text-muted-foreground">
            {t('projectDetail.billing.stages.reference', "Client's document {{reference}}", { reference: stage.clientReference })}
          </p>}
          {stage.documents.length > 0 && <ul className="mt-2 space-y-2 text-sm">
            {stage.documents.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {item.name}
                <span className="ml-1.5 text-muted-foreground">{item.required
                  ? t('projectDetail.billing.stages.required', 'required') : t('projectDetail.billing.stages.optional', 'optional')}</span>
              </span>
              {item.documentId
                ? <Link to={`/projects/${encodeURIComponent(projectId)}/documents?open=${encodeURIComponent(item.documentId)}`}
                    className="font-medium text-primary-text hover:underline">{titleOf(item.documentId)}</Link>
                : skipped ? <span className="text-muted-foreground">{t('projectDetail.billing.stages.itemNotNeeded', 'Not needed')}</span>
                : canRecord && !stage.completedOn
                  ? <span className="flex items-center gap-2">
                      <SelectField compact inline hideLabel
                        label={t('projectDetail.billing.stages.pickFor', 'Document for {{item}}', { item: item.name })}
                        placeholder={t('projectDetail.billing.stages.pick', 'Choose a document')}
                        value={picked[item.id] ?? ''}
                        onChange={(v) => setPicked((p) => ({ ...p, [item.id]: v }))}
                        options={eligible.map((d) => ({ value: d.id, label: d.title ?? d.id }))} />
                      <Button variant="outline" size="sm" disabled={!picked[item.id] || attachDocument.isPending}
                        aria-label={t('projectDetail.billing.stages.attachTo', 'Attach to {{item}}', { item: item.name })}
                        onClick={() => void attach(item.id)}>{t('projectDetail.billing.stages.attach', 'Attach')}</Button>
                    </span>
                  : <span className="text-muted-foreground">{t('projectDetail.billing.stages.missing', 'Not attached')}</span>}
            </li>)}
          </ul>}
          {isCurrent && canSkip && stage.optional && <div className="mt-3">
            <Button variant="outline" size="sm" aria-label={t('projectDetail.billing.stages.skipNamed', 'Mark {{stage}} as not needed', { stage: stage.name })}
              onClick={() => setSkipping(stage)}>{t('projectDetail.billing.stages.skip', 'Not needed')}</Button>
          </div>}
          {isCurrent && canRecord && <div className="mt-3 flex flex-wrap items-end gap-3">
            <DateField compact label={t('projectDetail.billing.stages.completedOn', 'Completed on')} value={completedOn} max={today} onChange={setCompletedOn} />
            {stage.clientSide && <div>
              <TextField code label={t('projectDetail.billing.stages.clientReference', "Client's document number")} value={reference}
                onChange={(v) => { setReference(v); setReferenceError(false); }} aria-invalid={referenceError || undefined} />
              {referenceError && <FieldError>{t('projectDetail.billing.stages.refusal.referenceMissing', "Enter the client's document number.")}</FieldError>}
            </div>}
            <Button variant="primary" size="sm" disabled={completeStage.isPending}
              aria-label={t('projectDetail.billing.stages.completeNamed', 'Complete {{stage}}', { stage: stage.name })}
              onClick={() => void complete(stage)}>{t('projectDetail.billing.stages.complete', 'Complete stage')}</Button>
          </div>}
        </li>;
      })}
    </ol>}
    {(trace.stages.length > 0 || canLoadSteps) && <ClaimStepsPanel claimId={claimId} projectId={projectId} stages={trace.stages} open={open} />}
    <ClaimWorkOrderSteps workOrderId={workOrderId} />
    {skipping && <SkipStageDialog claimId={claimId} projectId={projectId} stage={skipping} onClose={() => setSkipping(null)} />}
  </section>;
};

export default ClaimBillingStages;
