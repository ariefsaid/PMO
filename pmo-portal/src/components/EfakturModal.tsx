import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { localToday, normalizeEfakturValues, validateEfakturValues } from '@/src/lib/efaktur';
import { EntityFormModal, TextField, type SubmitError } from '@/src/components/ui';

export interface EfakturSaveValues {
  efakturNumber: string | null;
  efakturDate: string | null;
}

/**
 * Mount it only while editing (`{target && <EfakturModal … />}`): the mount IS the edit session, so
 * the drafts seed from the props once and need no reset effect.
 */
export interface EfakturModalProps {
  number: string | null;
  date: string | null;
  loading: boolean;
  onClose: () => void;
  onSave: (values: EfakturSaveValues) => Promise<void>;
}

/** Shared, accessible PMO-owned e-Faktur editor for sales invoices and vendor bills. */
export const EfakturModal: React.FC<EfakturModalProps> = ({
  number, date, loading, onClose, onSave,
}) => {
  const { t } = useTranslation();
  const [numberDraft, setNumberDraft] = useState(number ?? '');
  const [dateDraft, setDateDraft] = useState(date ?? '');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const today = useMemo(() => localToday(), []);

  const normalized = useMemo(
    () => normalizeEfakturValues({ number: numberDraft, date: dateDraft }),
    [numberDraft, dateDraft],
  );
  const errors = useMemo(() => validateEfakturValues(normalized, today), [normalized, today]);
  const numberError = errors.number
    ? t('efaktur.invalidNumber', 'Use up to 32 digits, dots, or dashes.')
    : undefined;
  const dateError = errors.date === 'future'
    ? t('efaktur.futureDate', 'The e-Faktur date cannot be in the future.')
    : errors.date
      ? t('efaktur.invalidDate', 'Enter a valid date.')
      : undefined;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0 || loading) return;
    void onSave({ efakturNumber: normalized.number, efakturDate: normalized.date }).catch((error: unknown) => {
      const { headline, detail } = classifyMutationError(error);
      setSaveError({ headline, detail });
    });
  };

  return (
    <EntityFormModal
      open
      title={t('efaktur.title', 'Record e-Faktur details')}
      subtitle={t('efaktur.help', 'Leave both fields empty for a non-VAT document.')}
      submitLabel={t('financeCopy.save', 'Save')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={numberDraft !== (number ?? '') || dateDraft !== (date ?? '')}
      submitDisabled={Object.keys(errors).length > 0}
      submitError={saveError}
    >
      <div className="grid gap-4">
        <TextField
          label={t('efaktur.number', 'e-Faktur number')}
          value={numberDraft}
          onChange={setNumberDraft}
          maxLength={32}
          autoComplete="off"
          error={numberError}
        />
        <TextField
          label={t('efaktur.date', 'e-Faktur date')}
          type="date"
          value={dateDraft}
          onChange={setDateDraft}
          max={today}
          error={dateError}
        />
      </div>
    </EntityFormModal>
  );
};
