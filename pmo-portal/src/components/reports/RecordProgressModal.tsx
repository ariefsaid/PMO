import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, TextField, useEntityForm, useToast, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import { monthInputToIso } from '@/src/lib/reports/months';
import { useRecordProjectProgress } from '@/src/hooks/useManagementPack';

export interface RecordProgressModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** `YYYY-MM-01` — the pack's as-at month. */
  defaultMonth: string;
  /** Milestone-weighted delivery % (get_projects_delivery); a suggestion only, never applied (DD-MMP-1). */
  deliveryPct: number | null;
}

interface Values {
  month: string;
  pct: string;
  note: string;
}

/** 0–100 with at most two decimals, read in the viewer's number locale; null otherwise. */
// eslint-disable-next-line react-refresh/only-export-components -- pure parser co-located with its only form
export function parsePercentComplete(raw: string): number | null {
  const n = parseMoneyInputAtScale(raw.trim(), 2);
  return n !== null && n >= 0 && n <= 100 ? n : null;
}

export const RecordProgressModal: React.FC<RecordProgressModalProps> = ({
  open, onClose, projectId, projectName, defaultMonth, deliveryPct,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const record = useRecordProjectProgress();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const pctInvalid = t('managementPack.progressModal.pctInvalid', 'Enter a number from 0 to 100, with at most two decimals.');
  const monthInvalid = t('managementPack.progressModal.monthInvalid', 'Choose a month.');

  const form = useEntityForm<Values>({
    initialValues: { month: defaultMonth.slice(0, 7), pct: '', note: '' },
    idPrefix: 'record-progress',
    requiredFields: ['month', 'pct'],
    validate: (v) => ({
      ...(monthInputToIso(v.month) ? {} : { month: monthInvalid }),
      ...(parsePercentComplete(v.pct) === null ? { pct: pctInvalid } : {}),
    }),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      const month = monthInputToIso(v.month);
      const pctComplete = parsePercentComplete(v.pct);
      if (month === null || pctComplete === null) return;
      try {
        await record.mutateAsync({ projectId, month, pctComplete, note: v.note.trim() || null });
        toast(t('managementPack.progressModal.saved', 'Progress saved'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError(classifyMutationError(err));
      }
    });
  };

  return (
    <EntityFormModal
      open={open}
      title={t('managementPack.progressModal.title', 'Record progress')}
      subtitle={projectName}
      submitLabel={t('managementPack.progressModal.save', 'Save progress')}
      onSubmit={onSubmit}
      onClose={onClose}
      submitDisabled={!form.isComplete}
      loading={record.isPending}
      dirty={form.isDirty}
      submitError={submitError}
      width="sm"
    >
      <FormGrid>
        <TextField
          label={t('managementPack.progressModal.month', 'Month')}
          type="month"
          required
          {...form.fieldProps('month')}
        />
        <TextField
          label={t('managementPack.progressModal.pct', 'Percent complete to date')}
          inputMode="decimal"
          required
          helper={
            deliveryPct != null
              ? t('managementPack.progressModal.pctHelper', 'Milestone delivery: {{pct}}%', { pct: Math.round(deliveryPct) })
              : undefined
          }
          {...form.fieldProps('pct')}
        />
        <TextField label={t('managementPack.progressModal.note', 'Note')} fullWidth maxLength={500} {...form.fieldProps('note')} />
      </FormGrid>
    </EntityFormModal>
  );
};
