import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, DateField, EntityFormModal, FormGrid, SelectField, TextField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useRevenuePlanMutations } from '@/src/hooks/useWorkOrderRevenuePlan';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { monthRange, monthStartOf, planAmountProblem } from '@/src/lib/revenuePlan';

type Mode = 'date' | 'month' | 'clear';
interface Props { workOrderId: string; woLabel: string; currency: string; onClose: () => void }

/**
 * Enter a revenue plan (#2671 FR-WRP-002..005, 007): one date, one month spread over working days, or clear a month.
 * The database refuses a role outside Admin/Executive/Finance/the project's PM, a Cancelled or Closed work order, a
 * month with no free working day and a malformed amount; the refusal is shown in the form.
 */
export const RevenuePlanModal: React.FC<Props> = ({ workOrderId, woLabel, currency, onClose }) => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const today = useOrgToday();
  const m = useRevenuePlanMutations();
  const [mode, setMode] = useState<Mode>('month');
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(monthStartOf(today));
  const [amount, setAmount] = useState('');
  const [keepEdited, setKeepEdited] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const locale = getActiveLocale().locale;
  const months = useMemo(() => monthRange(today, 6, 18).map((v) => ({ value: v, label: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`)) })), [today, locale]);

  const needsAmount = mode !== 'clear';
  const problem = needsAmount ? planAmountProblem(amount) : null;
  const dateMissing = mode === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(date);
  const amountMessage = problem === 'required' ? t('form.amountRequired', 'Enter an amount.') : t('form.amountFormat', 'Enter a number of zero or more, with up to 2 decimals.');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (problem || dateMissing) return;
    setBusy(true);
    try {
      if (mode === 'date') await m.setDay.mutateAsync({ workOrderId, date, amount: amount.trim() });
      else if (mode === 'month') await m.setMonth.mutateAsync({ workOrderId, month, amount: amount.trim(), keepEdited });
      else {
        const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        await m.clear.mutateAsync({ workOrderId, from: month, to: end });
      }
      onClose();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSubmitError({ headline, detail });
    } finally { setBusy(false); }
  };

  return (
    <EntityFormModal
      open
      title={t('form.title', 'Revenue plan for {{label}}', { label: woLabel })}
      submitLabel={mode === 'clear' ? t('form.clear', 'Clear month') : t('form.save', 'Save plan')}
      onSubmit={(e) => void onSubmit(e)}
      onClose={onClose}
      loading={busy}
      dirty={amount !== ''}
      submitError={submitError}
      errorSummary={tried ? [
        ...(problem ? [{ fieldId: 'wrp-amount', message: amountMessage }] : []),
        ...(dateMissing ? [{ fieldId: 'wrp-date', message: t('form.dateRequired', 'Enter a date.') }] : []),
      ] : undefined}
    >
      <FormGrid>
        <SelectField id="wrp-mode" label={t('form.mode', 'Enter by')} value={mode} onChange={(v) => setMode(v as Mode)} fullWidth
          options={[
            { value: 'month', label: t('form.byMonth', 'Month, spread over working days') },
            { value: 'date', label: t('form.byDate', 'One date') },
            { value: 'clear', label: t('form.byClear', 'Clear a month') },
          ]} />
        {mode === 'date'
          ? <DateField id="wrp-date" label={t('form.date', 'Date')} value={date} onChange={setDate} error={tried && dateMissing ? t('form.dateRequired', 'Enter a date.') : undefined} />
          : <SelectField id="wrp-month" label={t('form.month', 'Month')} value={month} onChange={setMonth} fullWidth options={months} />}
        {needsAmount && (
          <TextField id="wrp-amount" label={t('form.amount', 'Amount ({{currency}})', { currency })} inputMode="decimal" value={amount} onChange={setAmount}
            helper={mode === 'month' ? t('form.monthHelp', 'Spread evenly over the organisation\'s working days; the extra cents go to the earliest dates.') : undefined}
            error={tried && problem ? amountMessage : undefined} />
        )}
        {mode === 'month' && (
          <Checkbox checked={keepEdited} onChange={setKeepEdited} label={t('form.keepEdited', 'Keep days I edited on their own')} />
        )}
      </FormGrid>
    </EntityFormModal>
  );
};
