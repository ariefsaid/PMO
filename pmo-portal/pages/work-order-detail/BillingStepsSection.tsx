import React, { useContext, useId, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { Button } from '@/src/components/ui/Button';
import { ReasonDialog } from '@/src/components/ui/ReasonDialog';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { DateField } from '@/src/components/ui/DateField';
import { SelectField, TextField } from '@/src/components/ui/FormFields';
import { EntityFormModal, type SubmitError } from '@/src/components/ui/EntityFormModal';
import { ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useUsers } from '@/src/hooks/useUsers';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { useStepTemplateMutations, useWorkOrderStepMutations, useWorkOrderSteps } from '@/src/hooks/useBillingSteps';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useRefusalLine, useRefusalText } from '@/src/lib/refusals';
import { formatIsoDay } from '@/src/lib/format';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { mayActOnStep, mayChangeStepList, stepAgeDays, stepDaysOver, stepDueOn, stepInsertPlaces, stepStatus } from '@/src/lib/workOrderBillingSteps';
import type { WorkOrderStep } from '@/src/lib/db/workOrderBillingSteps';

/**
 * A work order's billing steps (billing-steps.spec.md FR-WBS-009): the whole chain from the first step to the invoice in one list, copied
 * from the organisation's default billing step template when the work order was issued. ADVISORY: nothing here gates invoicing; the
 * claim's own steps do. What the viewer may see is decided by the database (hidden steps are simply absent), so this component never
 * hides a step itself; it only shows or withholds the controls. No step, role or day count is named here: they are the organisation's data.
 * The list itself can change after issue (wo-checklist-edit.spec.md): while the work order is Issued, a person who runs billing steps adds
 * a step to this work order's own list; Finance or an Admin saves the list as it stands as a new template for the next work orders.
 */
export interface BillingStepsSectionProps {
  workOrderId: string;
  projectId: string;
  /** Steps change only while the work order is Issued. */
  status: string;
  today?: string;
}

const LIGHT_KEYS = new Set(BUILT_IN_ROLES.filter((r) => r.tier === 'field').map((r) => r.key));
/** An added step's owner is a job role; a field account owns no step (the database refuses it), so it is not offered. */
const FULL_ROLE_KEYS = BUILT_IN_ROLES.filter((r) => r.tier !== 'field').map((r) => r.key);

const StepRow: React.FC<{ step: WorkOrderStep; steps: WorkOrderStep[]; projectId: string; today: string; issued: boolean; onError: (m: string | null) => void }> = ({
  step, steps, projectId, today, issued, onError,
}) => {
  const { t } = useTranslation('billingSteps');
  const auth = useContext(AuthContext);
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const viewOnly = realRole !== effectiveRole;
  const roleName = useBuiltInRoleName();
  const line = useRefusalLine();
  const { complete, skip, assign, attach, markEvidence } = useWorkOrderStepMutations();
  const [doneOn, setDoneOn] = useState(today);
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const status = stepStatus(step);
  const actor = { userId: auth?.currentUser?.id ?? null, builtInRoleKey: auth?.currentUser?.built_in_role ?? null, role: realRole };
  const canAct = !viewOnly && issued && status === 'current' && mayActOnStep(actor, step);
  const canAttach = !viewOnly && issued && status !== 'done' && status !== 'skipped' && mayActOnStep(actor, step);
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
    {status === 'skipped' && step.skippedReason && <p className="mt-1 text-control text-muted-foreground">{t('skipReason', 'Reason: {{reason}}', { reason: step.skippedReason })}</p>}
    <p className="mt-1 text-control text-muted-foreground">
      {step.ownerRoleKey ? roleName(step.ownerRoleKey) : t('noRole', 'No role set')}
      {' · '}
      {step.assigneeName ?? t('noPerson', 'No one named')}
      {step.targetDays !== null && ` · ${t('target', 'Target {{count}} days', { count: step.targetDays })}`}
      {due && status === 'current' && ` · ${t('due', 'Due {{date}}', { date: formatIsoDay(due) })}`}
      {age !== null && status === 'current' && ` · ${t('age', '{{count}} days on this step', { count: age })}`}
    </p>
    {!viewOnly && may('manage', 'orgAccounting') && <Checkbox checked={step.claimEvidenceEnabled === true} disabled={markEvidence.isPending}
      label={t('claimEvidence', 'Documents here count as claim evidence')}
      onChange={(enabled) => void run(() => markEvidence.mutateAsync({ stepId: step.id, enabled }))}>
      {t('claimEvidence', 'Documents here count as claim evidence')}
    </Checkbox>}
    {canAttach && <div className="mt-2 flex flex-wrap items-end gap-2">
      <SelectField label={t('extraDocument', 'Additional document')} placeholder={t('pick', 'Choose a document')}
        value={picked.extra ?? ''} onChange={(v) => setPicked((p) => ({ ...p, extra: v }))}
        options={eligible.map((d) => ({ value: d.id, label: d.title ?? d.id }))} />
      <Button variant="outline" size="sm" disabled={!picked.extra || attach.isPending}
        onClick={() => void run(() => attach.mutateAsync({ stepId: step.id, slotId: null, documentId: picked.extra }))}>
        {t('attachExtra', 'Attach additional document')}
      </Button>
    </div>}
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
        onClick={() => { setSkipError(null); setSkipping(true); }}>{t('skip', 'Skip')}</Button>}
      {skipping && <ReasonDialog open kind="return" maxLength={500} loading={skip.isPending} error={skipError}
        title={t('skipTitle', 'Skip {{item}}', { item: step.name })} label={t('skipLabel', 'Reason for skipping')}
        helper={t('skipHelp', 'Kept beside the step and in its history.')} confirmLabel={t('skipConfirm', 'Skip step')}
        onConfirm={(reason) => { setSkipError(null); skip.mutateAsync({ stepId: step.id, reason }).then(() => setSkipping(false), (err) => setSkipError(line(err))); }}
        onCancel={() => setSkipping(false)} />}
      {missingRequired && <p className="basis-full text-control text-muted-foreground">{t('needDocs', 'Attach every required document before marking this step done.')}</p>}
    </div>}
  </li>;
};

