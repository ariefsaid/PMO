import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, FieldError, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { BUILT_IN_ROLES, builtInRoleName } from '@/src/auth/builtInRoles';
import { useSetSupervisorRole, useSetWorkOrderArea, useSupervisorRole, useWorkOrderArea } from '@/src/hooks/usePhoneCheckIn';
import { useRefusalText } from '@/src/lib/refusals';
import { clearResumeGuard, documentAllowsGeolocation, hardNavigateForGeolocation, PositionError, readPositionOnce, type Fix } from '@/src/lib/position';
import { WorkOrderPicker } from './CrewPickers';

const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

/**
 * The two check-in settings (#2705): the area of a work order (a point and a radius in metres; empty = no location is asked) and,
 * for an Admin, who decides outside-area check-ins. Whoever may edit work orders sets the area through the database's role-gated
 * RPC; everyone else who opens the Roster view, the supervisor who decides included, sees the area read-only. The database is the
 * authority for both writes.
 */
export const CheckInSettings: React.FC = () => {
  const { t, i18n } = useTranslation('crews');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const may = usePermission();
  const canArea = may('create', 'workOrder');
  const canManageSupervisor = may('manage', 'checkInSettings');
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const area = useWorkOrderArea(workOrderId);
  const setArea = useSetWorkOrderArea();
  const role = useSupervisorRole(canManageSupervisor);
  const setRole = useSetSupervisorRole();
  const [lat, setLat] = useState(''); const [lng, setLng] = useState(''); const [radius, setRadius] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const fix = useRef<Fix | null>(null);
  const resumed = useRef(false);
  const put = (f: Fix) => { setLat(String(Number(f.lat.toFixed(6)))); setLng(String(Number(f.lng.toFixed(6)))); setAccuracy(Math.round(f.accuracy)); };
  useEffect(() => {
    if (fix.current) { put(fix.current); setRadius(area.data ? String(area.data.radius_m) : ''); return; }
    setAccuracy(null);
    setLat(area.data ? String(area.data.lat) : ''); setLng(area.data ? String(area.data.lng) : ''); setRadius(area.data ? String(area.data.radius_m) : '');
  }, [area.data, workOrderId]);
  const positionText = (e: unknown) => ({
    denied: t('crews:checkIn.areaLocateDenied', 'Location is blocked for this site. Allow it in your browser, or type the numbers.'),
    unavailable: t('crews:checkIn.areaLocateUnavailable', 'Your position could not be read. Try again, or type the numbers.'),
    timeout: t('crews:checkIn.areaLocateTimeout', 'Reading your position took too long. Try again, or type the numbers.'),
  })[e instanceof PositionError ? e.reason : 'unavailable'];
  // The permissions policy is per document: one fresh load of /crews (guarded, no loop) lets the browser read the position.
  const locate = async (wo: string) => {
    setError(null);
    if (!documentAllowsGeolocation()) {
      if (hardNavigateForGeolocation(wo, window.location, `/crews?view=roster&locate=${encodeURIComponent(wo)}`)) return;
      setError(t('crews:checkIn.areaReload', 'Reload this page, then tap Use my current location again.')); return;
    }
    try { const f = await readPositionOnce(); clearResumeGuard(); fix.current = f; put(f); } catch (e) { setError(positionText(e)); }
  };
  useEffect(() => {
    if (resumed.current) return;
    const wanted = new URLSearchParams(window.location.search).get('locate');
    if (!wanted) return;
    resumed.current = true;
    window.history.replaceState(null, '', `${window.location.pathname}?view=roster`);
    setWorkOrderId(wanted);
    void locate(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const roleOptions = useMemo(() => [
    { value: '', label: t('crews:checkIn.supervisorRoleDefault', "The crew's field controller or a crew manager") },
    ...BUILT_IN_ROLES.map((r) => ({ value: r.key, label: builtInRoleName(r.key, i18n.language) })),
  ], [t, i18n.language]);

  const areaLine = area.data
    ? t('crews:checkIn.areaCurrent', 'Centre {{latitude}}, {{longitude}}, radius {{radius}} m', { latitude: area.data.lat, longitude: area.data.lng, radius: area.data.radius_m })
    : t('crews:checkIn.areaNone', 'No check-in area is set on this work order. Ask a project manager to set it.');
  const fail = (err: unknown) => { const { headline, detail } = refusal(err); setError(detail || headline); };
  const save = async () => {
    setError(null);
    const a = { lat: Number(lat), lng: Number(lng), radius_m: Number(radius) };
    if (!workOrderId || lat.trim() === '' || lng.trim() === '' || radius.trim() === ''
        || !inRange(a.lat, -90, 90) || !inRange(a.lng, -180, 180) || !(a.radius_m > 0 && a.radius_m <= 50000)) {
      setError(t('crews:checkIn.areaInvalid', 'Enter a latitude from -90 to 90, a longitude from -180 to 180 and a radius above 0')); return;
    }
    try { await setArea.mutateAsync({ workOrderId, area: a }); toast(t('crews:checkIn.areaSaved', 'Area saved'), undefined, 'success'); } catch (e) { fail(e); }
  };
  const clear = async () => {
    setError(null);
    if (!workOrderId) return;
    try { await setArea.mutateAsync({ workOrderId, area: null }); toast(t('crews:checkIn.areaSaved', 'Area saved'), undefined, 'success'); } catch (e) { fail(e); }
  };

  return (
    <Card className="mt-4" aria-label={t('crews:checkIn.areaTitle', 'Check-in area')}>
      <CardHead>{t('crews:checkIn.areaTitle', 'Check-in area')}</CardHead>
      <CardPad className="space-y-3">
        {canArea && (
          <>
            <p className="text-control text-muted-foreground">{t('crews:checkIn.areaHelper', 'People clock in from their phone inside this area. Leave it empty to clock in without asking for a location.')}</p>
            <WorkOrderPicker id="checkin-area-wo" value={workOrderId} onChange={(id) => { fix.current = null; setWorkOrderId(id); }} />
            {workOrderId && (
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField label={t('crews:checkIn.areaLat', 'Latitude')} type="number" inputMode="decimal" value={lat} onChange={setLat} />
                <TextField label={t('crews:checkIn.areaLng', 'Longitude')} type="number" inputMode="decimal" value={lng} onChange={setLng} />
                <TextField label={t('crews:checkIn.areaRadius', 'Radius (metres)')} type="number" inputMode="decimal" value={radius} onChange={setRadius} />
              </div>
            )}
            {workOrderId && (
              <div className="space-y-2">
                <Button variant="outline" className="min-h-11" disabled={setArea.isPending} onClick={() => void locate(workOrderId)}>
                  {t('crews:checkIn.areaUseMine', 'Use my current location')}
                </Button>
                {accuracy !== null && <p role="status" className="text-control text-muted-foreground">{t('crews:checkIn.areaFix', 'Position read, accurate to about {{metres}} m. Set the radius, then save.', { metres: accuracy })}</p>}
              </div>
            )}
            {workOrderId && (
              <div className="flex gap-2">
                <Button variant="primary" className="min-h-11" disabled={setArea.isPending} onClick={() => void save()}>{t('crews:checkIn.areaSave', 'Save area')}</Button>
                <Button variant="outline" className="min-h-11" disabled={setArea.isPending || !area.data} onClick={() => void clear()}>{t('crews:checkIn.areaClear', 'Clear area')}</Button>
              </div>
            )}
          </>
        )}
        {!canArea && (
          <>
            <p className="text-control text-muted-foreground">{t('crews:checkIn.areaHelperRead', 'People clock in from their phone inside this area. A work order with no area asks for no location.')}</p>
            <WorkOrderPicker id="checkin-area-wo" value={workOrderId} onChange={setWorkOrderId} />
            {workOrderId && !area.isPending && <p role="status" className="text-control">{areaLine}</p>}
          </>
        )}
        {canManageSupervisor && (
          <SelectField label={t('crews:checkIn.supervisorRole', 'Who decides outside-area check-ins')} value={role.data ?? ''}
            helper={t('crews:checkIn.supervisorRoleHelper', 'Anyone holding this role decides. The person who checked in never decides their own.')}
            options={roleOptions} disabled={role.isPending || setRole.isPending}
            onChange={(v) => { setError(null); setRole.mutate(v === '' ? null : v, { onError: fail }); }} />
        )}
        {error && <FieldError>{error}</FieldError>}
      </CardPad>
    </Card>
  );
};
