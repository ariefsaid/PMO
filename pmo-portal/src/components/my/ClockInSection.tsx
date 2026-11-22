import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, TextField, useToast } from '@/src/components/ui';
import type { MyHomeCheckIn, MyHomeWorkOrder } from '@/src/lib/repositories/myHome';
import { builtInRoleName } from '@/src/auth/builtInRoles';
import { usePhoneCheckIn } from '@/src/hooks/usePhoneCheckIn';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  clearResumeGuard, documentAllowsGeolocation, hardNavigateForGeolocation, PositionError, readPositionOnce, type PositionFailure,
} from '@/src/lib/position';
import { formatInstantTime } from '@/src/lib/format';
import { MySection } from './MySection';

/**
 * Clock in at a work order where the person is rostered today, or whose crew the person leads (a Foreman). Every tap is the
 * `phone_check_in` RPC, which records through the attendance path. The card says what became of the tap: clocked in with the time,
 * waiting for the supervisor (and who decides), or refused with the reason; the state comes from the database (`my_home`), so it
 * survives a reload and a second tap never meets "already clocked in".
 * SEAM FOR #2705: `locationCheck` runs before the write and may refuse (returns a reason) or pass (null). Absent, no location is tested.
 *
 * #2705: a work order with a check-in area (`has_area`) reads the position ONCE on the tap (the only place the app asks the browser
 * for it) and sends it to the `phone_check_in` RPC, which decides inside / outside; outside, off-roster or no position becomes a
 * request to the supervisor. A work order with no area keeps today's path exactly (no location asked).
 */
