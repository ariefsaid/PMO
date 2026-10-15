import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal,
  FormGrid,
  TextField,
  type ErrorSummaryItem,
  type SubmitError,
  useEntityForm,
} from '@/src/components/ui';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { FxRateInput, FxRateRow } from '@/src/lib/repositories/types';

export interface FxRateFormProps {
  row?: FxRateRow;
  draft?: FxRateInput;
  today: string;
  loading: boolean;
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (row: FxRateInput) => void;
}

type Values = { date: string; rate: string };

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.toISOString().slice(0, 10) === value;
}

const FxRateForm: React.FC<FxRateFormProps> = ({
  row,
  draft,
  today,
  loading,
  submitError,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const initialValues: Values = {
    date: draft?.rate_date ?? row?.rate_date ?? '',
    rate: draft ? formatMoneyInputValue(draft.rate) : row ? formatMoneyInputValue(row.rate) : '',
  };
  const validate = (values: Values): Partial<Record<keyof Values, string>> => {
    const errors: Partial<Record<keyof Values, string>> = {};
    if (!isCalendarDate(values.date))
      errors.date = t('fx.invalidDate', 'Enter a valid publication date.');
    else if (values.date > today)
      errors.date = t('fx.futureDate', 'Publication date cannot be in the future.');
    const rate = parseMoneyInputAtScale(values.rate, 6);
    if (rate === null || rate < 1000 || rate > 100000) {
      errors.rate = t(
        'fx.invalidRate',
        'Enter a rate from 1,000 to 100,000 with at most six decimal places; check separators.',
      );
    }
    return errors;
  };
  const form = useEntityForm<Values>({
    initialValues,
    validate,
    requiredFields: ['date', 'rate'],
    module: 'fx-rates',
  });
  const dateField = form.fieldProps('date');
  const rateField = form.fieldProps('rate');
  const errorSummary: ErrorSummaryItem[] = [
    form.errors.date ? { fieldId: dateField.id, message: form.errors.date } : null,
    form.errors.rate ? { fieldId: rateField.id, message: form.errors.rate } : null,
  ].filter((item): item is ErrorSummaryItem => item !== null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void form.handleSubmit((values) => {
      const rate = parseMoneyInputAtScale(values.rate, 6);
      if (rate === null) return;
      onSubmit({ rate_date: values.date, rate });
    });
  };

  return (
    <EntityFormModal
      open
      title={row ? t('fx.editRate', 'Edit rate') : t('fx.newRate', 'New rate')}
      submitLabel={t('fx.saveRate', 'Save rate')}
      cancelLabel={t('common.cancel', 'Cancel')}
      onSubmit={handleSubmit}
      onClose={onClose}
      submitDisabled={!form.isComplete || loading}
      disabledReason={t(
        'fx.invalidRate',
        'Enter a rate from 1,000 to 100,000 with at most six decimal places; check separators.',
      )}
      loading={loading}
      dirty={form.isDirty}
      errorSummary={errorSummary}
      submitError={submitError}
    >
      <FormGrid>
        <TextField
          {...dateField}
          label={t('fx.date', 'Publication date')}
          type="date"
          max={today}
          required
          disabled={Boolean(row) || loading}
        />
        <TextField
          {...rateField}
          label={t('fx.rate', 'IDR per USD')}
          inputMode="decimal"
          autoComplete="off"
          required
          disabled={loading}
        />
      </FormGrid>
    </EntityFormModal>
  );
};

export default FxRateForm;
