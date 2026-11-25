import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, EntityFormModal, FormGrid, SelectField, TextField, useEntityForm, useToast, type SubmitError } from '@/src/components/ui';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { useCrewWorkOrders, useCrews } from '@/src/hooks/useCrews';
import { useManpowerMutations } from '@/src/hooks/useManpowerNeeds';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useManpowerErrorText } from './manpowerErrors';

/** Record a need: a position and head count wanted by a date for a project, optionally for one work order and crew (FR-MPN-001). */
export const ManpowerNeedForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('crews');
  const writeError = useManpowerErrorText();
  const { toast } = useToast();
  const { create } = useManpowerMutations();
  const projects = useProjectPickerOptions();
  const positions = useCostDisciplines();
  const crews = useCrews();
  const workOrders = useCrewWorkOrders();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const today = useOrgToday();
  const form = useEntityForm({
    initialValues: { project: '', position: '', headcount: '1', neededBy: today, workOrder: '', crew: '', note: '' },
    idPrefix: 'manpower-need',
    requiredFields: ['project', 'position', 'headcount', 'neededBy'],
    validate: (v) => (/^[0-9]{1,3}$/.test(v.headcount) && Number(v.headcount) >= 1 && Number(v.headcount) <= 500
      ? {} : { headcount: t('crews:manpower.headcountRange', 'Enter a whole number from 1 to 500') }),
  });
  const choose = (label: string) => ({ value: '', label });
  const projectWorkOrders = (workOrders.data ?? []).filter((w) => w.project_id === form.values.project);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        await create.mutateAsync({
          project_id: v.project, discipline_id: v.position, headcount: Number(v.headcount), needed_by: v.neededBy,
          work_order_id: v.workOrder || null, crew_id: v.crew || null, note: v.note,
        });
        toast(t('crews:manpower.saved', 'Need recorded'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError({ headline: t('crews:saveFailed', 'Not saved'), detail: writeError(err) });
      }
    });
  };
  const noPositions = positions.isSuccess && (positions.data ?? []).length === 0;
  return (
    <EntityFormModal open title={t('crews:manpower.newTitle', 'Record a manpower need')} submitLabel={t('crews:manpower.save', 'Record need')}
      onSubmit={submit} onClose={onClose} loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete || noPositions}
      submitError={submitError}>
      <FormGrid>
        <SelectField label={t('crews:manpower.project', 'Project')} required value={form.values.project}
          onChange={(v) => { form.setValue('project', v); form.setValue('workOrder', ''); }}
          options={[choose(t('crews:manpower.chooseProject', 'Choose a project')),
            ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label={t('crews:manpower.position', 'Position')} required value={form.values.position} onChange={(v) => form.setValue('position', v)}
          helper={noPositions ? t('crews:manpower.noPositions', 'No positions yet. An Admin adds them on the Cost disciplines screen.') : undefined}
          options={[choose(t('crews:manpower.choosePosition', 'Choose a position')),
            ...(positions.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
        <TextField label={t('crews:headcount', 'Headcount')} required inputMode="numeric" {...form.fieldProps('headcount')} error={form.errors.headcount} />
        <DateField label={t('crews:manpower.neededBy', 'Needed by')} required value={form.values.neededBy} onChange={(v) => form.setValue('neededBy', v)} />
        <SelectField label={t('crews:workOrder', 'Work order')} value={form.values.workOrder} onChange={(v) => form.setValue('workOrder', v)}
          disabled={!form.values.project}
          helper={!form.values.project ? t('crews:manpower.workOrderNeedsProject', 'Choose a project first.') : undefined}
          options={[choose(t('crews:manpower.noWorkOrder', 'Whole project')),
            ...projectWorkOrders.map((w) => ({ value: w.id, label: w.wo_number ? `${w.wo_number} ${w.title}` : w.title }))]} />
        <SelectField label={t('crews:manpower.crew', 'Crew')} value={form.values.crew} onChange={(v) => form.setValue('crew', v)}
          options={[choose(t('crews:manpower.noCrew', 'Any crew')),
            ...(crews.data ?? []).filter((c) => !c.archived_at).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))]} />
        <TextField label={t('crews:manpower.note', 'Note')} {...form.fieldProps('note')} />
      </FormGrid>
    </EntityFormModal>
  );
};