export const ClockInSection: React.FC<{
  today: string; workOrders: MyHomeWorkOrder[];
  /** The built-in role key that decides outside-area check-ins; null = the crew's Foreman or a crew manager. */
  deciderRole?: string | null;
  locationCheck?: (workOrderId: string) => Promise<string | null>;
}> = ({ workOrders, deciderRole = null, locationCheck }) => {
  const { t, i18n } = useTranslation('myHome');
  const { toast } = useToast();
  const checkIn = usePhoneCheckIn();
  const [hours, setHours] = useState('8');
  const [error, setError] = useState<string | null>(null);
  // What this tap just did, shown at once; the database state (`wo.check_in`) takes over after the next read.
  const [seen, setSeen] = useState<Record<string, MyHomeCheckIn>>({});
  const [noFix, setNoFix] = useState<Record<string, PositionFailure>>({});
  const [reading, setReading] = useState<string | null>(null);
  const resumed = useRef(false);
  const keyOf = (wo: MyHomeWorkOrder) => `${wo.work_order_id}:${wo.crew_id}`;
  const timeText = (at: string | null | undefined) => at ? formatInstantTime(at) : '';
  const who = deciderRole ? builtInRoleName(deciderRole, i18n.language) : t('myHome:clockIn.whoDefault', 'your supervisor');

  const failureText = (f: PositionFailure) => ({
    denied: t('myHome:clockIn.positionDenied', 'Location is blocked for this site. Allow it in your browser, or ask your supervisor to approve your check-in.'),
    unavailable: t('myHome:clockIn.positionUnavailable', 'Your position could not be read. Try again, or ask your supervisor to approve your check-in.'),
    timeout: t('myHome:clockIn.positionTimeout', 'Reading your position took too long. Try again, or ask your supervisor to approve your check-in.'),
  })[f];

  // The database's coded messages are English; a worker reads his own language.
  const friendly = (msg: string | undefined): string | null => !msg ? null : /PCI_POSITION/.test(msg) ? t('myHome:clockIn.positionInvalid', 'Your position could not be read. Tap Ask my supervisor, or try again.')
    : /PCI_NO_PERSON/.test(msg) ? t('myHome:clockIn.noPerson', 'You are not in the workforce list yet. Ask your supervisor.')
    : /PCI_CREW/.test(msg) ? t('myHome:clockIn.notInCrew', 'You are not in that crew today. Pick another crew or ask your supervisor.')
    : /ATT_NOT_ROSTERED/.test(msg) ? t('myHome:clockIn.notRostered', 'You are not rostered on a work order today. Ask your supervisor.')
    : null;

  const send = async (wo: MyHomeWorkOrder, h: number, position?: { lat: number; lng: number; accuracy: number }) => {
    try {
      const res = await checkIn.mutateAsync({ workOrderId: wo.work_order_id, crewId: wo.crew_id, hours: h, position, noPosition: !position && Boolean(wo.has_area) });
      const at = new Date().toISOString();
      if (res.status === 'recorded') {
        setSeen((d) => ({ ...d, [keyOf(wo)]: { state: 'clocked_in', at } }));
        toast(t('myHome:clockIn.saved', 'Clocked in'), undefined, 'success');
      } else {
        setSeen((d) => ({ ...d, [keyOf(wo)]: { state: 'pending', at, outcome: res.outcome } }));
        setNoFix((f) => { const next = { ...f }; delete next[keyOf(wo)]; return next; });
      }
    } catch (err) {
      const { headline, detail, rawDetail } = classifyMutationError(err);
      setError(friendly(rawDetail) ?? (detail || headline));
    }
  };

  const goWithArea = async (wo: MyHomeWorkOrder, h: number) => {
    // The permissions policy is per document: a client-side navigation into /my keeps the earlier page's policy, so load /my afresh once.
    if (!documentAllowsGeolocation()) {
      if (hardNavigateForGeolocation(wo.work_order_id)) { setError(t('myHome:clockIn.reloading', 'Opening the clock-in page to read your position…')); return; }
      setError(t('myHome:clockIn.reloadFailed', 'Reload this page, then tap Clock in again.'));
      return;
    }
    setReading(keyOf(wo));
    try {
      const fix = await readPositionOnce();
      clearResumeGuard();
      await send(wo, h, fix);
    } catch (err) {
      if (err instanceof PositionError) setNoFix((f) => ({ ...f, [keyOf(wo)]: err.reason }));
      else setError(friendly(String(err instanceof Error ? err.message : err)) ?? String(err instanceof Error ? err.message : err));
    } finally { setReading(null); }
  };

  const go = async (wo: MyHomeWorkOrder) => {
    setError(null);
    const h = Number(hours);
    if (!Number.isFinite(h) || h < 0 || h > 24) { setError(t('myHome:clockIn.hoursRange', 'Hours run from 0 to 24')); return; }
    const refusal = locationCheck ? await locationCheck(wo.work_order_id) : null;
    if (refusal) { setError(refusal); return; }
    if (wo.has_area) { await goWithArea(wo, h); return; }
    await send(wo, h);
  };

  // A fresh read of the home is the truth: what this tap showed gives way to it.
  useEffect(() => { setSeen({}); }, [workOrders]);

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

  const busy = checkIn.isPending || reading !== null;
  const stateOf = (wo: MyHomeWorkOrder): MyHomeCheckIn | null => seen[keyOf(wo)] ?? wo.check_in ?? null;
  const stateText = (c: MyHomeCheckIn) => c.state === 'clocked_in'
    ? t('myHome:clockIn.clockedInAt', 'Clocked in at {{time}}', { time: timeText(c.at) })
    : c.state === 'pending'
      ? `${c.outcome === 'not_rostered' ? t('myHome:clockIn.pendingNotRostered', "You are not on this work order's roster today.") + ' '
        : c.outcome === 'outside' ? t('myHome:clockIn.pendingOutsideShort', 'You are outside the work area.') + ' ' : ''}${
        t('myHome:clockIn.waiting', 'Sent at {{time}}. Waiting for {{who}} to approve.', { time: timeText(c.at), who })}`
      : t('myHome:clockIn.refused', '{{who}} refused this check-in: {{reason}}', { who, reason: c.reason ?? '' });
  return (
    <MySection id="my-clock-in" title={t('myHome:clockIn.title', 'Clock in')}>
      {workOrders.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('myHome:clockIn.empty', 'You are not rostered on a work order today. Ask your supervisor.')}</p>
      ) : (
        <>
          <TextField label={t('myHome:clockIn.hours', 'Hours today')} type="number" inputMode="decimal" value={hours} onChange={setHours} />
          <ul className="space-y-2">
            {workOrders.map((wo) => {
              const k = keyOf(wo);
              const c = stateOf(wo);
              return (
                <li key={k} className="rounded-md border border-border p-3">
                  <p className="text-control font-semibold">{wo.title}</p>
                  <p className="text-control text-muted-foreground">{wo.project_name}</p>
                  <p className="text-control">{t('myHome:clockIn.crew', 'Crew: {{crew}}', { crew: wo.crew_name })}</p>
                  {c && <p role="status" data-testid="clock-in-state" className="mt-2 text-control font-semibold">{stateText(c)}</p>}
                  {(!c || c.state === 'rejected') && (
                    <Button variant="primary" className="mt-2 min-h-11" disabled={busy} onClick={() => void go(wo)}>
                      {c ? t('myHome:clockIn.again', 'Clock in again') : t('myHome:clockIn.action', 'Clock in')}
                    </Button>
                  )}
                  {reading === k && <p role="status" className="mt-2 text-control text-muted-foreground">{t('myHome:clockIn.locating', 'Reading your position…')}</p>}
                  {noFix[k] && (
                    <div className="mt-2 space-y-2">
                      <p role="alert" className="text-control">{failureText(noFix[k])}</p>
                      <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void send(wo, Number(hours))}>
                        {t('myHome:clockIn.askSupervisor', 'Ask my supervisor')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
    </MySection>
  );
};
