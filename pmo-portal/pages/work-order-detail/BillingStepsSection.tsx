import React, { useContext, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { Button } from '@/src/components/ui/Button';
import { DateField } from '@/src/components/ui/DateField';
import { SelectField } from '@/src/components/ui/FormFields';
import { ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useUsers } from '@/src/hooks/useUsers';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { useWorkOrderStepMutations, useWorkOrderSteps } from '@/src/hooks/useBillingSteps';
import { useRefusalLine } from '@/src/lib/refusals';
import { formatIsoDay } from '@/src/lib/format';
import { localToday } from '@/src/lib/efaktur';
import { mayActOnStep, stepAgeDays, stepDaysOver, stepDueOn, stepStatus } from '@/src/lib/workOrderBillingSteps';
import type { WorkOrderStep } from '@/src/lib/db/workOrderBillingSteps';

/**
 * A work order's billing steps (billing-steps.spec.md FR-WBS-009): the whole chain from the first step to the invoice in one list, copied
 * from the organisation's default billing step template when the work order was issued. ADVISORY: nothing here gates invoicing; the
 * claim's own steps do. What the viewer may see is decided by the database (hidden steps are simply absent), so this component never
 * hides a step itself; it only shows or withholds the controls. No step, role or day count is named here: they are the organisation's data.
 */
export interface BillingStepsSectionProps {
  workOrderId: string;
  projectId: string;
  /** Steps change only while the work order is Issued. */
  status: string;
  today?: string;
}

const LIGHT_KEYS = new Set(BUILT_IN_ROLES.filter((r) => r.tier === 'field').map((r) => r.key));

const StepRow: React.FC<{ step: WorkOrderStep; steps: WorkOrderStep[]; projectId: string; today: string; issued: boolean; onError: (m: string | null) => void }> = ({
  step, steps, projectId, today, issued, onError,
}) => {
  const { t } = useTranslation('billingSteps');
  const auth = useContext(AuthContext);
  const { realRole } = useEffectiveRole();
  const roleName = useBuiltInRoleName();
  const line = useRefusalLine();
  const { complete, skip, assign, attach } = useWorkOrderStepMutations();
  const [doneOn, setDoneOn] = useState(today);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const status = stepStatus(step);
  const actor = { userId: auth?.currentUser?.id ?? null, builtInRoleKey: auth?.currentUser?.built_in_role ?? null, role: realRole };
  const canAct = issued && status === 'current' && mayActOnStep(actor, step);
  const canAttach = issued && status !== 'done' && status !== 'skipped' && mayActOnStep(actor, step);
  const users = useUsers({ enabled: canAct });
  const documents = useDocuments(projectId);
  const eligible = (documents.data ?? []).filter((d) => (d.status === 'Issued' || d.status === 'Approved') && Boolean(d.file_path));
  const titleOf = (id: string) => (documents.data ?? []).find((d) => d.id === id)?.title ?? t('document', 'Document');
  const people = (users.data ?? []).filter((u) => u.status === 'active' && !(u.built_in_role && LIGHT_KEYS.has(u.built_in_role)));
  const due = stepDueOn(step);
  const age = stepAgeDays(step, today);
  const over = stepDaysOver(step, today);
  const missingRequired = step.documents.some((d) => d.required && !d.documentId);
  const run = async (fn: () => Promise<unknown>) => { onError(null); try { await fn(); } catch (err) { onError(line(err)); } };
  const index = steps.findIndex((s) => s.id === step.id);

  return <li aria-label={step.name} className="py-3" data-testid="wo-billing-step">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">
        <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}</span>{step.name}
        {step.optional && <span className="ml-2 text-control font-normal text-muted-foreground">{t('optional', 'optional')}</span>}
      </span>
      <span className="flex items-center gap-2 text-control">
        {over !== null && <StatusPill variant="overdue" wrap={false}>{t('over', '{{count}} days past target', { count: over })}</StatusPill>}
        <StatusPill variant={status === 'done' ? 'won' : status === 'current' ? 'progress' : 'neutral'} wrap={false}>
          {status === 'done' ? t('done', 'Done {{date}}', { date: formatIsoDay(step.doneOn ?? '') })
            : status === 'skipped' ? t('skipped', 'Skipped {{date}}', { date: formatIsoDay(step.skippedOn ?? '') })
            : status === 'current' ? t('current', 'Current') : t('waiting', 'Not yet open')}
        </StatusPill>
      </span>
    </div>
    <p className="mt-1 text-control text-muted-foreground">
      {step.ownerRoleKey ? roleName(step.ownerRoleKey) : t('noRole', 'No role set')}
      {' · '}
      {step.assigneeName ?? t('noPerson', 'No one named')}
      {step.targetDays !== null && ` · ${t('target', 'Target {{count}} days', { count: step.targetDays })}`}
      {due && status === 'current' && ` · ${t('due', 'Due {{date}}', { date: formatIsoDay(due) })}`}
      {age !== null && status === 'current' && ` · ${t('age', '{{count}} days on this step', { count: age })}`}
    </p>
    {step.documents.length > 0 && <ul className="mt-2 space-y-2 text-control" aria-label={t('documents', 'Documents for {{step}}', { step: step.name })}>
      {step.documents.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
        <span>{d.name}<span className="ml-2 text-muted-foreground">{d.required ? t('required', 'required') : t('optional', 'optional')}</span></span>
        {d.documentId
          ? <Link to={`/projects/${encodeURIComponent(projectId)}/documents?open=${encodeURIComponent(d.documentId)}`} className="font-medium text-primary-text hover:underline">{titleOf(d.documentId)}</Link>
          : canAttach
            ? <span className="flex items-center gap-2">
                <SelectField compact inline hideLabel label={t('pickFor', 'Document for {{item}}', { item: d.name })} placeholder={t('pick', 'Choose a document')}
                  value={picked[d.id] ?? ''} onChange={(v) => setPicked((p) => ({ ...p, [d.id]: v }))}
                  options={eligible.map((e) => ({ value: e.id, label: e.title ?? e.id }))} />
                <Button variant="outline" size="sm" disabled={!picked[d.id] || attach.isPending} aria-label={t('attachTo', 'Attach to {{item}}', { item: d.name })}
                  onClick={() => void run(() => attach.mutateAsync({ stepId: step.id, slotId: d.id, documentId: picked[d.id] }))}>{t('attach', 'Attach')}</Button>
              </span>
            : <span className="text-muted-foreground">{t('notAttached', 'No document attached')}</span>}
      </li>)}
    </ul>}
    {canAct && <div className="mt-3 flex flex-wrap items-end gap-3">
      <SelectField compact label={t('person', 'Person on this step')} placeholder={t('personNone', 'No one named')} value={step.assigneeId ?? ''}
        onChange={(v) => void run(() => assign.mutateAsync({ stepId: step.id, personId: v || null }))}
        options={people.map((u) => ({ value: u.id, label: u.full_name ?? u.id }))} />
      <DateField compact label={t('doneOn', 'Done on')} value={doneOn} max={today} onChange={setDoneOn} />
      <Button variant="primary" size="sm" disabled={complete.isPending || missingRequired} aria-label={t('markDoneNamed', 'Mark {{item}} done', { item: step.name })}
        onClick={() => void run(() => complete.mutateAsync({ stepId: step.id, doneOn }))}>{t('markDone', 'Mark done')}</Button>
      {step.optional && <Button variant="outline" size="sm" disabled={skip.isPending} aria-label={t('skipNamed', 'Skip {{item}}', { item: step.name })}
        onClick={() => void run(() => skip.mutateAsync(step.id))}>{t('skip', 'Skip')}</Button>}
      {missingRequired && <p className="basis-full text-control text-muted-foreground">{t('needDocs', 'Attach every required document before marking this step done.')}</p>}
    </div>}
  </li>;
};

