import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, NumberField, Switch } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useBillingPlanSettings, useSaveDoneNotClaimedReminder } from '@/src/hooks/useBillingPlan';

/**
 * #2675: the reminder about work that is done but not claimed: a switch (off by default; the reminder is information) and the day limit
 * after which a line is flagged (empty = no limit, nothing flagged). It sits inside the Billing extras module card (#2746) as well as in the plan settings dialog Finance uses. Admin and
 * Finance may write it (`set_billing_plan_reminder` is the authority, ADR-0016); this card is Admin-only, the dialog is not.
 */
export const DoneNotClaimedReminder: React.FC = () => {
  const { t } = useTranslation('finance');
  const q = useBillingPlanSettings();
  const save = useSaveDoneNotClaimedReminder();
  const [reminder, setReminder] = useState<boolean | null>(null);
  const [days, setDays] = useState<string | null>(null);
  if (q.isError) return <ListState variant="error" title={t('billingPlan.settings.reminderLoadError', "Couldn't load the reminder setting")} onRetry={() => void q.refetch()} />;
  if (!q.data) return <ListState variant="loading" rows={1} />;
  const shownOn = reminder ?? q.data.reminderOn;
  const initialDays = q.data.doneNotClaimedAfterDays == null ? '' : String(q.data.doneNotClaimedAfterDays);
  const shownDays = days ?? initialDays;
  const trimmed = shownDays.trim();
  const value = trimmed === '' ? null : Number(trimmed);
  const bad = trimmed !== '' && !(/^\d+$/.test(trimmed) && value !== null && value >= 1 && value <= 3650);
  const dirty = reminder !== null || days !== null;
  const err = save.isError ? classifyMutationError(save.error) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Switch checked={shownOn} onChange={setReminder} labelledBy="plan-reminder-label" describedBy="plan-reminder-help" />
        <div>
          <p id="plan-reminder-label" className="text-control font-medium">{t('billingPlan.settings.reminder', 'Remind me about work that is done but not claimed')}</p>
          <p id="plan-reminder-help" className="text-control text-muted-foreground">
            {t('billingPlan.settings.reminderHelp', 'Information only. Off by default. Holding a claim to next month can be deliberate.')}
          </p>
        </div>
      </div>
      <NumberField id="plan-after-days" label={t('billingPlan.settings.afterDays', 'Flag after (days)')} value={shownDays} onChange={setDays}
        error={bad ? t('billingPlan.settings.afterDaysBad', 'Enter a whole number of days from 1 to 3650.') : undefined}
        helper={t('billingPlan.settings.afterDaysHelp', 'Lines accepted longer ago than this are flagged. Leave empty for no limit; with no limit nothing is flagged.')} fullWidth />
      {err && <FieldError>{err.detail || err.headline}</FieldError>}
      <Button variant="primary" size="sm" disabled={!dirty || bad} loading={save.isPending}
        onClick={() => save.mutate({ reminderOn: shownOn, afterDays: value }, { onSuccess: () => { setReminder(null); setDays(null); } })}>
        {t('billingPlan.settings.reminderSave', 'Save reminder')}
      </Button>
    </div>
  );
};
