import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, type SubmitError } from '@/src/components/ui/EntityFormModal';
import { Button } from '@/src/components/ui/Button';
import { ConfirmDialog, ListState } from '@/src/components/ui';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { SelectField, TextArea, TextField, FieldError } from '@/src/components/ui/FormFields';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useLoadTemplateOntoProject, useStepTemplates } from '@/src/hooks/useBillingSteps';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { BillingStepTemplatesModal } from './BillingStepTemplatesModal';
import { useProjectBillingTerms, useSaveBillingTerms } from '@/src/hooks/useBillingStages';
import type { StageTemplateInput } from '@/src/lib/db/billingStages';

/**
 * The project's billing terms (#2522, #1572): the ordered billing stages each new progress claim must pass, the monthly
 * invoice deadline and the retention percentage. Finance/Admin only; the database refuses anyone else. Claims already made
 * keep the stage plan they were made with.
 */
interface StageRow { key: number; ownerRole: string; name: string; clientSide: boolean; required: string; optional: string; target: string; optionalStage: boolean }

const toRow = (s: StageTemplateInput, key: number): StageRow => ({
  key, ownerRole: s.ownerRole ?? '', name: s.name, clientSide: s.clientSide, target: s.targetDays == null ? '' : String(s.targetDays), optionalStage: Boolean(s.optional),
  required: s.documents.filter((d) => d.required).map((d) => d.name).join('\n'),
  optional: s.documents.filter((d) => !d.required).map((d) => d.name).join('\n'),
});
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const toStage = (r: StageRow): StageTemplateInput => ({
  name: r.name.trim(), clientSide: r.clientSide, ...(r.ownerRole ? { ownerRole: r.ownerRole } : {}),
  ...(r.target.trim() === '' ? {} : { targetDays: Number(r.target) }), ...(r.optionalStage ? { optional: true } : {}),
  documents: [...lines(r.required).map((name) => ({ name, required: true })), ...lines(r.optional).map((name) => ({ name, required: false }))],
});

/** Load an organisation template onto the project's list, or open the template manager (#2680). Absent without a data layer. */
const TemplateTools: React.FC<{ projectId: string; dirty: boolean; onLoaded: () => void }> = ({ projectId, dirty, onLoaded }) => {
  const { t } = useTranslation('project');
  const templates = useStepTemplates();
  const load = useLoadTemplateOntoProject(projectId);
  const [picked, setPicked] = useState('');
  const [managing, setManaging] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const replace = () => { setConfirming(false); setFailed(false); load.mutateAsync(picked).then(() => { setPicked(''); onLoaded(); }).catch(() => setFailed(true)); };
  return <div className="mt-3 flex flex-wrap items-end gap-2">
    <SelectField compact label={t('projectDetail.billing.steps.template', 'Template')} value={picked} onChange={setPicked}
      placeholder={t('projectDetail.billing.steps.pickTemplate', 'Choose a template')}
      options={(templates.data ?? []).map((tpl) => ({ value: tpl.id, label: tpl.name }))} />
    <Button type="button" variant="outline" size="sm" disabled={!picked || load.isPending}
      onClick={() => { if (dirty) setConfirming(true); else replace(); }}>
      {t('projectDetail.billing.steps.loadTemplateTerms', 'Replace stages with template')}
    </Button>
    <Button type="button" variant="outline" size="sm" onClick={() => setManaging(true)}>{t('projectDetail.billing.templates.manage', 'Manage templates')}</Button>
    <p className="w-full text-sm text-muted-foreground">{t('projectDetail.billing.steps.loadTemplateTermsHelp', 'Replaces the saved stages immediately. Other changes use Save billing terms.')}</p>
    {failed && <p role="alert" className="w-full text-sm text-destructive">{t('projectDetail.billing.steps.loadTemplateError', 'The template could not be loaded.')}</p>}
    {managing && <BillingStepTemplatesModal onClose={() => setManaging(false)} />}
    <ConfirmDialog open={confirming} tone="destructive" title={t('common:entityForm.discardTitle', 'Discard your changes?')} description={t('common:entityForm.discardBody', 'This form has unsaved changes. Discarding will lose them.')}
      confirmLabel={t('common:entityForm.discard', 'Discard')} cancelLabel={t('common:entityForm.keepEditing', 'Keep editing')} onConfirm={replace} onCancel={() => setConfirming(false)} />
  </div>;
};

