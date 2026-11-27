import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, type SubmitError } from '@/src/components/ui/EntityFormModal';
import { Button } from '@/src/components/ui/Button';
import { ListState } from '@/src/components/ui';
import { Checkbox } from '@/src/components/ui/Checkbox';
import { SelectField, TextArea, TextField } from '@/src/components/ui/FormFields';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useDefaultStepTemplate, useStepTemplateMutations, useStepTemplates } from '@/src/hooks/useBillingSteps';
import { BUILT_IN_ROLES } from '@/src/auth/builtInRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { useRefusalLine, useRefusalText } from '@/src/lib/refusals';
import { useRoleOptions } from '@/src/hooks/useRoleOptions';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import type { StepInput, StepTemplate } from '@/src/lib/db/billingSteps';

/**
 * The organisation's billing step templates (#2680, docs/specs/claim-billing-steps.spec.md FR-CBS-001/051): named lists of steps a
 * client's team defines themselves (step names, owner roles, target days, documents). Nothing is supplied by PMO. Finance or an
 * Admin writes; loading a template onto a project or a claim copies it, so editing a template later changes nothing already made.
 */
interface Row { key: number; templateStepId?: string; claimEvidenceEnabled: boolean; name: string; ownerRole: string; ownerRoleKey: string; hiddenFrom: string[]; target: string; clientSide: boolean; optionalStep: boolean; invoiceStep: boolean; required: string; optional: string }
/** Field accounts own no step and are never named in a hidden-from list: the database refuses them, so they are not offered. */
const FULL_ROLE_KEYS = BUILT_IN_ROLES.filter((r) => r.tier !== 'field').map((r) => r.key);

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const toRow = (s: StepTemplate['steps'][number], key: number): Row => ({
  key, templateStepId: s.templateStepId, claimEvidenceEnabled: s.claimEvidenceEnabled === true, name: s.name, ownerRole: s.ownerRole ?? '', ownerRoleKey: s.ownerRoleKey ?? '', hiddenFrom: s.hiddenFromRoleKeys ?? [], target: s.targetDays == null ? '' : String(s.targetDays), clientSide: Boolean(s.clientSide),
  optionalStep: Boolean(s.optional), invoiceStep: Boolean(s.invoiceStep), required: (s.documents ?? []).filter((d) => d.required).map((d) => d.name).join('\n'),
  optional: (s.documents ?? []).filter((d) => !d.required).map((d) => d.name).join('\n'),
});
const toStep = (r: Row): StepInput => ({
  name: r.name.trim(), ownerRole: r.ownerRole === '' ? null : r.ownerRole,
  ...(r.templateStepId ? { templateStepId: r.templateStepId, claimEvidenceEnabled: r.claimEvidenceEnabled } : r.claimEvidenceEnabled ? { claimEvidenceEnabled: true } : {}),
  ownerRoleKey: r.ownerRoleKey === '' ? null : r.ownerRoleKey, hiddenFromRoleKeys: r.hiddenFrom, targetDays: r.target.trim() === '' ? null : Number(r.target),
  clientSide: r.clientSide, optional: r.optionalStep, ...(r.invoiceStep ? { invoiceStep: true } : {}),
  documents: [...lines(r.required).map((name) => ({ name, required: true })), ...lines(r.optional).map((name) => ({ name, required: false }))],
});
const validTarget = (v: string) => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 365);

