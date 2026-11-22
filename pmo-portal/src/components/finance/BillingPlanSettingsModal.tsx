import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, FormSection, NumberField, TextField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatMonthYearShort, parseMoneyInput } from '@/src/lib/format';
import { useSaveBillingPlanSettings } from '@/src/hooks/useBillingPlan';
import type { PlanSettings } from '@/src/lib/db/billingPlan';

/**
 * #2682 — the plan's settings, for Admin and Finance (the database enforces it; the control is hidden for everyone else): the default
 * monthly target and its currency, a target for the month on screen,.
 * The done-not-claimed reminder and its day limit moved into the Billing extras module card in Administration (#2746); they are kept as they are here.
 */
const asInput = (n: number | null) => (n === null ? '' : formatMoneyInputValue(n));

export const BillingPlanSettingsModal: React.FC<{
  settings: PlanSettings;
  month: string;
  defaultCurrency: string;
  onClose: () => void;
}> = ({ settings, month, defaultCurrency, onClose }) => {
  const { t } = useTranslation('finance');
  const save = useSaveBillingPlanSettings();
  const existingMonth = settings.monthTargets.find((m) => m.month === month)?.target ?? null;
  const [target, setTarget] = useState(asInput(settings.monthlyTarget));
  const [currency, setCurrency] = useState(settings.targetCurrency ?? defaultCurrency);
  const [monthTarget, setMonthTarget] = useState(asInput(existingMonth));
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [tried, setTried] = useState(false);

  const parse = (raw: string): { value: number | null; bad: boolean } => {
    if (raw.trim() === '') return { value: null, bad: false };
    const v = parseMoneyInput(raw);
    return { value: v, bad: v === null || v < 0 };
  };
  const t1 = parse(target);
  const t2 = parse(monthTarget);
  const needsCurrency = (t1.value !== null || t2.value !== null) && !/^[A-Za-z]{3}$/.test(currency.trim());
  const invalid = t1.bad || t2.bad || needsCurrency;
  const monthLabel = formatMonthYearShort(month);
  const dirty = target !== asInput(settings.monthlyTarget) || monthTarget !== asInput(existingMonth) || currency !== (settings.targetCurrency ?? defaultCurrency);

  const badMsg = t('billingPlan.settings.badAmount', 'Enter an amount of zero or more.');
  return (
    <EntityFormModal
      open
      title={t('billingPlan.settings.title', 'Plan settings')}
      submitLabel={t('billingPlan.settings.save', 'Save settings')}
      onClose={onClose}
      dirty={dirty}
      loading={save.isPending}
      submitError={submitError}
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        setTried(true);
        if (invalid) return;
        setSubmitError(null);
        const hasTarget = t1.value !== null;
        save.mutate({
          monthlyTarget: t1.value,
          targetCurrency: hasTarget || t2.value !== null ? currency.trim().toUpperCase() : (settings.targetCurrency ?? null),
          reminderOn: settings.reminderOn,
          month: monthTarget.trim() === '' && existingMonth === null ? undefined : { month, target: t2.value },
        }, {
          onSuccess: onClose,
          onError: (err) => setSubmitError(classifyMutationError(err)),
        });
      }}
    >
      <FormSection legend={t('billingPlan.settings.targetLegend', 'Monthly target')}>
        <FormGrid>
          <NumberField id="plan-target" label={t('billingPlan.settings.target', 'Default monthly target')} localeAware value={target} onChange={setTarget}
            error={tried && t1.bad ? badMsg : undefined} helper={t('billingPlan.settings.targetHelp', 'Leave empty for no target.')} fullWidth />
          <TextField id="plan-currency" label={t('billingPlan.settings.currency', 'Currency')} value={currency} onChange={setCurrency} maxLength={3} code
            error={tried && needsCurrency ? t('billingPlan.settings.currencyNeeded', 'A target needs a three-letter currency.') : undefined} fullWidth />
          <NumberField id="plan-month-target" label={t('billingPlan.settings.monthTarget', { defaultValue: 'Target for {{month}}', month: monthLabel })} localeAware
            value={monthTarget} onChange={setMonthTarget} error={tried && t2.bad ? badMsg : undefined}
            helper={t('billingPlan.settings.monthTargetHelp', 'Overrides the default for this month. Empty uses the default.')} fullWidth />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
