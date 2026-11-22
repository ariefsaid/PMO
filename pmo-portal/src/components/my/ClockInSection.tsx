import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, TextField, useToast } from '@/src/components/ui';
import type { MyHomeWorkOrder } from '@/src/lib/repositories/myHome';
import { useClockIn } from '@/src/hooks/useMyHome';
import { usePhoneCheckIn } from '@/src/hooks/usePhoneCheckIn';
import { useRefusalText } from '@/src/lib/refusals';
import {
  clearResumeGuard, documentAllowsGeolocation, hardNavigateForGeolocation, PositionError, readPositionOnce, type PositionFailure,
} from '@/src/lib/position';
import { MySection } from './MySection';

/**
 * Clock in at a work order where the person is rostered today. Calls the existing attendance path (`phone_check_in`).
 * SEAM FOR #2705: `locationCheck` runs before the write and may refuse (returns a reason) or pass (null). Absent, no location is tested.
 * A work order the person is not rostered on is not offered; the off-roster case is a request to the supervisor.
 *
 * #2705: a work order with a check-in area (`has_area`) reads the position ONCE on the tap (the only place the app asks the browser
 * for it) and sends it to the `phone_check_in` RPC, which decides inside / outside; outside, off-roster or no position becomes a
 * request to the supervisor. A work order with no area keeps today's path exactly (no location asked).
 */
export const ClockInSection: React.FC<{
  today: string; workOrders: MyHomeWorkOrder[];
  locationCheck?: (workOrderId: string) => Promise<string | null>;
}> = ({ today, workOrders, locationCheck }) => {
  const { t } = useTranslation('myHome');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const clockIn = useClockIn();
  const checkIn = usePhoneCheckIn();
  const [hours, setHours] = useState('8');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [noFix, setNoFix] = useState<Record<string, PositionFailure>>({});
  const [reading, setReading] = useState<string | null>(null);
  const resumed = useRef(false);

  const failureText = (f: PositionFailure) => ({
    denied: t('myHome:clockIn.positionDenied', 'Location is blocked for this site. Allow it in your browser, or ask your supervisor to approve your check-in.'),
    unavailable: t('myHome:clockIn.positionUnavailable', 'Your position could not be read. Try again, or ask your supervisor to approve your check-in.'),
    timeout: t('myHome:clockIn.positionTimeout', 'Reading your position took too long. Try again, or ask your supervisor to approve your check-in.'),
  })[f];

  const outcomeText = (outcome: string | undefined) => outcome === 'not_rostered'
    ? t('myHome:clockIn.pendingNotRostered', "You are not on this work order's roster today. Your supervisor has been asked to approve this check-in.")
    : outcome === 'no_position'
      ? t('myHome:clockIn.pendingNoPosition', 'Sent to your supervisor to approve.')
      : t('myHome:clockIn.pendingOutside', 'You are outside the work area. Your supervisor has been asked to approve this check-in.');

  const send = async (wo: MyHomeWorkOrder, h: number, position?: { lat: number; lng: number; accuracy: number }) => {
    try {
      const res = await checkIn.mutateAsync({ workOrderId: wo.work_order_id, crewId: wo.crew_id, hours: h, position, noPosition: !position });
      if (res.status === 'recorded') {
        setDone((d) => ({ ...d, [wo.work_order_id]: true }));
        toast(t('myHome:clockIn.saved', 'Clocked in'), undefined, 'success');
      } else {
        setNote((n) => ({ ...n, [wo.work_order_id]: outcomeText(res.outcome) }));
        setNoFix((f) => { const next = { ...f }; delete next[wo.work_order_id]; return next; });
      }
    } catch (err) {
      const { headline, detail } = refusal(err);
      setError(detail || headline);
    }
  };

  const goWithArea = async (wo: MyHomeWorkOrder, h: number) => {
    // The permissions policy is per document: a client-side navigation into /my keeps the earlier page's policy, so load /my afresh once.
    if (!documentAllowsGeolocation()) {
      if (hardNavigateForGeolocation(wo.work_order_id)) { setError(t('myHome:clockIn.reloading', 'Opening the clock-in page to read your position…')); return; }
      setError(t('myHome:clockIn.reloadFailed', 'Reload this page, then tap Clock in again.'));
      return;
    }
    setReading(wo.work_order_id);
    try {
      const fix = await readPositionOnce();
      clearResumeGuard();
      await send(wo, h, fix);
    } catch (err) {
      if (err instanceof PositionError) setNoFix((f) => ({ ...f, [wo.work_order_id]: err.reason }));
      else setError(String(err instanceof Error ? err.message : err));
    } finally { setReading(null); }
  };

  const go = async (wo: MyHomeWorkOrder) => {
    setError(null);
    const h = Number(hours);
    if (!wo.my_worker_id || !Number.isFinite(h) || h < 0 || h > 24) { setError(t('myHome:clockIn.hoursRange', 'Hours run from 0 to 24')); return; }
    const blocked = locationCheck ? await locationCheck(wo.work_order_id) : null;
    if (blocked) { setError(blocked); return; }
    if (wo.has_area) { await goWithArea(wo, h); return; }
    try {
      await clockIn.mutateAsync({ workOrderId: wo.work_order_id, date: today, workerId: wo.my_worker_id, hours: h });
      setDone((d) => ({ ...d, [wo.work_order_id]: true }));
      toast(t('myHome:clockIn.saved', 'Clocked in'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = refusal(err);
      setError(detail || headline);
    }
  };

  // After the hard navigation (`/my?clockin=<work order>`) the tap resumes once, in a document that allows geolocation.
  useEffect(() => {
    if (resumed.current || workOrders.length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get('clockin');
    if (!wanted) return;
    const wo = workOrders.find((w) => w.work_order_id === wanted);
    if (!wo) return;
    resumed.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    void go(wo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrders]);

  const busy = clockIn.isPending || checkIn.isPending || reading !== null;
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
                <Button variant="primary" className="mt-2 min-h-11" disabled={busy || done[wo.work_order_id] || Boolean(note[wo.work_order_id]) || !wo.my_worker_id} onClick={() => void go(wo)}>
                  {done[wo.work_order_id] ? t('myHome:clockIn.clockedIn', 'Clocked in') : t('myHome:clockIn.action', 'Clock in')}
                </Button>
                {reading === wo.work_order_id && <p role="status" className="mt-2 text-control text-muted-foreground">{t('myHome:clockIn.locating', 'Reading your position…')}</p>}
                {noFix[wo.work_order_id] && (
                  <div className="mt-2 space-y-2">
                    <p role="alert" className="text-control">{failureText(noFix[wo.work_order_id])}</p>
                    <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void send(wo, Number(hours))}>
                      {t('myHome:clockIn.askSupervisor', 'Ask my supervisor')}
                    </Button>
                  </div>
                )}
                {note[wo.work_order_id] && <p role="status" className="mt-2 text-control">{note[wo.work_order_id]}</p>}
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