/** Add one step to this work order's own list (FR-WCE-001): a name, an optional owner role, and a place after the current step or later. */
const AddStepForm: React.FC<{ id: string; workOrderId: string; steps: WorkOrderStep[]; onClose: () => void; onError: (m: string | null) => void }> = ({
  id, workOrderId, steps, onClose, onError,
}) => {
  const { t } = useTranslation('billingSteps');
  const roleName = useBuiltInRoleName();
  const line = useRefusalLine();
  const { add } = useWorkOrderStepMutations();
  const places = stepInsertPlaces(steps);
  const [name, setName] = useState('');
  const [ownerKey, setOwnerKey] = useState('');
  const [afterPosition, setAfterPosition] = useState<number | null>(places[0]?.afterPosition ?? null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    onError(null);
    try {
      await add.mutateAsync({ workOrderId, afterPosition, step: { name: trimmed, ownerRoleKey: ownerKey || null } });
      onClose();
    } catch (err) { onError(line(err)); }
  };
  const roleOptions = [{ value: '', label: t('noOwner', 'Nobody in particular') }, ...FULL_ROLE_KEYS.map((k) => ({ value: k, label: roleName(k) }))];
  return <form id={id} aria-label={t('addStepLabel', 'Add a billing step')} className="mt-3 rounded-md border border-border p-3"
    onSubmit={(e) => void submit(e)}>
    <div className="flex flex-wrap items-end gap-3">
      <TextField label={t('stepName', 'Step name')} value={name} onChange={setName} maxLength={120} />
      <SelectField compact label={t('ownerRole', 'Owner role')} value={ownerKey} onChange={setOwnerKey} options={roleOptions} />
      {places.length > 1 && <SelectField compact label={t('position', 'Position')} value={afterPosition === null ? 'end' : String(afterPosition)}
        onChange={(v) => setAfterPosition(v === 'end' ? null : Number(v))}
        options={places.map((p) => ({ value: p.afterPosition === null ? 'end' : String(p.afterPosition), label: p.after === null ? t('atEnd', 'At the end') : t('afterStep', 'After {{step}}', { step: p.after }) }))} />}
      <Button type="submit" variant="outline" size="sm" disabled={name.trim() === '' || add.isPending}>{t('add', 'Add')}</Button>
      <Button variant="ghost" size="sm" onClick={onClose}>{t('cancel', 'Cancel')}</Button>
    </div>
  </form>;
};

