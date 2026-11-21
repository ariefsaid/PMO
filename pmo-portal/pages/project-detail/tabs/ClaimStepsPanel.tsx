import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { ReasonDialog } from '@/src/components/ui/ReasonDialog';
import { SelectField, TextField } from '@/src/components/ui/FormFields';
import { DateField } from '@/src/components/ui/DateField';
import { QueryClientGate } from '@/src/components/billing/QueryClientGate';
import { usePermission } from '@/src/auth/usePermission';
import { useClaimStepMutations, useStepTemplates } from '@/src/hooks/useBillingSteps';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import type { ClaimBillingStage } from '@/src/lib/db/billingStages';

/**
 * Edit one live claim's billing steps (#2680; docs/specs/claim-billing-steps.spec.md FR-CBS-011/050). Finance and Admin change the
 * list (rename, add, reorder, remove with a reason, load a template); a Project Manager sets only a step's owner role and target
 * date. The gate is UX only: the database functions are the authority and name their refusal, which is explained here.
 */
export interface ClaimStepsPanelProps {
  claimId: string;
  projectId: string;
  stages: ClaimBillingStage[];
  /** The claim is neither invoiced nor withdrawn. */
  open: boolean;
}

const REFUSALS: Record<string, [string, string]> = {
  'stage-not-editable': ['projectDetail.billing.steps.refusal.notEditable', 'A finished step cannot be changed.'],
  'claim-invoiced': ['projectDetail.billing.steps.refusal.invoiced', 'This claim has an invoice; its list of steps can no longer change.'],
  'claim-steps-started': ['projectDetail.billing.steps.refusal.started', 'This claim already has finished steps, so a template can no longer replace them.'],
  'claim-withdrawn': ['projectDetail.billing.steps.refusal.withdrawn', 'This claim was withdrawn.'],
  'template-not-found': ['projectDetail.billing.steps.refusal.templateGone', 'That template is no longer available.'],
  'template-empty': ['projectDetail.billing.steps.refusal.templateEmpty', 'That template has no steps.'],
  'step-reason-invalid': ['projectDetail.billing.steps.refusal.reason', 'Give a reason of 3 to 500 characters.'],
  'stage-name-missing': ['projectDetail.billing.steps.refusal.name', 'Name the step.'],
  'stages-shape': ['projectDetail.billing.steps.refusal.shape', 'A claim has at most 20 steps.'],
};

/** A step name edited in place; saved when the field loses focus and the name changed. */
const StepNameField: React.FC<{ name: string; label: string; onCommit: (name: string) => void }> = ({ name, label, onCommit }) => {
  const [value, setValue] = useState(name);
  return <TextField label={label} value={value} onChange={setValue}
    onBlur={() => { const v = value.trim(); if (v && v !== name) onCommit(v); else setValue(name); }} />;
};

