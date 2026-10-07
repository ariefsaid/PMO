import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { efakturRefusal, localToday, normalizeEfakturValues, validateEfakturValues } from '@/src/lib/efaktur';
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
  /** The record's own number (SI / VI), named in the subtitle so the user knows which row they edit. */
  recordLabel: string;
  number: string | null;
  date: string | null;
  loading: boolean;
  onClose: () => void;
  onSave: (values: EfakturSaveValues) => Promise<void>;
}

/** Shared, accessible PMO-owned e-Faktur editor for sales invoices and vendor bills. */
export const EfakturModal: React.FC<EfakturModalProps> = ({
  recordLabel, number, date, loading, onClose, onSave,
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
  const numberError = errors.number === 'missing'
    ? t('efaktur.numberMissing', 'Enter the e-Faktur number as well, or clear the date.')
    : errors.number
      ? t('efaktur.invalidNumber', 'Use up to 32 digits, dots, or dashes.')
      : undefined;
  const dateError = errors.date === 'missing'
    ? t('efaktur.dateMissing', 'Enter the e-Faktur date as well, or clear the number.')
    : errors.date === 'future'
      ? t('efaktur.futureDate', 'The e-Faktur date cannot be in the future.')
      : errors.date
        ? t('efaktur.invalidDate', 'Enter a valid date.')
        : undefined;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0 || loading) return;
    void onSave({ efakturNumber: normalized.number, efakturDate: normalized.date }).catch((error: unknown) => {
      const classified = classifyMutationError(error);
      // The setters' known refusals carry a stable DETAIL key (0265) — name them in the user's language.
      const refusal = efakturRefusal(error);
      if (!refusal) {
        setSaveError({ headline: classified.headline, detail: classified.detail });
        return;
      }
      const detail = refusal === 'incomplete'
        ? t('efaktur.refusedIncomplete', 'Record the e-Faktur number and its date together.')
        : refusal === 'cancelled'
          ? t('efaktur.refusedCancelled', 'This invoice has been cancelled, so its e-Faktur can no longer be recorded. The list has been refreshed.')
          : t('efaktur.futureDate', 'The e-Faktur date cannot be in the future.');
      setSaveError({ headline: t('efaktur.notSaved', 'e-Faktur not saved'), detail });
    });
  };

  return (
    <EntityFormModal
      open
      title={t('efaktur.title', 'Record e-Faktur details')}
      subtitle={t('efaktur.subtitle', 'For {{record}}. Record the number and its date together, or leave both empty for a non-VAT document.', { record: recordLabel })}
      submitLabel={t('financeCopy.save', 'Save')}
      cancelLabel={t('efaktur.cancel', 'Cancel')}
      disabledReason={t('efaktur.disabledReason', 'Fix the highlighted e-Faktur value to save.')}
      discardCopy={{
        title: t('efaktur.discardTitle', 'Discard these e-Faktur details?'),
        description: t('efaktur.discardDescription', 'The number and date you entered will not be saved.'),
        confirmLabel: t('efaktur.discard', 'Discard'),
        cancelLabel: t('efaktur.keepEditing', 'Keep editing'),
      }}
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
          mono
          placeholder="010.000-26.12345678"
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
