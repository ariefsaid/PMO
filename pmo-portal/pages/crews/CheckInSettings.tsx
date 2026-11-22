import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, FieldError, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { BUILT_IN_ROLES, builtInRoleName } from '@/src/auth/builtInRoles';
import { useSetSupervisorRole, useSetWorkOrderArea, useSupervisorRole, useWorkOrderArea } from '@/src/hooks/usePhoneCheckIn';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { WorkOrderPicker } from './CrewPickers';

const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

/**
 * The clients' two check-in settings (#2705): the area of a work order (a point and a radius; empty = no location is asked) and,
 * for an Admin, who decides outside-area check-ins. The database is the authority for both (work-order update RLS; Admin-only RPC).
 */
export const CheckInSettings: React.FC = () => {
  const { t, i18n } = useTranslation('crews');
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
  useEffect(() => {
    setLat(area.data ? String(area.data.lat) : ''); setLng(area.data ? String(area.data.lng) : ''); setRadius(area.data ? String(area.data.radius_m) : '');
  }, [area.data, workOrderId]);
  const roleOptions = useMemo(() => [
    { value: '', label: t('crews:checkIn.supervisorRoleDefault', "The crew's field controller or a crew manager") },
    ...BUILT_IN_ROLES.map((r) => ({ value: r.key, label: builtInRoleName(r.key, i18n.language) })),
  ], [t, i18n.language]);
  if (!canArea && !canManageSupervisor) return null;

  const fail = (err: unknown) => { const { headline, detail } = classifyMutationError(err); setError(detail || headline); };
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
            <WorkOrderPicker id="checkin-area-wo" value={workOrderId} onChange={setWorkOrderId} />
            {workOrderId && (
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField label={t('crews:checkIn.areaLat', 'Latitude')} type="number" inputMode="decimal" value={lat} onChange={setLat} />
                <TextField label={t('crews:checkIn.areaLng', 'Longitude')} type="number" inputMode="decimal" value={lng} onChange={setLng} />
                <TextField label={t('crews:checkIn.areaRadius', 'Radius (metres)')} type="number" inputMode="decimal" value={radius} onChange={setRadius} />
              </div>
            )}
            {workOrderId && (
              <div className="flex gap-2">
                <Button variant="primary" disabled={setArea.isPending} onClick={() => void save()}>{t('crews:checkIn.areaSave', 'Save area')}</Button>
                <Button variant="outline" disabled={setArea.isPending || !area.data} onClick={() => void clear()}>{t('crews:checkIn.areaClear', 'Clear area')}</Button>
              </div>
            )}
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
