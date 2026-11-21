import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, TextField, useToast } from '@/src/components/ui';
import type { MyHomeWorkOrder } from '@/src/lib/repositories/myHome';
import { useClockIn } from '@/src/hooks/useMyHome';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { MySection } from './MySection';

/**
 * Clock in at a work order where the person is rostered today. Calls the existing attendance path (`phone_check_in`).
 * SEAM FOR #2705: `locationCheck` runs before the write and may refuse (returns a reason) or pass (null). Absent, no location is tested.
 * A work order the person is not rostered on is not offered; the off-roster case is a request to the supervisor.
 */
export const ClockInSection: React.FC<{
  today: string; workOrders: MyHomeWorkOrder[];
  locationCheck?: (workOrderId: string) => Promise<string | null>;
}> = ({ today, workOrders, locationCheck }) => {
  const { t } = useTranslation('myHome');
  const { toast } = useToast();
  const clockIn = useClockIn();
  const [hours, setHours] = useState('8');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const go = async (wo: MyHomeWorkOrder) => {
    setError(null);
    const h = Number(hours);
    if (!wo.my_worker_id || !Number.isFinite(h) || h < 0 || h > 24) { setError(t('myHome:clockIn.hoursRange', 'Hours run from 0 to 24')); return; }
    const refusal = locationCheck ? await locationCheck(wo.work_order_id) : null;
    if (refusal) { setError(refusal); return; }
    try {
      await clockIn.mutateAsync({ workOrderId: wo.work_order_id, date: today, workerId: wo.my_worker_id, hours: h });
      setDone((d) => ({ ...d, [wo.work_order_id]: true }));
      toast(t('myHome:clockIn.saved', 'Clocked in'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <MySection id="my-clock-in" title={t('myHome:clockIn.title', 'Clock in')}>
      {workOrders.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('myHome:clockIn.empty', 'You are not rostered on a work order today')}</p>
      ) : (
        <>
          <TextField label={t('myHome:clockIn.hours', 'Hours today')} type="number" inputMode="decimal" value={hours} onChange={setHours} />
          <ul className="space-y-2">
            {workOrders.map((wo) => (
              <li key={wo.work_order_id} className="rounded-md border border-border p-3">
                <p className="text-control font-semibold">{wo.title}</p>
                <p className="text-control text-muted-foreground">{wo.project_name} · {wo.crew_name}</p>
                <Button variant="primary" className="mt-2 min-h-11" disabled={clockIn.isPending || done[wo.work_order_id] || !wo.my_worker_id} onClick={() => void go(wo)}>
                  {done[wo.work_order_id] ? t('myHome:clockIn.clockedIn', 'Clocked in') : t('myHome:clockIn.action', 'Clock in')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
      <p className="text-control text-muted-foreground">
        {t('myHome:clockIn.offRoster', 'Not on this list? Ask your supervisor to add you to the work order.')}
      </p>
    </MySection>
  );
};
