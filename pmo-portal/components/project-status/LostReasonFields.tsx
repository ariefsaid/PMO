import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextArea } from '@/src/components/ui';
import { LOST_REASON_KEYS, LOST_NOTE_MAX, lostReasonLabel } from '@/src/lib/lostReasons';

export interface LostReasonValue {
  reason: string;
  note: string;
}

export const LostReasonFields: React.FC<{
  value: LostReasonValue;
  onChange: (v: LostReasonValue) => void;
  idPrefix: string;
}> = ({ value, onChange, idPrefix }) => {
  const { t } = useTranslation('lostReason');
  return (
    <div className="mt-3 grid gap-2" data-testid="lost-reason-fields">
      <SelectField
        id={`${idPrefix}-lost-reason`}
        label={t('field.reason', 'Reason')}
        required
        value={value.reason}
        placeholder={t('field.choose', 'Choose a reason')}
        onChange={(reason) => onChange({ ...value, reason })}
        options={LOST_REASON_KEYS.map((k) => ({
          value: k,
          label: lostReasonLabel((key, d) => String(t(key, d)), k),
        }))}
      />
      <TextArea
        id={`${idPrefix}-lost-note`}
        label={
          value.reason === 'other'
            ? t('field.noteRequired', 'Note (required for Other)')
            : t('field.noteOptional', 'Note (optional)')
        }
        required={value.reason === 'other'}
        maxLength={LOST_NOTE_MAX}
        helper={t('field.noteHelp', 'Up to 500 characters.')}
        value={value.note}
        onChange={(note) => onChange({ ...value, note })}
      />
    </div>
  );
};
