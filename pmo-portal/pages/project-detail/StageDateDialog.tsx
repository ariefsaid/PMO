import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, TextField, SelectField } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { STAGE_KEY_DATE_LABEL } from '@/components/salesPipeline';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

interface StageDateDialogProps {
  title: string;
  subtitle?: string;
  /** Pre-filled value ('YYYY-MM-DD'); today when not given. */
  initialDate?: string;
  /** Inclusive bounds from the neighbouring entries; max defaults to today. */
  min?: string | null;
  max?: string | null;
  /** Only for "Add skipped stage": the pre-award stages the user may pick. */
  stageOptions?: readonly ProjectStatus[];
  onConfirm: (value: { enteredOn: string; stage?: ProjectStatus }) => Promise<void>;
  onClose: () => void;
}

/** Date picker for a stage entry. Nothing is written until "Save date": the only write is `onConfirm`. */
export default function StageDateDialog({ title, subtitle, initialDate, min, max, stageOptions, onConfirm, onClose }: StageDateDialogProps) {
  const { t } = useTranslation('project');
  const today = useOrgToday();
  const hi = max ?? today;
  const [value, setValue] = useState(initialDate ?? today);
  const [stage, setStage] = useState<string>(stageOptions?.[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const outOfRange = value === '' || (min != null && value < min) || value > hi;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (outOfRange) return;
    setSaving(true);
    setServerError(null);
    try {
      await onConfirm({ enteredOn: value, stage: stageOptions ? (stage as ProjectStatus) : undefined });
    } catch (err) {
      setServerError(classifyMutationError(err).detail);
    } finally {
      setSaving(false);
    }
  };
  const rangeMessage = min != null
    ? t('projectDetail.stageHistory.outOfRange', 'Pick a date between {{min}} and {{max}}', { min, max: hi })
    : t('projectDetail.stageHistory.notAfter', 'Pick a date on or before {{max}}', { max: hi });
  const rangeError = outOfRange && value !== '' ? rangeMessage : null;
  return (
    <EntityFormModal open title={title} subtitle={subtitle} submitLabel={t('projectDetail.stageHistory.save', 'Save date')}
      onSubmit={(e) => void submit(e)} onClose={onClose} loading={saving} submitDisabled={outOfRange}
      disabledReason={outOfRange ? rangeMessage : undefined}
      dirty={value !== (initialDate ?? today)}>
      {stageOptions && (
        <SelectField label={t('projectDetail.stageHistory.stage', 'Stage')} value={stage} onChange={setStage}
          options={stageOptions.map((s) => ({ value: s, label: t(STAGE_KEY_DATE_LABEL[s][0], STAGE_KEY_DATE_LABEL[s][1]) }))} />
      )}
      <TextField type="date" label={t('projectDetail.stageHistory.date', 'Stage date')} value={value}
        onChange={(v) => { setValue(v); setServerError(null); }} min={min ?? undefined} max={hi}
        error={rangeError ?? serverError} />
    </EntityFormModal>
  );
}
