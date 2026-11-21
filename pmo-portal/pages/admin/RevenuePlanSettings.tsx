import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ListState, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatWeekday } from '@/src/lib/format';
import { useRevenuePlanSettings, useSetRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';

/**
 * Administration › Projects › Revenue plan (#2671, FR-WRP-001, migration 1275): the organisation's switch (off by default)
 * and the weekdays a month amount is spread over. Admin only (`can('manage', 'revenuePlanSettings')`, UX); the
 * set_revenue_plan_settings RPC is the authority (ADR-0016). Switching it on changes nothing already entered anywhere.
 */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const RevenuePlanSettings: React.FC = () => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const { toast } = useToast();
  const may = usePermission();
  const q = useRevenuePlanSettings();
  const m = useSetRevenuePlanSettings();
  const [draft, setDraft] = useState<{ enabled: boolean; weekdays: number[] } | null>(null);
  const [error, setError] = useState<string>();
  if (!may('manage', 'revenuePlanSettings')) return null;

  // 1 January 2024 was a Monday, so ISO weekday n is day n of that January (noon UTC keeps the day in every zone).
  const dayName = (iso: number) => formatWeekday(new Date(Date.UTC(2024, 0, iso, 12)));
  const current = draft ?? (q.data ? { enabled: q.data.enabled, weekdays: q.data.workingWeekdays } : null);
  const save = async () => {
    if (!current) return;
    setError(undefined);
    try {
      await m.mutateAsync({ enabled: current.enabled, weekdays: [...current.weekdays].sort() });
      setDraft(null);
      toast(t('settings.saved', 'Revenue plan settings saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <section id="revenue-plan-settings" tabIndex={-1} className="scroll-mt-4" aria-labelledby="revenue-plan-settings-heading">
      <h2 id="revenue-plan-settings-heading" className="text-group font-semibold tracking-[-0.01em]">{t('settings.title', 'Revenue plan')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('settings.helper', 'Plan each work order\'s revenue by date and read it against validated daily revenue. Off until you switch it on; switching it on changes nothing already entered.')}</p>
      {q.isError && !q.data ? <ListState variant="error" title={t('settings.loadError', "Couldn't load the setting")} onRetry={() => void q.refetch()} />
        : !current ? <ListState variant="loading" rows={2} />
        : (
          <div className="mt-4 space-y-4">
            <Checkbox checked={current.enabled} onChange={(v) => setDraft({ ...current, enabled: v })} label={t('settings.enabled', 'Use the revenue plan')} />
            <fieldset className="space-y-2">
              <legend className="text-control font-medium">{t('settings.weekdays', 'Working days')}</legend>
              <p className="text-control text-muted-foreground">{t('settings.weekdaysHelp', 'A month amount is spread evenly over these weekdays.')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {WEEKDAYS.map((d) => (
                  <Checkbox key={d} checked={current.weekdays.includes(d)} label={dayName(d)}
                    onChange={(v) => setDraft({ ...current, weekdays: v ? [...current.weekdays, d] : current.weekdays.filter((x) => x !== d) })} />
                ))}
              </div>
            </fieldset>
            {error && <p role="alert" className="text-control text-destructive">{error}</p>}
            <Button variant="primary" disabled={!draft || current.weekdays.length === 0} loading={m.isPending} onClick={() => void save()}>{t('settings.save', 'Save')}</Button>
          </div>
        )}
    </section>
  );
};
export default RevenuePlanSettings;