const Panel: React.FC<ClaimStepsPanelProps> = ({ claimId, projectId, stages, open }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const roles = useRoleOptions();
  const { update, add, remove, move, loadTemplate } = useClaimStepMutations(claimId, projectId);
  const canEditList = open && may('edit', 'billingStage');
  const canAssign = open && may('transition', 'billingStage');
  const finished = stages.filter((s) => s.completedOn || s.skippedOn);
  const openSteps = stages.filter((s) => !s.completedOn && !s.skippedOn);
  const untouched = finished.length === 0;
  const [expanded, setExpanded] = useState(false);
  const templates = useStepTemplates(canEditList && untouched && expanded);
  const [removing, setRemoving] = useState<ClaimBillingStage | null>(null);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (!canEditList && !canAssign) return null;
  if (openSteps.length === 0 && !canEditList) return null;

  const explain = (err: unknown): string => {
    const known = REFUSALS[(err as { code?: string } | null)?.code ?? ''];
    return known ? t(known[0], known[1]) : t('projectDetail.billing.steps.refusal.generic', 'The step could not be saved. Try again.');
  };
  const run = async (p: Promise<unknown>) => {
    setMessage(null);
    try { await p; return true; } catch (err) { setMessage(explain(err)); return false; }
  };
  const roleOptions = [{ value: '', label: t('projectDetail.billing.steps.noOwner', 'Nobody in particular') }, ...roles.options];
  const lastFinished = finished.length;

  return <div className="mt-3">
    <Button variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
      {expanded ? t('projectDetail.billing.steps.hide', 'Hide step editor') : t('projectDetail.billing.steps.edit', 'Edit steps')}
    </Button>
    {expanded && <div className="mt-3 rounded-md border border-border p-3" role="group" aria-label={t('projectDetail.billing.steps.editorLabel', 'Edit billing steps')}>
      <p className="text-sm text-muted-foreground">{canEditList
        ? t('projectDetail.billing.steps.help', 'Changes apply to this claim only. Finished steps stay as they are.')
        : t('projectDetail.billing.steps.helpAssign', "Set who is responsible for a step and its target date. Finance or an Admin changes the list itself.")}</p>
      {message && <p role="alert" className="mt-2 text-sm text-destructive">{message}</p>}
      {canEditList && untouched && <div className="mt-3 flex flex-wrap items-end gap-2">
        <SelectField compact label={t('projectDetail.billing.steps.template', 'Template')} value={templateId} onChange={setTemplateId}
          placeholder={t('projectDetail.billing.steps.pickTemplate', 'Choose a template')}
          options={(templates.data ?? []).map((tpl) => ({ value: tpl.id, label: tpl.name }))} />
        <Button variant="outline" size="sm" disabled={!templateId || loadTemplate.isPending}
          onClick={() => void run(loadTemplate.mutateAsync(templateId)).then((ok) => { if (ok) setTemplateId(''); })}>
          {t('projectDetail.billing.steps.load', 'Replace steps with template')}
        </Button>
      </div>}
      <ol className="mt-3 divide-y divide-border">
        {openSteps.map((step, i) => <li key={step.id} aria-label={step.name} className="py-3">
          <div className="flex flex-wrap items-end gap-3">
            {canEditList
              ? <StepNameField key={`${step.id}-${step.name}`} name={step.name} label={t('projectDetail.billing.steps.name', 'Step name')}
                  onCommit={(v) => void run(update.mutateAsync({ stageId: step.id, patch: { name: v } }))} />
              : <span className="font-medium">{step.name}</span>}
            <SelectField compact label={t('projectDetail.billing.steps.owner', 'Owner role')} value={step.ownerRole ?? ''}
              options={roleOptions}
              onChange={(v) => void run(update.mutateAsync({ stageId: step.id, patch: { ownerRole: v === '' ? null : v } }))} />
            <DateField compact label={t('projectDetail.billing.steps.targetDate', 'Target date')} value={step.targetOn ?? ''}
              onChange={(v) => void run(update.mutateAsync({ stageId: step.id, patch: { targetOn: v === '' ? null : v } }))} />
            {canEditList && <span className="ml-auto flex gap-2">
              {i > 0 && <Button variant="outline" size="sm" aria-label={t('projectDetail.billing.steps.moveUp', 'Move {{step}} up', { step: step.name })}
                onClick={() => void run(move.mutateAsync({ stageId: step.id, position: lastFinished + i }))}>{t('projectDetail.billing.steps.up', 'Up')}</Button>}
              {i < openSteps.length - 1 && <Button variant="outline" size="sm" aria-label={t('projectDetail.billing.steps.moveDown', 'Move {{step}} down', { step: step.name })}
                onClick={() => void run(move.mutateAsync({ stageId: step.id, position: lastFinished + i + 2 }))}>{t('projectDetail.billing.steps.down', 'Down')}</Button>}
              <Button variant="outline" size="sm" aria-label={t('projectDetail.billing.steps.removeNamed', 'Remove {{step}}', { step: step.name })}
                onClick={() => { setRemoveError(null); setRemoving(step); }}>{t('projectDetail.billing.steps.remove', 'Remove')}</Button>
            </span>}
          </div>
        </li>)}
      </ol>
      {canEditList && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        const name = newName.trim();
        if (!name) return;
        void run(add.mutateAsync({ afterPosition: stages.length, step: { name } })).then((ok) => { if (ok) setNewName(''); });
      }}>
        <TextField label={t('projectDetail.billing.steps.newName', 'New step')} value={newName} onChange={setNewName} />
        <Button type="submit" variant="outline" size="sm" disabled={newName.trim() === '' || add.isPending}>{t('projectDetail.billing.steps.add', 'Add step')}</Button>
      </form>}
    </div>}
    {removing && <ReasonDialog open kind="return" maxLength={500} loading={remove.isPending} error={removeError}
      title={t('projectDetail.billing.steps.removeTitle', 'Remove {{step}}', { step: removing.name })}
      label={t('projectDetail.billing.steps.removeLabel', 'Reason')}
      helper={t('projectDetail.billing.steps.removeHelp', 'Kept with the claim. The invoice no longer waits for this step, and it cannot be undone.')}
      confirmLabel={t('projectDetail.billing.steps.removeConfirm', 'Remove step')}
      onConfirm={(reason) => {
        setRemoveError(null);
        remove.mutateAsync({ stageId: removing.id, reason }).then(() => setRemoving(null)).catch((err: unknown) => setRemoveError(explain(err)));
      }}
      onCancel={() => setRemoving(null)} />}
  </div>;
};

export const ClaimStepsPanel: React.FC<ClaimStepsPanelProps> = (props) => (
  <QueryClientGate><Panel {...props} /></QueryClientGate>
);

export default ClaimStepsPanel;