const BillingStepsBody: React.FC<BillingStepsSectionProps> = ({ workOrderId, projectId, status, today = localToday() }) => {
  const { t } = useTranslation('billingSteps');
  const query = useWorkOrderSteps(workOrderId);
  const [refusal, setRefusal] = useState<string | null>(null);
  const title = t('title', 'Billing steps');
  if (status === 'Draft') return null;
  if (query.isError) {
    return <RecordSection title={title}><ListState variant="error" title={t('loadError', "Couldn't load the billing steps")} onRetry={() => void query.refetch()} /></RecordSection>;
  }
  if (!query.data) return null;
  const steps = query.data;
  const left = steps.filter((s) => stepStatus(s) !== 'done' && stepStatus(s) !== 'skipped').length;
  return <RecordSection title={title}>
    {steps.length === 0
      ? <p className="text-control text-muted-foreground" data-testid="wo-billing-steps-empty">
          {t('empty', 'No billing steps to show. Steps are copied from the organisation\'s default billing step template when a work order is issued: an Admin or a Finance person chooses that template under billing step templates. If a list exists, it is not shown to your role.')}
        </p>
      : <>
        <p className="text-control text-muted-foreground" data-testid="wo-billing-steps-summary">
          {left > 0 ? t('left', '{{count}} steps not finished. This list tracks the chain to the invoice; it does not block invoicing.', { count: left })
            : t('allDone', 'Every billing step is finished.')}
        </p>
        {refusal && <p role="alert" className="mt-2 text-control text-destructive">{refusal}</p>}
        <ol aria-label={title} className="mt-3 divide-y divide-border" data-testid="wo-billing-steps">
          {steps.map((s) => <StepRow key={s.id} step={s} steps={steps} projectId={projectId} today={today} issued={status === 'Issued'} onError={setRefusal} />)}
        </ol>
      </>}
  </RecordSection>;
};

/** Renders nothing outside the auth and query providers (the page's read-only tests mount it bare) and nothing for a Draft. */
export const BillingStepsSection: React.FC<BillingStepsSectionProps> = (props) => {
  const auth = useContext(AuthContext);
  const queryClient = useContext(QueryClientContext);
  if (!auth || !queryClient) return null;
  return <BillingStepsBody {...props} />;
};

export default BillingStepsSection;
