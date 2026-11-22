import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, Combobox, DateField, FieldError, ListState, ReasonDialog, SelectField, StatusPill, TextField, useToast, useUrlFilters,
} from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useReleaseHolds } from '@/src/hooks/useMedicalRelease';
import type { ReleaseState } from '@/src/lib/repositories/medicalRelease';
import { useAuth } from '@/src/auth/useAuth';
import {
  useAllCrewMembers, useAttendanceDay, useAttendanceMutations, useAwaitingAttendance, useCrewWorkers, useWorkOrderRoster,
} from '@/src/hooks/useCrews';
import type { AttendanceDayRow, AttendanceStatus, RosterCrew, RosterMember } from '@/src/lib/repositories/crews';
import { addFollower, buildTickRows, initialTickState, isoWeekStart, type TickError, type TickState } from '@/src/lib/attendanceTick';
import { formatDay, formatNumberMax2 } from '@/src/lib/format';
import { toIso } from '../equipment/equipmentWeek';
import { WorkOrderPicker } from './CrewPickers';
import { useCrewErrorText } from './crewErrors';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: AttendanceStatus[] = ['present', 'absent', 'leave', 'off_rotation'];
const NO_HOLDS: ReadonlyMap<string, ReleaseState> = new Map();

/** The tick form for one crew on one day (FR-CRW-009/010). Keyed by crew, date and held records, so it starts fresh. */
export const TickForm: React.FC<{ crew: RosterCrew; workOrderId: string; date: string; held: AttendanceDayRow[]; canRecord: boolean; releaseHolds?: ReadonlyMap<string, ReleaseState> }> = ({
  crew, workOrderId, date, held, canRecord, releaseHolds = NO_HOLDS,
}) => {
  const { t } = useTranslation('crews');
  const writeError = useCrewErrorText();
  const { toast } = useToast();
  const { record, uploadPhoto, generateWeek } = useAttendanceMutations();
  const workers = useCrewWorkers();
  const placements = useAllCrewMembers();
  const [state, setState] = useState<TickState>(() => initialTickState(
    crew.members.map((m) => ({ worker_id: m.worker_id, off_rotation: Boolean(m.off_rotation) })),
    held.filter((h) => crew.members.some((m) => m.worker_id === h.worker_id)),
  ));
  const [errors, setErrors] = useState<Record<string, TickError>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(() => crew.members.length === 0 || crew.members.some((m) => !held.some((day) => day.worker_id === m.worker_id)));
  const [problem, setProblem] = useState<string | null>(null);
  const statusLabel = (s: AttendanceStatus) => ({
    present: t('crews:status.present', 'Present'), absent: t('crews:status.absent', 'Absent'),
    leave: t('crews:status.leave', 'Leave'), off_rotation: t('crews:status.offRotation', 'Off rotation'),
  })[s];
  const errorText = (e: TickError) => ({
    hoursRequired: t('crews:tickErrors.hoursRequired', 'Enter hours'),
    hoursRange: t('crews:tickErrors.hoursRange', 'Hours run from 0 to 24'),
    overtimeRange: t('crews:tickErrors.overtimeRange', 'Overtime runs from 0 to 24'),
    reasonRequired: t('crews:tickErrors.reasonRequired', 'Off rotation: give a reason'),
  })[e];
  const setPerson = (id: string, patch: Partial<TickState['people'][string]>) => {
    setDirty(true);
    setState((s) => ({ ...s, people: { ...s.people, [id]: { ...s.people[id], ...patch } } }));
  };

  const names = useMemo(() => new Map((workers.data ?? []).map((w) => [w.id, w.display_name])), [workers.data]);
  // The crew's own members, then the people added from another crew in this session (not yet saved).
  const rows = useMemo<RosterMember[]>(() => [
    ...crew.members,
    ...state.followers.map((id) => ({ worker_id: id, display_name: names.get(id) ?? '—', standard_role_id: null })),
  ], [crew.members, state.followers, names]);
  // Active people placed in a crew that day, other than this crew's own members and anyone already listed or recorded today.
  const addable = useMemo(() => {
    const placed = new Set((placements.data ?? [])
      .filter((m) => m.valid_from <= date && (m.valid_to === null || m.valid_to >= date)).map((m) => m.worker_id));
    const recorded = new Set(held.map((h) => h.worker_id));
    return (workers.data ?? []).filter((w) => placed.has(w.id) && !state.people[w.id] && !recorded.has(w.id))
      .map((w) => ({ value: w.id, label: w.display_name }));
  }, [workers.data, placements.data, held, state.people, date]);
  const follow = (id: string) => {
    if (!id) return;
    setDirty(true);
    setState((s) => addFollower(s, id));
  };

  const save = async () => {
    setProblem(null);
    // A person whose medical release is not approved cannot be recorded (the database refuses it): leave them out of the save.
    const built = buildTickRows({ ...state, order: state.order.filter((id) => !releaseHolds.has(id)) }, crew.crew_id);
    setErrors(built.errors);
    if (Object.keys(built.errors).length > 0) return;
    setBusy(true);
    try {
      await record.mutateAsync({ workOrderId, date, rows: built.rows });
      if (photo) {
        await uploadPhoto.mutateAsync({ photoId: crypto.randomUUID(), workOrderId, crewId: crew.crew_id, workDate: date, file: photo });
        setPhoto(null);
      }
      setDirty(false);
      toast(t('crews:saved', 'Attendance saved'), undefined, 'success');
    } catch (err) {
      setProblem(writeError(err));
    } finally { setBusy(false); }
  };

  const sendWeek = async () => {
    setProblem(null);
    setBusy(true);
    const weekStart = isoWeekStart(date);
    const refused: string[] = [];
    for (const m of crew.members) {
      try { await generateWeek.mutateAsync({ workerId: m.worker_id, weekStart }); } catch (err) {
        // A person with no present day that week has nothing to send; that is not a refusal.
        if (!String((err as { message?: string })?.message ?? '').startsWith('ATT_WEEK_EMPTY')) {
          refused.push(`${m.display_name}: ${writeError(err)}`);
        }
      }
    }
    setBusy(false);
    if (refused.length > 0) setProblem(refused.join(' · '));
    else toast(t('crews:weekSent', 'Week sent for approval'), undefined, 'success');
  };

  return (
    <Card>
      <CardHead>{crew.crew_code} · {crew.crew_name}</CardHead>
      <CardPad>
        {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
        {!canRecord && <p className="mb-3 text-control text-foreground">{t('crews:tickReadOnly', "Only this crew's Foreman or a crew manager ticks this roster.")}</p>}
        <div className="mb-4 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <TextField label={t('crews:crewHours', 'Hours for the crew')} value={state.defaultHours} inputMode="decimal"
            onChange={(v) => { setDirty(true); setState((s) => ({ ...s, defaultHours: v })); }} disabled={!canRecord || busy} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="attendance-photo" className="text-control font-semibold text-foreground">{t('crews:photo', 'Group photo')}</label>
            <FileInput id="attendance-photo" accept="image/png,image/jpeg,image/webp" disabled={!canRecord || busy}
              onChange={(e) => { setDirty(true); setPhoto(e.currentTarget.files?.[0] ?? null); }}
              className="block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium" />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground">
            <th scope="col" className="py-2 font-normal">{t('crews:person', 'Person')}</th>
            <th scope="col" className="py-2 font-normal">{t('crews:statusHeader', 'Status')}</th>
            <th scope="col" className="w-24 py-2 font-normal">{t('crews:hours', 'Hours')}</th>
            <th scope="col" className="w-24 py-2 font-normal">{t('crews:overtime', 'Overtime')}</th>
            <th scope="col" className="py-2 font-normal">{t('crews:reason', 'Reason')}</th>
          </tr></thead>
          <tbody>
            {rows.map((m) => {
              const p = state.people[m.worker_id];
              if (!p) return null;
              const err = errors[m.worker_id];
              const hold = releaseHolds.get(m.worker_id);
              const locked = !canRecord || busy || hold !== undefined;
              return (
                <tr key={m.worker_id} aria-label={m.display_name} className="border-t border-border align-top">
                  <th scope="row" className="py-2 pr-2 text-left font-normal text-foreground">
                    {m.display_name}
                    {hold && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusPill variant="warn">{hold === 'deferred' ? t('crews:release.status.deferred', 'Release deferred') : t('crews:release.status.pending', 'Release pending')}</StatusPill>
                        <span className="text-xs text-muted-foreground">{t('crews:release.heldReason', 'Cannot be recorded until their direct manager approves the medical release.')}</span>
                      </div>
                    )}
                    {m.followed && <span className="block text-xs text-muted-foreground">{t('crews:followedFrom', 'Followed from {{crew}}', { crew: m.from_crew_name ?? '—' })}</span>}
                    {state.followers.includes(m.worker_id) && <span className="block text-xs text-muted-foreground">{t('crews:followedToday', 'Followed this crew today')}</span>}
                    {err && <FieldError id={`tick-err-${m.worker_id}`}>{errorText(err)}</FieldError>}
                  </th>
                  <td className="py-2 pr-2">
                    <SelectField label={t('crews:statusFor', 'Status for {{name}}', { name: m.display_name })} hideLabel compact
                      value={p.status} onChange={(v) => setPerson(m.worker_id, { status: v as AttendanceStatus })} disabled={locked}
                      options={STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
                  </td>
                  <td className="py-2 pr-2">
                    <TextField label={t('crews:hoursFor', 'Hours for {{name}}', { name: m.display_name })} hideLabel inputMode="decimal"
                      value={p.hours} placeholder={state.defaultHours} onChange={(v) => setPerson(m.worker_id, { hours: v })}
                      disabled={locked || p.status !== 'present'} />
                  </td>
                  <td className="py-2 pr-2">
                    {p.status === 'present' && (
                      <TextField label={t('crews:overtimeFor', 'Overtime for {{name}}', { name: m.display_name })} hideLabel inputMode="decimal"
                        value={p.overtime} placeholder="0" onChange={(v) => setPerson(m.worker_id, { overtime: v })}
                        disabled={locked} />
                    )}
                  </td>
                  <td className="py-2">
                    <TextField label={t('crews:reasonFor', 'Reason for {{name}}', { name: m.display_name })} hideLabel
                      value={p.reason} onChange={(v) => setPerson(m.worker_id, { reason: v })} disabled={locked} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canRecord && (
          <div className="mt-4 max-w-sm">
            <Combobox key={addable.length} id="attendance-add-follower" label={t('crews:addFollower', 'Add someone from another crew')} value={null}
              loadOptions={async () => addable} onChange={(v) => follow(v)} disabled={busy}
              statusOverride={workers.isPending || placements.isPending ? 'loading' : undefined}
              placeholder={t('crews:addFollowerPlaceholder', 'Choose a person')}
              helper={addable.length === 0 ? t('crews:addFollowerNone', 'Nobody else is placed in a crew today.') : t('crews:addFollowerHint', 'For someone who joined this crew today without a loan. Their hours are recorded here.')}
              noun={t('crews:personNoun', 'person')} nounPlural={t('crews:personNounPlural', 'people')} />
          </div>
        )}
        {canRecord && dirty && <p className="mb-3 text-sm text-muted-foreground">{t('crews:saveBeforeSending', 'Save attendance before sending the week.')}</p>}
        {canRecord && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void save()} disabled={busy}>{t('crews:save', 'Save attendance')}</Button>
            <Button variant="outline" onClick={() => void sendWeek()} disabled={busy || dirty}>{t('crews:sendWeek', 'Send the week for approval')}</Button>
          </div>
        )}
      </CardPad>
    </Card>
  );
};

interface AwaitingWeek { workerId: string; weekStart: string; hours: number; days: number; orders: string[] }

/** Weeks of people with no login waiting for a supervisor (FR-CRW-016). */
const AwaitingApproval: React.FC = () => {
  const { t } = useTranslation('crews');
  const writeError = useCrewErrorText();
  const { toast } = useToast();
  const awaiting = useAwaitingAttendance(true);
  const workers = useCrewWorkers();
  const { decideWeek } = useAttendanceMutations();
  const [returning, setReturning] = useState<AwaitingWeek | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const weeks = useMemo(() => {
    const byKey = new Map<string, AwaitingWeek>();
    for (const r of awaiting.data ?? []) {
      const weekStart = isoWeekStart(r.work_date);
      const key = `${r.worker_id}:${weekStart}`;
      const w = byKey.get(key) ?? { workerId: r.worker_id, weekStart, hours: 0, days: 0, orders: [] };
      w.hours += Number(r.hours ?? 0) + Number(r.overtime_hours ?? 0);
      w.days += 1;
      if (r.work_order_title && !w.orders.includes(r.work_order_title)) w.orders.push(r.work_order_title);
      byKey.set(key, w);
    }
    return [...byKey.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }, [awaiting.data]);
  const nameOf = (id: string) => workers.data?.find((w) => w.id === id)?.display_name ?? '—';
  const decide = async (w: AwaitingWeek, decision: 'approve' | 'reject', reason: string | null) => {
    setProblem(null);
    try {
      await decideWeek.mutateAsync({ workerId: w.workerId, weekStart: w.weekStart, decision, reason });
      toast(decision === 'approve' ? t('crews:approved', 'Week approved') : t('crews:returned', 'Week returned'), undefined, 'success');
    } catch (err) { setProblem(writeError(err)); }
  };
  if (weeks.length === 0) return null;
  return (
    <Card className="bg-waiting-surface">
      <CardHead>{t('crews:awaitingTitle', 'Weeks waiting for your approval')}</CardHead>
      <CardPad>
        {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
        <table className="w-full text-sm">
          <tbody>
            {weeks.map((w) => (
              <tr key={`${w.workerId}:${w.weekStart}`} aria-label={nameOf(w.workerId)} className="border-t border-border first:border-t-0">
                <th scope="row" className="py-2 text-left font-normal text-foreground">{nameOf(w.workerId)}</th>
                <td className="py-2">
                  <ul className="m-0 list-none p-0">{w.orders.map((title) => <li key={title}>{title}</li>)}</ul>
                </td>
                <td className="py-2 text-muted-foreground">{t('crews:weekOf', 'Week of {{date}}', { date: formatDay(w.weekStart) })}</td>
                <td className="py-2 tabular-nums">{t('crews:hoursTotal', '{{hours}} hours', { hours: formatNumberMax2(w.hours) })}</td>
                <td className="py-2 text-right">
                  <div className="inline-flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setReturning(w)}>{t('crews:return', 'Return')}</Button>
                    <Button variant="primary" size="sm" onClick={() => void decide(w, 'approve', null)}>{t('crews:approve', 'Approve')}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardPad>
      <ReasonDialog open={returning !== null} kind="return" subject={returning ? nameOf(returning.workerId) : undefined}
        onCancel={() => setReturning(null)}
        onConfirm={(reason: string) => { const w = returning; setReturning(null); if (w) void decide(w, 'reject', reason); }} />
    </Card>
  );
};

/** Crews → Attendance: tick a rostered crew's day on a work order; send the week; approve no-login weeks. */
export const AttendanceTick: React.FC = () => {
  const { t } = useTranslation('crews');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const userId = useAuth().currentUser?.id ?? null;
  const { values, setFilter, setFilters } = useUrlFilters(['wo', 'date', 'crew']);
  const today = toIso(new Date());
  const workOrderId = values.wo || null;
  const date = ISO.test(values.date) ? values.date : today;
  const roster = useWorkOrderRoster(workOrderId, date);
  const day = useAttendanceDay(workOrderId, date);
  const crews = roster.data ?? [];
  const crew = crews.find((c) => c.crew_id === values.crew) ?? crews[0] ?? null;
  const canRecord = crew ? may('create', 'attendance', { currentUserId: userId, record: { field_controller_id: crew.field_controller_id, viewOnly } }) : false;
  const canApprove = may('approve', 'attendance', { currentUserId: userId, record: { viewOnly } });
  const holds = useReleaseHolds(workOrderId ? date : null);
  const heldKey = (day.data ?? []).map((d) => `${d.id}:${d.status}:${d.hours}`).join('|');
  return (
    <div className="space-y-6">
      {canApprove && <AwaitingApproval />}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WorkOrderPicker id="attendance-work-order" value={workOrderId} onChange={(v) => setFilters({ wo: v ?? '', crew: '' })} />
        <DateField label={t('crews:date', 'Date')} value={date} max={today} onChange={(v) => setFilter('date', v === today ? '' : v)} />
      </div>
      {crews.length > 1 && (
        <SelectField label={t('crews:crew', 'Crew')} value={crew?.crew_id ?? ''} onChange={(v) => setFilter('crew', v)}
          options={crews.map((c) => ({ value: c.crew_id, label: `${c.crew_code} · ${c.crew_name}` }))} />
      )}
      {!workOrderId && <p className="text-sm text-muted-foreground">{t('crews:pickWorkOrderTick', 'Choose a work order to record its crew\'s day')}</p>}
      {workOrderId && (roster.isPending || day.isPending) && <ListState variant="loading" shape="table" rows={4} />}
      {workOrderId && !roster.isPending && (roster.isError || day.isError) && (
        <ListState variant="error" title={t('crews:rosterError', "Couldn't load the roster")}
          onRetry={() => { void roster.refetch(); void day.refetch(); }} retryLabel={t('crews:retry', 'Retry')} />
      )}
      {workOrderId && !roster.isPending && !day.isPending && !roster.isError && !day.isError && !crew && (
        <p className="text-sm text-foreground">{t('crews:noCrewThatDay', 'No crew serves this work order that day')}</p>
      )}
      {workOrderId && crew && !day.isPending && !day.isError && (
        <TickForm key={`${crew.crew_id}:${date}:${heldKey}`} crew={crew} workOrderId={workOrderId} date={date} held={day.data ?? []} canRecord={canRecord}
          releaseHolds={holds.data} />
      )}
    </div>
  );
};
