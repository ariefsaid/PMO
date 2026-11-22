import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { useDisciplineProfitEnabled, useSetItemDiscipline } from '@/src/hooks/useDisciplineProfit';

/**
 * The discipline of one contract line (#2669, FR-DPR-002), from the organisation's own list. Shown only while the
 * organisation setting is on and the role may write it; saves on change through `set_boq_item_discipline`.
 * Rendered by the caller beside the line form, so the form and its tests are untouched.
 */
interface Props { projectId: string; itemId: string; disciplineId: string | null }

const BoqDisciplinePicker: React.FC<Props> = ({ projectId, itemId, disciplineId }) => {
  const { t } = useTranslation('workOrderPva');
  const may = usePermission();
  const allowed = may('manage', 'workOrderPlan');
  const setting = useDisciplineProfitEnabled(allowed);
  const disciplines = useCostDisciplines(allowed && setting.data === true);
  const save = useSetItemDiscipline(projectId);
  const { toast } = useToast();
  const [value, setValue] = React.useState(disciplineId ?? '');
  React.useEffect(() => setValue(disciplineId ?? ''), [disciplineId]);
  if (!allowed || setting.data !== true) return null;

  const options = [
    { value: '', label: t('profit.picker.none', 'No discipline') },
    ...(disciplines.data ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <SelectField
      id={`boq-discipline-${itemId}`}
      label={t('profit.picker.label', 'Discipline (for profit per discipline)')}
      value={value}
      options={options}
      disabled={save.isPending}
      onChange={(next) => {
        const previous = value;
        setValue(next);
        save.mutate({ itemId, disciplineId: next === '' ? null : next }, {
          onSuccess: () => toast(t('profit.picker.saved', 'Discipline saved'), undefined, 'success'),
          onError: (err) => {
            setValue(previous);
            const { headline, detail } = classifyMutationError(err);
            toast(detail || headline || t('profit.picker.error', 'Couldn\'t save the discipline'), undefined, 'error');
          },
        });
      }}
    />
  );
};

export default BoqDisciplinePicker;
