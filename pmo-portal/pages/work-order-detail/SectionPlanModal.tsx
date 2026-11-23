import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { useSaveSectionPlan } from '@/src/hooks/useWorkOrderSections';
import { PLAN_KINDS, planValueProblem, type PlanKind } from '@/src/lib/workOrderPlanVsActual';
import type { SectionRollupRow } from '@/src/lib/repositories/workOrderSections';
import { useSectionRefusal } from './useSectionRefusal';

interface Props { projectId: string; workOrderId: string; currency: string; section: SectionRollupRow; onClose: () => void }

const FIGURE: Record<PlanKind, keyof SectionRollupRow> = {
  direct_budget: 'directBudget', indirect_budget: 'indirectBudget', equipment_hours: 'equipmentHours', crew_hours: 'crewHours',
};

/**
 * A section's planned figures (FR-WOS-008): the same four figures as the work order's plan, written through
 * `set_work_order_plan` with the section named. Moving a figure between sections is two edits saved together by
 * the database; the work order's total is the sum of all of them. A blank field means no figure.
 */
export const SectionPlanModal: React.FC<Props> = ({ projectId, workOrderId, currency, section, onClose }) => {
  const { t } = useTranslation('workOrderSections');
  const { t: tp } = useTranslation('workOrderPva');
  const sectionRefusal = useSectionRefusal();
  const { toast } = useToast();
  const save = useSaveSectionPlan(workOrderId, projectId);
  const initial = Object.fromEntries(PLAN_KINDS.map((k) => [k, (section[FIGURE[k]] as string | null) ?? ''])) as Record<PlanKind, string>;
  const [values, setValues] = useState<Record<PlanKind, string>>(initial);
  const [tried, setTried] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const label: Record<PlanKind, string> = {
    direct_budget: tp('plan.direct', 'Direct budget ({{currency}})', { currency }),
    indirect_budget: tp('plan.indirect', 'Indirect budget ({{currency}})', { currency }),
    equipment_hours: tp('plan.equipmentHours', 'Equipment hours'),
    crew_hours: tp('plan.crewHours', 'Crew hours'),
  };
  const problems = PLAN_KINDS.filter((k) => planValueProblem(values[k]) !== null);
  const dirty = PLAN_KINDS.some((k) => values[k].trim() !== initial[k]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setSubmitError(null);
    if (problems.length > 0) return;
    try {
      const changes = PLAN_KINDS.filter((kind) => values[kind].trim() !== initial[kind])
        .map((kind) => ({ kind, value: values[kind].trim() || null, note: null, sectionId: section.sectionId }));
      if (changes.length > 0) await save.mutateAsync(changes);
      toast(t('saved', 'Saved'), undefined, 'success');
      onClose();
    } catch (err) {
      setSubmitError(sectionRefusal(err));
    }
  };
  return (
    <EntityFormModal open title={t('planTitle', 'Plan for {{code}}', { code: section.code })} submitLabel={t('planSave', 'Save plan')}
      onSubmit={(e) => void submit(e)} onClose={onClose} loading={save.isPending} dirty={dirty} submitError={submitError}
      errorSummary={tried ? problems.map((k) => ({ fieldId: `wos-plan-${k}`, message: `${label[k]}: ${t('planFormat', 'Enter a number of zero or more, with up to 2 decimals.')}` })) : undefined}>
      <FormGrid>
        {PLAN_KINDS.map((k) => (
          <TextField key={k} id={`wos-plan-${k}`} label={label[k]} inputMode="decimal" value={values[k]}
            onChange={(v) => setValues((cur) => ({ ...cur, [k]: v }))}
            error={tried && planValueProblem(values[k]) ? t('planFormat', 'Enter a number of zero or more, with up to 2 decimals.') : undefined} />
        ))}
      </FormGrid>
    </EntityFormModal>
  );
};