const TemplateForm: React.FC<{ template: StepTemplate | null; onClose: () => void }> = ({ template, onClose }) => {
  const { t } = useTranslation('project');
  const { realRole, effectiveRole } = useEffectiveRole();
  const may = usePermission();
  const roles = useRoleOptions();
  const roleName = useBuiltInRoleName();
  const refusalText = useRefusalText();
  const { save } = useStepTemplateMutations();
  const nextKey = useRef(0);
  const [name, setName] = useState(template?.name ?? '');
  const [rows, setRows] = useState<Row[]>(() => (template?.steps ?? []).map((s) => toRow(s, nextKey.current++)));
  const [errors, setErrors] = useState<{ name?: boolean; steps?: boolean; targets?: boolean }>({});
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [dirty, setDirty] = useState(false);
  const update = (key: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); setDirty(true); };
  // One invoice step per list: marking a step clears the mark elsewhere.
  const markInvoiceStep = (key: number, on: boolean) => { setRows((rs) => rs.map((r) => ({ ...r, invoiceStep: r.key === key ? on : on ? false : r.invoiceStep }))); setDirty(true); };
  const roleOptions = [{ value: '', label: t('projectDetail.billing.steps.noOwner', 'Nobody in particular') }, ...roles.options];
  const keyOptions = [{ value: '', label: t('projectDetail.billing.steps.noOwner', 'Nobody in particular') }, ...FULL_ROLE_KEYS.map((k) => ({ value: k, label: roleName(k) }))];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = { name: name.trim() === '', steps: rows.length === 0 || rows.some((r) => r.name.trim() === ''), targets: rows.some((r) => !validTarget(r.target)) };
    setErrors(next);
    if (next.name || next.steps || next.targets) return;
    try {
      await save.mutateAsync({ templateId: template?.id ?? null, name: name.trim(), steps: rows.map(toStep) });
      onClose();
    } catch (err) {
      const r = refusalText(err);
      setSubmitError(r.known ? { headline: r.headline, detail: r.detail || undefined } : classifyMutationError(err));
    }
  };

  return <EntityFormModal open width="lg" title={template ? t('projectDetail.billing.templates.editTitle', 'Edit template') : t('projectDetail.billing.templates.newTitle', 'New template')}
    submitLabel={t('projectDetail.billing.templates.save', 'Save template')} onSubmit={(e) => void submit(e)} onClose={onClose}
    loading={save.isPending} dirty={dirty} submitError={submitError}>
    <TextField label={t('projectDetail.billing.templates.name', 'Template name')} value={name} onChange={(v) => { setName(v); setDirty(true); }}
      error={errors.name ? t('projectDetail.billing.templates.nameMissing', 'Name the template.') : undefined} />
    {errors.steps && <p role="alert" className="mt-2 text-sm text-destructive">{t('projectDetail.billing.templates.stepsMissing', 'Add at least one step and name every step.')}</p>}
    <ol className="mt-3 space-y-4">
      {rows.map((row, index) => <li key={row.key}>
        <fieldset aria-label={t('projectDetail.billing.terms.stageN', 'Stage {{n}}', { n: index + 1 })} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <TextField label={t('projectDetail.billing.templates.stepName', 'Step name')} value={row.name} onChange={(v) => update(row.key, { name: v })} />
            <SelectField compact label={t('projectDetail.billing.steps.owner', 'Owner role')} value={row.ownerRole} options={roleOptions} onChange={(v) => update(row.key, { ownerRole: v })} />
            <TextField inputMode="numeric" label={t('projectDetail.billing.terms.targetDays', 'Target (days)')} value={row.target} onChange={(v) => update(row.key, { target: v })}
              error={errors.targets && !validTarget(row.target) ? t('projectDetail.billing.terms.targetInvalid', 'Enter 1 to 365 days, or leave it empty.') : undefined} />
            <span className="ml-auto flex gap-2">
              {index > 0 && <Button type="button" variant="outline" size="sm" aria-label={t('projectDetail.billing.terms.moveUp', 'Move {{stage}} up', { stage: row.name || index + 1 })}
                onClick={() => { setRows((rs) => { const a = [...rs]; [a[index - 1], a[index]] = [a[index], a[index - 1]]; return a; }); setDirty(true); }}>{t('projectDetail.billing.terms.up', 'Up')}</Button>}
              <Button type="button" variant="outline" size="sm" aria-label={t('projectDetail.billing.terms.remove', 'Remove {{stage}}', { stage: row.name || index + 1 })}
                onClick={() => { setRows((rs) => rs.filter((r) => r.key !== row.key)); setDirty(true); }}>{t('projectDetail.billing.terms.removeShort', 'Remove')}</Button>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <SelectField compact label={t('projectDetail.billing.steps.workOrderOwner', 'Owner on a work order')} value={row.ownerRoleKey} options={keyOptions}
              onChange={(v) => update(row.key, { ownerRoleKey: v })} />
            <SelectField compact label={t('projectDetail.billing.steps.hideFrom', 'Hide this step from a role')} value="" placeholder={t('projectDetail.billing.steps.hidePick', 'Choose a role')}
              options={FULL_ROLE_KEYS.filter((k) => !row.hiddenFrom.includes(k)).map((k) => ({ value: k, label: roleName(k) }))}
              onChange={(v) => { if (v) update(row.key, { hiddenFrom: [...row.hiddenFrom, v] }); }} />
          </div>
          {row.hiddenFrom.length > 0 && <ul className="mt-2 flex flex-wrap gap-2 text-sm" aria-label={t('projectDetail.billing.steps.hiddenList', 'Hidden from')}>
            {row.hiddenFrom.map((k) => <li key={k} className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
              {t('projectDetail.billing.steps.hiddenFrom', 'Hidden from {{role}}', { role: roleName(k) })}
              <Button type="button" variant="outline" size="sm" aria-label={t('projectDetail.billing.steps.unhide', 'Show to {{role}} again', { role: roleName(k) })}
                onClick={() => update(row.key, { hiddenFrom: row.hiddenFrom.filter((x) => x !== k) })}>{t('projectDetail.billing.terms.removeShort', 'Remove')}</Button>
            </li>)}
          </ul>}
          <div className="mt-3 flex flex-wrap gap-4">
            <Checkbox checked={row.claimEvidenceEnabled} disabled={!may('manage', 'orgAccounting') || effectiveRole !== realRole}
              onChange={(v) => update(row.key, { claimEvidenceEnabled: v })}
              label={t('projectDetail.billing.templates.claimEvidence', 'Documents here count as claim evidence')}>
              {t('projectDetail.billing.templates.claimEvidence', 'Documents here count as claim evidence')}
            </Checkbox>
            <Checkbox checked={row.clientSide} onChange={(v) => update(row.key, { clientSide: v })} label={t('projectDetail.billing.stages.clientSide', "In the client's system")}>
              {t('projectDetail.billing.stages.clientSide', "In the client's system")}
            </Checkbox>
            <Checkbox checked={row.optionalStep} onChange={(v) => update(row.key, { optionalStep: v })} label={t('projectDetail.billing.terms.optionalStage', 'Optional stage')}>
              {t('projectDetail.billing.terms.optionalStage', 'Optional stage')}
            </Checkbox>
            <Checkbox checked={row.invoiceStep} onChange={(v) => markInvoiceStep(row.key, v)} label={t('projectDetail.billing.terms.invoiceStep', 'Invoice is raised at this step')}>
              {t('projectDetail.billing.terms.invoiceStep', 'Invoice is raised at this step')}
            </Checkbox>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TextArea rows={2} label={t('projectDetail.billing.terms.required', 'Required documents, one per line')} value={row.required} onChange={(v) => update(row.key, { required: v })} />
            <TextArea rows={2} label={t('projectDetail.billing.terms.optional', 'Optional documents, one per line')} value={row.optional} onChange={(v) => update(row.key, { optional: v })} />
          </div>
        </fieldset>
      </li>)}
    </ol>
    <Button type="button" variant="outline" size="sm" className="mt-3"
      onClick={() => { setRows((rs) => [...rs, { key: nextKey.current++, claimEvidenceEnabled: false, name: '', ownerRole: '', ownerRoleKey: '', hiddenFrom: [], target: '', clientSide: false, optionalStep: false, invoiceStep: false, required: '', optional: '' }]); setDirty(true); }}>
      {t('projectDetail.billing.templates.addStep', 'Add step')}
    </Button>
  </EntityFormModal>;
};