/** Save this work order's list as a new template (FR-WCE-002): names in order with their owner roles, targets and checklist slots. */
const SaveTemplateModal: React.FC<{ workOrderId: string; steps: WorkOrderStep[]; onClose: () => void; onSaved: (name: string) => void }> = ({ workOrderId, steps, onClose, onSaved }) => {
  const { t } = useTranslation('billingSteps');
  const { saveWorkOrder } = useStepTemplateMutations();
  const refusalText = useRefusalText();
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      await saveWorkOrder.mutateAsync({ workOrderId, name: trimmed });
      onSaved(trimmed);
    } catch (err) {
      // A name an active template already uses is the templates table's unique index: say that, not "another record".
      const taken = (err as { code?: string } | null)?.code === '23505';
      const r = refusalText(err);
      setSubmitError(taken ? { headline: t('templateNameTaken', 'A template with this name already exists. Choose another name.') }
        : r.known ? { headline: r.headline, detail: r.detail || undefined } : classifyMutationError(err));
    }
  };
  return <EntityFormModal open width="sm" title={t('saveTemplateTitle', 'Save as template')} submitLabel={t('saveTemplate', 'Save template')}
    onSubmit={(e) => void submit(e)} onClose={onClose} loading={saveWorkOrder.isPending} dirty={dirty} submitError={submitError} submitDisabled={name.trim() === ''}>
    <TextField label={t('templateName', 'Template name')} value={name} onChange={(v) => { setName(v); setDirty(true); }} maxLength={120} />
    <p className="text-control text-muted-foreground">{t('templateSteps', '{{count}} steps, in this order, with their owner roles.', { count: steps.length })}</p>
  </EntityFormModal>;
};

const BillingStepsBody: React.FC<BillingStepsSectionProps> = ({ workOrderId, projectId, status, today: todayProp }) => {
  const orgDay = useOrgToday();
  const today = todayProp ?? orgDay;
  const { t } = useTranslation('billingSteps');
  const auth = useContext(AuthContext);
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const may = usePermission();
  const checklistEdit = useOrgSwitch('workOrderChecklist');
  const formId = useId();
  const query = useWorkOrderSteps(workOrderId);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const title = t('title', 'Billing steps');
  const issued = status === 'Issued';
  // Affordances only (the database is the authority): a person who runs billing steps may add a step; saving a template is Finance or an Admin.
  const checklistEnabled = checklistEdit.data === true;
  const canAdd = !viewOnly && issued && checklistEnabled && mayChangeStepList({ userId: auth?.currentUser?.id ?? null, builtInRoleKey: auth?.currentUser?.built_in_role ?? null, role: realRole });
  if (status === 'Draft') return null;
  if (query.isError) {
    return <RecordSection title={title}><ListState variant="error" title={t('loadError', "Couldn't load the billing steps")} onRetry={() => void query.refetch()} /></RecordSection>;
  }
  if (!query.data) return null;
  const steps = query.data;
  const left = steps.filter((s) => stepStatus(s) !== 'done' && stepStatus(s) !== 'skipped').length;
  const canSave = !viewOnly && checklistEnabled && steps.length > 0 && may('edit', 'billingStage');
  const actions = canAdd || canSave
    ? <span className="flex flex-wrap gap-2">
        {canAdd && <Button variant="outline" size="sm" aria-expanded={adding} aria-controls={adding ? formId : undefined}
          onClick={() => { setRefusal(null); setSaved(null); setAdding((v) => !v); }}>{t('addStep', 'Add step')}</Button>}
        {canSave && <Button variant="outline" size="sm" onClick={() => { setRefusal(null); setSaved(null); setSaving(true); }}>{t('saveAsTemplate', 'Save as template')}</Button>}
      </span>
    : undefined;
  return <RecordSection title={title} actions={actions}>
    {steps.length === 0
      ? <p className="text-control text-muted-foreground" data-testid="wo-billing-steps-empty">
          {t('empty', 'No billing steps to show. Steps are copied from the organisation\'s default billing step template when a work order is issued: an Admin or a Finance person chooses that template under billing step templates. If a list exists, it is not shown to your role.')}
        </p>
      : <>
        <p className="text-control text-muted-foreground" data-testid="wo-billing-steps-summary">
          {left > 0 ? t('left', '{{count}} steps not finished. This list does not block invoicing.', { count: left })
            : t('allDone', 'Every billing step is finished.')}
        </p>
        <ol aria-label={title} className="mt-3 divide-y divide-border" data-testid="wo-billing-steps">
          {steps.map((s) => <StepRow key={s.id} step={s} steps={steps} projectId={projectId} today={today} issued={issued} onError={setRefusal} />)}
        </ol>
      </>}
    {adding && canAdd && <AddStepForm id={formId} workOrderId={workOrderId} steps={steps} onClose={() => setAdding(false)} onError={setRefusal} />}
    {refusal && <p role="alert" className="mt-2 text-control text-destructive">{refusal}</p>}
    {saving && canSave && <SaveTemplateModal workOrderId={workOrderId} steps={steps} onClose={() => setSaving(false)} onSaved={(n) => { setSaved(n); setSaving(false); }} />}
    {saved && <p role="status" className="mt-2 text-control text-muted-foreground" data-testid="wo-billing-step-template-saved">
      {t('templateSaved', 'Saved as template "{{name}}".', { name: saved })}</p>}
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
