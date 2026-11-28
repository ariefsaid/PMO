import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DateField, ListState, RecordSection, StatusPill, useToast } from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useAuth } from '@/src/auth/useAuth';
import { AuthContext } from '@/src/auth/AuthContext';
import { useProject } from '@/src/hooks/useProjects';
import { useSafetyMutations, useSafetyWorkOrderDays } from '@/src/hooks/useSafetyDays';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { SAFETY_PART_LABEL } from '@/src/lib/safetyDay';
import type { SafetyWorkOrderDay } from '@/src/lib/db/safetyDays';
import { useAreaHelp } from './useAreaHelp';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Daily safety records on the work-order page (#2596, FR-DSF-008). Shown only once the organisation has switched safety
 * records on (AC-DSF-018): per day in the last 30 days whether it is complete, what is missing, and which days workers
 * were present with no locked record. `can()` is UX; the database enforces who may record (ADR-0016).
 */
export const SafetySection: React.FC<{ workOrderId: string; projectId: string; status: string }> = (props) => {
  // Rendered outside the app's auth and query providers (an isolated page test), the section is simply omitted.
  const auth = useContext(AuthContext);
  return auth ? <SafetySectionGate {...props} /> : null;
};

const SafetySectionGate: React.FC<{ workOrderId: string; projectId: string; status: string }> = ({ workOrderId, projectId, status }) => {
  const enabled = useOrgSwitch('safetyRecords');
  if (!enabled.data) return null;
  return <SafetySectionBody workOrderId={workOrderId} projectId={projectId} status={status} />;
};

const SafetySectionBody: React.FC<{ workOrderId: string; projectId: string; status: string }> = ({ workOrderId, projectId, status }) => {
  const { t } = useTranslation('safety');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { realRole } = useEffectiveRole();
  const userId = useAuth().currentUser?.id ?? null;
  const project = useProject(projectId).data ?? null;
  const mayEnter = can('create', 'safetyDay', { realRole, currentUserId: userId, record: { project_manager_id: project?.project_manager_id ?? null } });
  const today = useOrgToday();
  const days = useSafetyWorkOrderDays(workOrderId, addDays(today, -29), today, true);
  const m = useSafetyMutations();
  const [date, setDate] = useState(today);

  const open = async (row: { work_date: string; day_id: string | null }) => {
    if (row.day_id) { navigate(`/safety-days/${row.day_id}`); return; }
    try { navigate(`/safety-days/${await m.createDay.mutateAsync({ workOrderId, workDate: row.work_date })}`); }
    catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }
  };
  const partLabel = (p: string) => t(`parts.${p}`, SAFETY_PART_LABEL[p as keyof typeof SAFETY_PART_LABEL] ?? p);
  const state = (r: SafetyWorkOrderDay) => {
    if (r.complete) return <StatusPill variant="won">{t('day.complete', 'Complete')}</StatusPill>;
    if (!r.day_id) return <StatusPill variant="warn">{t('day.noRecord', 'Worked without a safety record')}</StatusPill>;
    if (r.status === 'draft') return <StatusPill variant="open">{t('day.draft', 'Draft')}</StatusPill>;
    return <StatusPill variant="warn">{t('day.missing', { defaultValue: 'Missing: {{parts}}', parts: r.missing.map(partLabel).join(', ') })}</StatusPill>;
  };

  const title = t('section.title', 'Daily safety records');
  useAreaHelp('safety', title, t('section.subline', 'Fitness check, toolbox talk, pre-work checklist, permit to work and the safety officer’s report, per day.'));

  return (
    <RecordSection
      title={title}
      className="[&>div:first-child]:flex-nowrap"
      data-testid="safety-section"
      actions={<Link to="/safety" className="shrink-0 whitespace-nowrap text-control text-primary-text hover:underline">{t('section.summary', 'Monthly summary')}</Link>}
    >
      {mayEnter && status === 'Issued' && (
        <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void open({ work_date: date, day_id: days.data?.find((d) => d.work_date === date)?.day_id ?? null }); }}>
          <DateField label={t('day.date', 'Date')} value={date} onChange={setDate} max={today} />
          <Button type="submit" variant="primary" disabled={!date || m.createDay.isPending} data-testid="safety-new-day">{t('day.record', 'Record safety day')}</Button>
        </form>
      )}
      {days.isPending ? <ListState variant="loading" rows={3} />
        : days.isError ? <ListState variant="error" title={t('section.error', "Couldn't load the safety records")} onRetry={() => void days.refetch()} />
        : days.data.length === 0 ? <p className="text-muted-foreground">{t('section.empty', 'No safety days in the last 30 days')}</p>
        : (
          <ul className="divide-y divide-border" data-testid="safety-days">
            {days.data.map((r) => (
              <li key={r.work_date} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="safety-day-row" data-date={r.work_date} data-complete={r.complete ? 'yes' : 'no'}>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">{formatDay(r.work_date)}</span>
                  {state(r)}
                  {r.workers_present > 0 && <span className="text-muted-foreground">{t('day.present', { defaultValue: '{{count}} present', count: r.workers_present })}</span>}
                </span>
                {(r.day_id || mayEnter) && (
                  <Button variant="outline" size="sm" onClick={() => void open(r)}>{r.day_id ? t('day.open', 'Open') : t('day.recordShort', 'Record')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
    </RecordSection>
  );
};

/**
 * Today's safety record, one line under the work-order header (walk finding: the record was eight screens down).
 * Same switch and the same open/create path as the section below; renders nothing while safety records are off.
 */
export const SafetyTodayLink: React.FC<{ workOrderId: string; projectId: string; status: string }> = (props) => {
  const auth = useContext(AuthContext);
  return auth ? <SafetyTodayGate {...props} /> : null;
};

const SafetyTodayGate: React.FC<{ workOrderId: string; projectId: string; status: string }> = (props) => {
  const enabled = useOrgSwitch('safetyRecords');
  if (!enabled.data) return null;
  return <SafetyTodayBody {...props} />;
};

const SafetyTodayBody: React.FC<{ workOrderId: string; projectId: string; status: string }> = ({ workOrderId, projectId, status }) => {
  const { t } = useTranslation('safety');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { realRole } = useEffectiveRole();
  const userId = useAuth().currentUser?.id ?? null;
  const project = useProject(projectId).data ?? null;
  const mayEnter = can('create', 'safetyDay', { realRole, currentUserId: userId, record: { project_manager_id: project?.project_manager_id ?? null } });
  const todayIso = useOrgToday();
  const days = useSafetyWorkOrderDays(workOrderId, todayIso, todayIso, true);
  const m = useSafetyMutations();
  const row = days.data?.find((d) => d.work_date === todayIso) ?? null;
  if (!row?.day_id && !(mayEnter && status === 'Issued')) return null;
  const go = async () => {
    if (row?.day_id) { navigate(`/safety-days/${row.day_id}`); return; }
    try { navigate(`/safety-days/${await m.createDay.mutateAsync({ workOrderId, workDate: todayIso })}`); }
    catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }
  };
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 sm:justify-start" data-testid="safety-today">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-control font-medium">{t('today.title', "Today's safety record")}</span>
        <span className="text-control text-muted-foreground">
          {!row?.day_id ? t('today.none', 'Not started') : row.status === 'locked' ? t('day.locked', 'Locked') : t('day.draft', 'Draft')}
        </span>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={() => void go()} data-testid="safety-today-open">
        {row?.day_id ? t('day.open', 'Open') : t('day.recordShort', 'Record')}
      </Button>
    </div>
  );
};