/**
 * The templates modal opens from inside another modal's form (the project's Billing terms). A React synthetic `submit` bubbles through
 * a portal to its React ancestors, so saving a template here would submit and close that outer form too. This wrapper stops the event
 * at the boundary: an inner save or Done never reaches the outer form.
 */
const SubmitBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="contents" onSubmit={(e) => e.stopPropagation()}>{children}</div>
);

export const BillingStepTemplatesModal: React.FC<{ onClose: () => void }> = (props) => <SubmitBoundary><BillingStepTemplatesModalBody {...props} /></SubmitBoundary>;

const BillingStepTemplatesModalBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('project');
  const roles = useRoleOptions();
  const templates = useStepTemplates();
  const { archive } = useStepTemplateMutations();
  const defaults = useDefaultStepTemplate();
  const line = useRefusalLine();
  const [editing, setEditing] = useState<StepTemplate | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (editing) return <TemplateForm template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;
  return <EntityFormModal open width="lg" title={t('projectDetail.billing.templates.title', 'Billing step templates')}
    hideSubmit cancelLabel={t('common.close', 'Close')} submitLabel={t('common.close', 'Close')} onSubmit={(e) => { e.preventDefault(); onClose(); }} onClose={onClose}>
    {(templates.data?.length ?? 0) > 0 && <p className="text-sm text-muted-foreground">{t('projectDetail.billing.templates.help', "A template is a list of steps your team uses. Load one onto a project or a claim; it is copied, so later edits to a template change nothing already made.")}</p>}
    {templates.isError && <p className="mt-2 text-sm text-muted-foreground" role="status">{t('projectDetail.billing.templates.loadError', 'The templates could not be loaded.')}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    {defaults.query.isPending && <ListState variant="loading" rows={1} />}
    {defaults.query.isError && <ListState variant="error" title={t('projectDetail.billing.templates.loadError', 'The templates could not be loaded.')} onRetry={() => void defaults.query.refetch()} />}
    {!templates.isPending && !templates.isError && (templates.data?.length ?? 0) === 0 && <p className="mt-3 text-sm text-muted-foreground">{t('projectDetail.billing.templates.empty', 'No templates yet.')}</p>}
    <ul className="mt-3 divide-y divide-border">
      {(templates.data ?? []).map((tpl) => <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <span>
          <span className="font-medium">{tpl.name}</span>
          <span className="ml-2 text-sm text-muted-foreground">
            {t('projectDetail.billing.templates.steps', '{{count}} steps', { count: tpl.steps.length })}
            {tpl.steps.some((s) => s.ownerRole) ? ` · ${[...new Set(tpl.steps.map((s) => s.ownerRole).filter(Boolean))].map((r) => roles.label(r)).join(', ')}` : ''}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {defaults.query.data === tpl.id
            ? <>
                <span className="text-sm font-medium" data-testid="default-step-template">{t('projectDetail.billing.templates.isDefault', 'Used for new work orders')}</span>
                <Button type="button" variant="outline" size="sm" disabled={defaults.set.isPending || defaults.query.isPending || defaults.query.isError} aria-label={t('projectDetail.billing.templates.clearDefaultNamed', 'Stop using {{name}} for new work orders', { name: tpl.name })}
                  onClick={() => { setError(null); defaults.set.mutateAsync(null).catch((e: unknown) => setError(line(e))); }}>{t('projectDetail.billing.templates.clearDefault', 'Stop using')}</Button>
              </>
            : <Button type="button" variant="outline" size="sm" disabled={defaults.set.isPending || defaults.query.isPending || defaults.query.isError} aria-label={t('projectDetail.billing.templates.useDefaultNamed', 'Use {{name}} for new work orders', { name: tpl.name })}
                onClick={() => { setError(null); defaults.set.mutateAsync(tpl.id).catch((e: unknown) => setError(line(e))); }}>{t('projectDetail.billing.templates.useDefault', 'Use for new work orders')}</Button>}
          <Button type="button" variant="outline" size="sm" aria-label={t('projectDetail.billing.templates.editNamed', 'Edit {{name}}', { name: tpl.name })} onClick={() => setEditing(tpl)}>{t('projectDetail.billing.templates.edit', 'Edit')}</Button>
          <Button type="button" variant="outline" size="sm" aria-label={t('projectDetail.billing.templates.archiveNamed', 'Archive {{name}}', { name: tpl.name })}
            disabled={archive.isPending}
            onClick={() => { setError(null); archive.mutateAsync(tpl.id).catch(() => setError(t('projectDetail.billing.templates.archiveError', 'The template could not be archived.'))); }}>
            {t('projectDetail.billing.templates.archive', 'Archive')}
          </Button>
        </span>
      </li>)}
    </ul>
    <Button type="button" variant="primary" size="sm" className="mt-3" onClick={() => setEditing('new')}>{t('projectDetail.billing.templates.new', 'New template')}</Button>
  </EntityFormModal>;
};

export default BillingStepTemplatesModal;