export const BillingTermsModal: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { t } = useTranslation('project');
  const roles = useRoleOptions();
  const query = useProjectBillingTerms(projectId);
  const save = useSaveBillingTerms(projectId);
  const nextKey = useRef(0);
  const [rows, setRows] = useState<StageRow[] | null>(null);
  const [day, setDay] = useState('');
  const [warn, setWarn] = useState('5');
  const [retention, setRetention] = useState('0');
  const [errors, setErrors] = useState<{ day?: boolean; warn?: boolean; retention?: boolean; names?: boolean; targets?: boolean }>({});
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (rows !== null || !query.data) return;
    setRows(query.data.stages.map((s) => toRow(s, nextKey.current++)));
    const terms = query.data.terms;
    if (terms) { setDay(terms.deadlineDay == null ? '' : String(terms.deadlineDay)); setWarn(String(terms.warnDays)); setRetention(String(terms.retentionPct)); }
  }, [query.data, rows]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };
  const update = (key: number, patch: Partial<StageRow>) => { setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r))); setDirty(true); };
  const move = (index: number) => { setRows((rs) => { const a = [...(rs ?? [])]; [a[index - 1], a[index]] = [a[index], a[index - 1]]; return a; }); setDirty(true); };
  const remove = (key: number) => { setRows((rs) => (rs ?? []).filter((r) => r.key !== key)); setDirty(true); };
  const add = () => { setRows((rs) => [...(rs ?? []), { key: nextKey.current++, ownerRole: '', name: '', clientSide: false, required: '', optional: '', target: '', optionalStage: false }]); setDirty(true); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rows === null || query.isError || query.isPending) return;
    const dayNum = day.trim() === '' ? null : Number(day);
    const warnNum = Number(warn);
    const pct = Number(retention.replace(',', '.'));
    const next = {
      day: dayNum !== null && !(Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31),
      warn: !(Number.isInteger(warnNum) && warnNum >= 0 && warnNum <= 27),
      retention: !(Number.isFinite(pct) && pct >= 0 && pct < 100 && /^\d+(?:[.,]\d{1,2})?$/.test(retention.trim())),
      names: (rows ?? []).some((r) => r.name.trim() === ''),
      targets: (rows ?? []).some((r) => r.target.trim() !== '' && !(/^\d+$/.test(r.target.trim()) && Number(r.target) >= 1 && Number(r.target) <= 365)),
    };
    setErrors(next);
    if (next.day || next.warn || next.retention || next.names || next.targets) return;
    try {
      await save.mutateAsync({ stages: (rows ?? []).map(toStage), deadlineDay: dayNum, warnDays: warnNum, retentionPct: pct });
      onClose();
    } catch (err) {
      setSubmitError(classifyMutationError(err));
    }
  };

  return <EntityFormModal open width="lg" title={t('projectDetail.billing.terms.title', 'Billing terms')}
    submitLabel={t('projectDetail.billing.terms.save', 'Save billing terms')}
    onSubmit={(e) => void submit(e)} onClose={onClose} loading={save.isPending} dirty={dirty} submitError={submitError}
    submitDisabled={rows === null || query.isError || query.isPending}>
    {query.isError && <ListState variant="error" title={t('projectDetail.billing.terms.loadError', 'The billing terms could not be loaded.')} onRetry={() => void query.refetch()} />}
    {query.isPending && <ListState variant="loading" rows={3} />}
    <fieldset disabled={rows === null || query.isError || query.isPending}>
    <h3 className="text-group font-semibold">{t('projectDetail.billing.terms.stagesTitle', 'Billing stages')}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{t('projectDetail.billing.terms.stagesHelp', 'Each new progress claim must complete these stages, in order, before its invoice can be raised.')}</p>
    <TemplateTools projectId={projectId} dirty={dirty} onLoaded={() => { setRows(null); setDirty(false); }} />
    <ol className="mt-3 space-y-4">
      {(rows ?? []).map((row, index) => (
        <li key={row.key}>
          <fieldset aria-label={t('projectDetail.billing.terms.stageN', 'Stage {{n}}', { n: index + 1 })} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <TextField label={t('projectDetail.billing.terms.stageName', 'Stage name')} value={row.name} onChange={(v) => update(row.key, { name: v })}
                error={errors.names && row.name.trim() === '' ? t('projectDetail.billing.terms.nameMissing', 'Name the stage.') : undefined} />
              <Checkbox checked={row.clientSide} onChange={(v) => update(row.key, { clientSide: v })}
                label={t('projectDetail.billing.stages.clientSide', "In the client's system")}>
                {t('projectDetail.billing.stages.clientSide', "In the client's system")}
              </Checkbox>
              <span className="ml-auto flex gap-2">
                {index > 0 && <Button type="button" variant="outline" size="sm" onClick={() => move(index)}
                  aria-label={t('projectDetail.billing.terms.moveUp', 'Move {{stage}} up', { stage: row.name || index + 1 })}>{t('projectDetail.billing.terms.up', 'Up')}</Button>}
                <Button type="button" variant="outline" size="sm" onClick={() => remove(row.key)}
                  aria-label={t('projectDetail.billing.terms.remove', 'Remove {{stage}}', { stage: row.name || index + 1 })}>{t('projectDetail.billing.terms.removeShort', 'Remove')}</Button>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <TextField inputMode="numeric" label={t('projectDetail.billing.terms.targetDays', 'Target (days)')} value={row.target} onChange={(v) => update(row.key, { target: v })}
                error={errors.targets && row.target.trim() !== '' && !(/^\d+$/.test(row.target.trim()) && Number(row.target) >= 1 && Number(row.target) <= 365)
                  ? t('projectDetail.billing.terms.targetInvalid', 'Enter 1 to 365 days, or leave it empty.') : undefined} />
              <SelectField compact label={t('projectDetail.billing.steps.owner', 'Owner role')} value={row.ownerRole}
                options={[{ value: '', label: t('projectDetail.billing.steps.noOwner', 'Nobody in particular') }, ...roles.options]}
                onChange={(v) => update(row.key, { ownerRole: v })} />
              <Checkbox checked={row.optionalStage} onChange={(v) => update(row.key, { optionalStage: v })}
                label={t('projectDetail.billing.terms.optionalStage', 'Optional stage')}>
                {t('projectDetail.billing.terms.optionalStage', 'Optional stage')}
              </Checkbox>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextArea rows={2} label={t('projectDetail.billing.terms.required', 'Required documents, one per line')} value={row.required} onChange={(v) => update(row.key, { required: v })} />
              <TextArea rows={2} label={t('projectDetail.billing.terms.optional', 'Optional documents, one per line')} value={row.optional} onChange={(v) => update(row.key, { optional: v })} />
            </div>
          </fieldset>
        </li>
      ))}
    </ol>
    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={add}>{t('projectDetail.billing.terms.add', 'Add stage')}</Button>

    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      <div>
        <TextField inputMode="numeric" label={t('projectDetail.billing.terms.deadlineDay', 'Invoice deadline (day of month)')} value={day} onChange={touch(setDay)} />
        {errors.day && <FieldError>{t('projectDetail.billing.terms.deadlineInvalid', 'Enter a day from 1 to 31, or leave it empty.')}</FieldError>}
      </div>
      <div>
        <TextField inputMode="numeric" label={t('projectDetail.billing.terms.warnDays', 'Warn this many days ahead')} value={warn} onChange={touch(setWarn)} />
        {errors.warn && <FieldError>{t('projectDetail.billing.terms.warnInvalid', 'Enter 0 to 27 days.')}</FieldError>}
      </div>
      <div>
        <TextField inputMode="decimal" label={t('projectDetail.billing.terms.retention', 'Retention (%)')} value={retention} onChange={touch(setRetention)} />
        {errors.retention && <FieldError>{t('projectDetail.billing.terms.retentionInvalid', 'Enter a percentage from 0 to under 100 with at most 2 decimal places.')}</FieldError>}
      </div>
    </div>
    <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.terms.retentionHelp', 'Retention is held from each new progress claim; the invoice and its VAT stay at full value.')}</p>
    </fieldset>
  </EntityFormModal>;
};

export default BillingTermsModal;
