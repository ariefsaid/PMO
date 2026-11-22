import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DateField, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDate } from '@/src/lib/format';
import { useRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';
import { useNonWorkingDateMutations, useNonWorkingDates } from '@/src/hooks/useWorkOrderDailyTarget';

/**
 * Administration › Projects › Non-working dates (#2672, FR-WDT-001..003, migration 1280): dates the organisation does not
 * work (holidays, shutdowns) on top of its working weekdays. A month amount is spread over the remaining working days;
 * editing the list never moves a target already entered. Admin only (`can('manage', 'revenuePlanSettings')`, UX); the
 * non_working_date_add/remove RPCs are the authority (ADR-0016). Shown only while the revenue plan is switched on.
 */
const NonWorkingDatesCard: React.FC = () => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const { toast } = useToast();
  const may = usePermission();
  const settings = useRevenuePlanSettings();
  const on = may('manage', 'revenuePlanSettings') && settings.data?.enabled === true;
  const q = useNonWorkingDates(on);
  const m = useNonWorkingDateMutations();
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<string | null>(null);
  if (!on) return null;

  const dateMissing = !/^\d{4}-\d{2}-\d{2}$/.test(date);
  const fail = (err: unknown) => { const { headline, detail } = classifyMutationError(err); setError(detail || headline); };
  const add = async () => {
    setTried(true);
    setError(undefined);
    if (dateMissing) return;
    try {
      await m.add.mutateAsync({ date, label });
      setDate(''); setLabel(''); setTried(false);
      toast(t('nonWorking.added', 'Non-working date added'), undefined, 'success');
    } catch (err) { fail(err); }
  };
  const remove = async () => {
    if (!removing) return;
    try {
      await m.remove.mutateAsync({ date: removing });
      setRemoving(null);
      toast(t('nonWorking.removed', 'Non-working date removed'), undefined, 'success');
    } catch (err) { fail(err); setRemoving(null); }
  };

  return (
    <section id="non-working-dates" tabIndex={-1} className="scroll-mt-4" aria-labelledby="non-working-dates-heading">
      <h2 id="non-working-dates-heading" className="text-group font-semibold tracking-[-0.01em]">{t('nonWorking.title', 'Non-working dates')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('nonWorking.helper', 'Dates your organisation does not work, on top of the working days above. A month amount is spread over the other days. Dates you add now do not change targets already entered.')}</p>
      <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <DateField id="nwd-date" label={t('nonWorking.date', 'Date')} value={date} onChange={setDate} fullWidth
          error={tried && dateMissing ? t('nonWorking.dateRequired', 'Enter a date.') : undefined} />
        <TextField id="nwd-label" label={t('nonWorking.label', 'Label (optional)')} value={label} onChange={setLabel} maxLength={80} />
        <Button variant="primary" loading={m.add.isPending} onClick={() => void add()}>{t('nonWorking.add', 'Add date')}</Button>
      </div>
      {error && <p role="alert" className="mt-2 text-control text-destructive">{error}</p>}
      <div className="mt-4">
        {q.isError ? <ListState variant="error" title={t('nonWorking.loadError', "Couldn't load the non-working dates")} onRetry={() => void q.refetch()} />
          : q.isPending ? <ListState variant="loading" rows={2} />
          : (q.data ?? []).length === 0 ? <p className="text-control text-muted-foreground" data-testid="nwd-empty">{t('nonWorking.empty', 'No non-working dates. Every working day counts.')}</p>
          : (
            <ul className="max-w-xl divide-y divide-border text-control" data-testid="nwd-list">
              {(q.data ?? []).map((d) => (
                <li key={d.date} className="flex items-center justify-between gap-3 py-2" data-testid={`nwd-${d.date}`}>
                  <span>{formatDate(d.date)}{d.label ? <span className="text-muted-foreground"> · {d.label}</span> : null}</span>
                  <Button variant="outline" size="sm" onClick={() => setRemoving(d.date)}>{t('nonWorking.remove', 'Remove')}</Button>
                </li>
              ))}
            </ul>
          )}
      </div>
      <ConfirmDialog open={removing !== null} title={t('nonWorking.removeTitle', 'Remove non-working date')}
        description={t('nonWorking.removeBody', 'This date counts as a working day again. Targets already entered do not change.')}
        confirmLabel={t('nonWorking.remove', 'Remove')} loading={m.remove.isPending} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </section>
  );
};
export default NonWorkingDatesCard;
