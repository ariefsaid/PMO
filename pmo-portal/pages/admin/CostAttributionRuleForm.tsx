import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Combobox,
  EntityFormModal,
  FormGrid,
  FormSection,
  SelectField,
  StatusPill,
  TextField,
  useEntityForm,
  type ComboboxOption,
  type SubmitError,
} from '@/src/components/ui';
import { formatCurrencyCents, formatMonthYear } from '@/src/lib/format';
import { useRuleErrorCopy } from './useRuleErrorCopy';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import {
  previewCostAttribution,
  saveCostAttributionRule,
  type CostAttributionPreviewRow,
  type CostAttributionRule,
} from '@/src/lib/repositories/costAttribution';
import {
  EMPTY_RULE_VALUES,
  toDraft,
  validateRule,
  valuesFromRule,
  type RuleFormErrorCode,
  type RuleFormValues,
} from './costAttributionDraft';

interface Props {
  /** The rule being edited (saves a new version of it), or null for a new rule. */
  rule: CostAttributionRule | null;
  projects: ComboboxOption[];
  currency: string;
  onClose: () => void;
  /** Called after a successful save and after a stale refusal — the list must be re-read either way. */
  onChanged: () => void;
}

const CostAttributionRuleForm: React.FC<Props> = ({ rule, projects, currency, onClose, onChanged }) => {
  const { t } = useTranslation();
  const toError = useRuleErrorCopy();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);

  const errorText = (code?: RuleFormErrorCode): string | undefined => {
    switch (code) {
      case 'required': return t('costAttribution:form.required', 'This is required.');
      case 'before-from': return t('costAttribution:form.beforeFrom', 'Cannot be earlier than the day before the start date.');
      case 'party-type-needs-party': return t('costAttribution:form.partyNeeded', 'Enter the party, or clear the party type.');
      case 'no-project': return t('costAttribution:form.noProject', 'Pick a project for every line.');
      case 'duplicate-project': return t('costAttribution:form.duplicateProject', 'Each project can appear only once.');
      case 'bad-percent': return t('costAttribution:form.badPercent', 'Percentages must be above 0, at most 100, with up to 4 decimals.');
      case 'total-not-100': return t('costAttribution:form.total', 'Percentages must total 100.');
      default: return undefined;
    }
  };

  const form = useEntityForm<RuleFormValues>({
    initialValues: rule ? valuesFromRule(rule) : EMPTY_RULE_VALUES,
    validate: (v) => {
      const e = validateRule(v);
      return Object.fromEntries(Object.entries(e).map(([k, code]) => [k, errorText(code)])) as Partial<Record<keyof RuleFormValues, string>>;
    },
    idPrefix: 'cost-attribution-rule',
    requiredFields: ['name', 'matchValue', 'effectiveFrom'],
    module: 'administration',
  });
  const v = form.values;
  const draft = useMemo(() => toDraft(v, rule), [v, rule]);
  const valid = Object.keys(validateRule(v)).length === 0;

  const preview = useMutation({
    mutationFn: () => previewCostAttribution(draft),
    onSuccess: () => setPreviewedFor(JSON.stringify(draft)),
  });
  const previewError = preview.isError ? toError(preview.error, rule ? 'update' : 'create') : null;
  const stale = preview.isSuccess && previewedFor !== JSON.stringify(draft);

  const save = useMutation({ mutationFn: () => saveCostAttributionRule(draft) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async () => {
      try {
        await save.mutateAsync();
        onChanged();
        onClose();
      } catch (err) {
        setSubmitError(toError(err, rule ? 'update' : 'create'));
        if ((err as { code?: string })?.code === '40001') onChanged();
      }
    });
  };

  const setTarget = (index: number, patch: Partial<RuleFormValues['targets'][number]>) =>
    form.setValue('targets', v.targets.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const nameOf = (projectId: string) => projects.find((p) => p.value === projectId)?.label ?? projectId;
  const loadProjects = useCallback(async () => projects, [projects]);
  const month = (iso: string) => formatMonthYear(new Date(`${iso}T12:00:00`));
  const rows: CostAttributionPreviewRow[] = preview.data ?? [];
  const unmapped = rows.filter((r) => r.category === null).length;
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const targetsError = form.errors.targets;
  const multi = v.targets.length > 1;

  return (
    <EntityFormModal
      open
      width="lg"
      title={rule ? t('costAttribution:form.editTitle', 'Edit cost attribution rule') : t('costAttribution:form.addTitle', 'Add cost attribution rule')}
      subtitle={t('costAttribution:form.subtitle', 'Places ledger cost that has no ERP project onto projects. Nothing is written to the ERP.')}
      submitLabel={t('costAttribution:form.save', 'Save rule')}
      onSubmit={submit}
      onClose={onClose}
      loading={save.isPending}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      submitError={submitError}
      errorSummary={Object.entries(form.errors).filter(([, m]) => m).map(([k, message]) => ({ fieldId: `cost-attribution-rule-${k}`, message: message as string }))}
    >
      <FormSection legend={t('costAttribution:form.ruleLegend', 'Rule')}>
        <FormGrid>
          <TextField {...form.fieldProps('name')} label={t('costAttribution:form.name', 'Rule name')} required fullWidth maxLength={120} />
          <SelectField
            id="cost-attribution-rule-match-by"
            label={t('costAttribution:form.matchBy', 'Match by')}
            value={v.matchBy}
            onChange={(next) => form.setValue('matchBy', next as RuleFormValues['matchBy'])}
            options={[
              { value: 'account', label: t('costAttribution:form.byAccount', 'One ERP account') },
              { value: 'account_group', label: t('costAttribution:form.byGroup', 'An account group') },
            ]}
          />
          <TextField
            {...form.fieldProps('matchValue')}
            label={v.matchBy === 'account' ? t('costAttribution:form.account', 'ERP account') : t('costAttribution:form.accountGroup', 'ERP account group')}
            required
            mono
          />
        </FormGrid>
      </FormSection>

      <FormSection legend={t('costAttribution:form.narrowLegend', 'Narrow to (optional)')}>
        <FormGrid>
          <TextField {...form.fieldProps('costCenter')} label={t('costAttribution:form.costCenter', 'Cost centre')} mono />
          <TextField {...form.fieldProps('partyType')} label={t('costAttribution:form.partyType', 'Party type')} placeholder={t('costAttribution:form.partyTypePlaceholder', 'e.g. Employee')} />
          <TextField {...form.fieldProps('party')} label={t('costAttribution:form.party', 'Party')} mono />
        </FormGrid>
      </FormSection>

      <FormSection legend={t('costAttribution:form.windowLegend', 'Posting dates it applies to')}>
        <FormGrid>
          <TextField {...form.fieldProps('effectiveFrom')} type="date" label={t('costAttribution:form.from', 'Applies from')} required />
          <TextField {...form.fieldProps('effectiveTo')} type="date" label={t('costAttribution:form.to', 'Applies until (optional)')} />
        </FormGrid>
      </FormSection>

      <FormSection legend={t('costAttribution:form.targetsLegend', 'Goes to')}>
        <div className="space-y-3">
          {v.targets.map((target, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
              <Combobox
                label={multi ? t('costAttribution:form.projectN', 'Project {{n}}', { n: index + 1 }) : t('costAttribution:form.project', 'Project')}
                value={target.projectId || null}
                selectedOption={target.projectId ? { value: target.projectId, label: nameOf(target.projectId) } : null}
                onChange={(value) => setTarget(index, { projectId: value })}
                loadOptions={loadProjects}
                placeholder={t('costAttribution:form.projectPlaceholder', 'Select project…')}
                noun={t('costAttribution:form.projectNoun', 'project')}
                required
              />
              </div>
              <div className="w-24">
              <TextField
                id={`cost-attribution-rule-percent-${index}`}
                label={t('costAttribution:form.percent', 'Percent')}
                aria-label={multi ? t('costAttribution:form.percentN', 'Percent (project {{n}})', { n: index + 1 }) : undefined}
                value={target.percent}
                onChange={(percent) => setTarget(index, { percent })}
                inputMode="decimal"
              />
              </div>
              {multi ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => form.setValue('targets', v.targets.filter((_, i) => i !== index))}
                  aria-label={t('costAttribution:form.removeProject', 'Remove project {{n}}', { n: index + 1 })}
                >
                  {t('costAttribution:form.remove', 'Remove')}
                </Button>
              ) : null}
            </div>
          ))}
          {targetsError && <p role="alert" id="cost-attribution-rule-targets" className="text-[13px] text-destructive-text">{targetsError}</p>}
          <Button variant="outline" size="sm" onClick={() => form.setValue('targets', [...v.targets, { projectId: '', percent: '' }])}>
            {t('costAttribution:form.addProject', 'Add project')}
          </Button>
        </div>
      </FormSection>

      <FormSection legend={t('costAttribution:preview.legend', 'Effect')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={!valid} loading={preview.isPending} onClick={() => preview.mutate()}>
            {t('costAttribution:preview.run', 'Preview effect')}
          </Button>
          {!valid && <span className="text-[13px] text-muted-foreground">{t('costAttribution:preview.needsValid', 'Complete the rule to preview it.')}</span>}
        </div>
        {previewError && (
          <p role="alert" className="mt-2 text-[13px] text-destructive-text">
            {previewError.headline}{' — '}{previewError.detail}
          </p>
        )}
        {preview.isSuccess && rows.length === 0 && (
          <p role="status" className="mt-2 text-[13px] text-muted-foreground">
            {t('costAttribution:preview.none', 'No untagged ledger lines match this rule in its window.')}
          </p>
        )}
        {preview.isSuccess && rows.length > 0 && (
          <div className={stale ? 'opacity-60' : undefined}>
            {stale && <p role="status" className="mt-2 text-[13px] text-muted-foreground">{t('costAttribution:preview.stale', 'The rule changed since this preview. Preview again.')}</p>}
            <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-[13px]">
                <caption className="sr-only">{t('costAttribution:preview.caption', 'Preview of attributed cost per project and month')}</caption>
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t('costAttribution:preview.month', 'Month')}</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t('costAttribution:preview.project', 'Project')}</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t('costAttribution:preview.category', 'Category')}</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">{t('costAttribution:preview.amount', 'Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.month}-${r.project_id}-${r.category ?? 'none'}`} className="border-t border-border">
                      <td className="px-2 py-1.5">{month(r.month)}</td>
                      <td className="px-2 py-1.5 break-words">{nameOf(r.project_id)}</td>
                      <td className="px-2 py-1.5">
                        {r.category
                          ? budgetCategoryLabel(r.category as Parameters<typeof budgetCategoryLabel>[0], t)
                          : <StatusPill variant="warn">{t('costAttribution:preview.unmapped', 'Not mapped')}</StatusPill>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrencyCents(r.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {t('costAttribution:preview.total', 'Total {{amount}} across {{lines}} ledger lines.', {
                amount: formatCurrencyCents(total, currency),
                lines: rows.reduce<number>((n, r) => n + r.line_count, 0),
              })}
            </p>
            {unmapped > 0 && (
              <p role="status" className="mt-1 text-[13px] text-foreground">
                {t('costAttribution:preview.unmappedNote', 'Some of this cost is on an account that is not mapped to a budget category, so it will not show in project actuals. Map it in the Budget account map.')}
              </p>
            )}
          </div>
        )}
      </FormSection>
    </EntityFormModal>
  );
};

export default CostAttributionRuleForm;
