import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, TextField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useDeletePlanLine, useSavePlanLine } from '@/src/hooks/useWorkOrderPlanVsActual';
import { PLAN_KINDS, type PlanKind, type PlanLine, type PvaWorkOrder } from '@/src/lib/workOrderPlanVsActual';

/**
 * #2519 FR-WPVA-001..003: a work order's planned figures (whole-work-order level). A blank field means no figure;
 * clearing a saved one removes it. The database refuses a negative figure, a cancelled work order and any role
 * outside Admin/Executive/Finance/Project Manager, and audits each change.
 */
interface Props {
  projectId: string;
  workOrder: PvaWorkOrder;
  plans: PlanLine[];
  onClose: () => void;
}

const VALID = /^\d{1,15}(\.\d{1,2})?$/;

export function planValueProblem(raw: string): 'format' | null {
  const v = raw.trim();
  return v === '' || VALID.test(v) ? null : 'format';
}

const WorkOrderPlanModal: React.FC<Props> = ({ projectId, workOrder, plans, onClose }) => {
  const { t } = useTranslation('workOrderPva');
  const save = useSavePlanLine(projectId);
  const remove = useDeletePlanLine(projectId);
  const initial = Object.fromEntries(PLAN_KINDS.map((k) => {
    const p = plans.find((x) => x.kind === k);
    return [k, p ? String(Number(p.value)) : ''];
  })) as Record<PlanKind, string>;
  const [values, setValues] = useState<Record<PlanKind, string>>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const label: Record<PlanKind, string> = {
    direct_budget: t('plan.direct', 'Direct budget ({{currency}})', { currency: workOrder.currency }),
    indirect_budget: t('plan.indirect', 'Indirect budget ({{currency}})', { currency: workOrder.currency }),
    equipment_hours: t('plan.equipmentHours', 'Equipment hours'),
    crew_hours: t('plan.crewHours', 'Crew hours'),
  };
  const problems = PLAN_KINDS.filter((k) => planValueProblem(values[k]) !== null);
  const dirty = PLAN_KINDS.some((k) => values[k].trim() !== initial[k]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      for (const kind of PLAN_KINDS) {
        const raw = values[kind].trim();
        if (raw === initial[kind]) continue;
        const existing = plans.find((p) => p.kind === kind) ?? null;
        if (raw === '') {
          if (existing) await remove.mutateAsync(existing.id);
          continue;
        }
        await save.mutateAsync({
          input: { projectId, workOrderId: workOrder.id, disciplineId: null, kind, value: raw, note: existing?.note ?? null },
          existingId: existing?.id ?? null,
        });
      }
      onClose();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSubmitError({ headline, detail });
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntityFormModal
      open
      title={t('plan.title', 'Plan for {{number}}', { number: workOrder.woNumber ?? workOrder.title })}
      submitLabel={t('plan.save', 'Save plan')}
      onSubmit={(e) => void onSubmit(e)}
      onClose={onClose}
      loading={busy}
      dirty={dirty}
      submitError={submitError}
      errorSummary={tried ? problems.map((k) => ({ fieldId: `wo-plan-${k}`, message: `${label[k]}: ${t('plan.format', 'Enter a number of zero or more, with up to 2 decimals.')}` })) : undefined}
    >
      <FormGrid>
        {PLAN_KINDS.map((k) => (
          <TextField
            key={k}
            id={`wo-plan-${k}`}
            label={label[k]}
            inputMode="decimal"
            value={values[k]}
            onChange={(v) => setValues((cur) => ({ ...cur, [k]: v }))}
            error={tried && planValueProblem(values[k]) ? t('plan.format', 'Enter a number of zero or more, with up to 2 decimals.') : undefined}
          />
        ))}
      </FormGrid>
    </EntityFormModal>
  );
};

export default WorkOrderPlanModal;
