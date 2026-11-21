import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DateField, ListState, PageHeader, RecordSection, StatusPill, type StatusVariant } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useCrewPunctuality, useLostTimeByCause } from '@/src/hooks/useSiteCheckpoints';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import type { PunctualityStatus } from '@/src/lib/repositories/siteCheckpoints';
import { checkpointToday, formatCheckpointTime } from './checkpointTime';

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const STATUS: Record<PunctualityStatus, { variant: StatusVariant; text: string }> = {
  on_time: { variant: 'won', text: 'On time' },
  late: { variant: 'overdue', text: 'Late' },
  not_started: { variant: 'overdue', text: 'Not started' },
};
const hoursMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * `/site-reports/crews` (#2594, FR-STC-040/041/060): the crews that missed the work-start checkpoint's target time, worst
 * share first, and the lost time of the same dates by cause. Both are database reads that refuse the roles that may not see
 * them; the screen shows what comes back. The share is a count of days. Static route, ahead of `/site-reports/:reportId`.
 */
const CrewPunctuality: React.FC = () => {
  const { t } = useTranslation('siteReport');
  const navigate = useNavigate();
  const today = checkpointToday();
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(addDays(today, -29));
  const valid = from !== '' && to !== '' && from <= to && Date.parse(to) - Date.parse(from) < 92 * 86_400_000;
  const filter = useMemo(() => ({ from, to }), [from, to]);
  const crews = useCrewPunctuality(filter, valid);
  const lost = useLostTimeByCause(filter, valid);

  return (
    <div className="space-y-6">
      <div className="hidden max-[920px]:block"><BackBar label={t('title', 'Site reports')} onBack={() => navigate('/site-reports')} /></div>
      <PageHeader title={t('crews.title', 'Crews on time')} help={t('crews.help', 'Counts the days each crew recorded the work-start checkpoint within its target time. The share is a count of days, never an average of minutes.')} />
      <div className="flex flex-wrap items-end gap-3">
        <DateField label={t('crews.from', 'From')} value={from} onChange={setFrom} max={to || undefined} />
        <DateField label={t('crews.to', 'To')} value={to} onChange={setTo} min={from || undefined} />
      </div>
      {!valid && <p role="alert" className="text-foreground">{t('crews.badRange', 'Choose a range of 1 to 92 days.')}</p>}

      <RecordSection title={t('crews.missedTitle', 'Missed the target time')} data-testid="crew-punctuality">
        {!valid ? null : crews.isPending ? <ListState variant="loading" rows={4} />
          : crews.isError ? <ListState variant="error" title={classifyMutationError(crews.error).headline} onRetry={() => void crews.refetch()} />
          : crews.data.crews.length === 0 ? <ListState variant="empty" icon="reports" title={t('crews.empty', 'No crew days in this range')} />
          : (
            <>
              {crews.data.truncated && <p className="mb-3 text-control text-muted-foreground" role="status">{t('crews.truncated', 'Showing the first 200 crews, lowest share on time first.')}</p>}
              <ul className="divide-y divide-border">
                {crews.data.crews.map((c) => {
                  const missed = c.day_rows.filter((d) => d.status !== 'on_time');
                  return (
                    <li key={c.crew_id} className="py-3" data-testid={`crew-${c.crew_id}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-medium text-foreground">{c.crew_name}</span>
                        <span className="tabular-nums text-foreground">
                          {t('crews.share', '{{onTime}} of {{days}} days on time', { onTime: c.on_time, days: c.days })}
                          <span className="ml-2 text-muted-foreground">{Math.round(c.share_on_time * 100)}%</span>
                        </span>
                      </div>
                      {missed.length > 0 && (
                        <ul className="mt-1 space-y-1">
                          {missed.slice(0, 5).map((d) => (
                            <li key={`${d.work_date}-${d.work_order_id}`} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-control">
                              <span className="tabular-nums text-muted-foreground">{formatDay(d.work_date)}</span>
                              <StatusPill variant={STATUS[d.status].variant}>{t(`crews.status.${d.status}`, STATUS[d.status].text)}</StatusPill>
                              <span className="tabular-nums text-muted-foreground">
                                {t('crews.target', 'Target {{time}}', { time: formatCheckpointTime(d.due_at) })}
                                {d.minutes_late !== null && ` · ${t('crews.minutesLate', '{{n}} min late', { n: d.minutes_late })}`}
                              </span>
                              <Link className="text-primary-text underline" to={`/work-orders/${d.work_order_id}`}>{t('crews.workOrder', 'Work order')}</Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
      </RecordSection>

      <RecordSection title={t('lost.title', 'Lost time by cause')} subline={t('lost.subline', 'Idle time on submitted and validated site reports in the same dates.')} data-testid="lost-time">
        {!valid ? null : lost.isPending ? <ListState variant="loading" rows={3} />
          : lost.isError ? <ListState variant="error" title={classifyMutationError(lost.error).headline} onRetry={() => void lost.refetch()} />
          : lost.data.rows.length === 0 ? <p className="text-muted-foreground">{t('lost.none', 'No idle time recorded in this range')}</p>
          : (
            <>
              <ul className="divide-y divide-border">
                {lost.data.rows.map((r) => (
                  <li key={r.reason_id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                    <span className="text-foreground">{r.label}{r.archived ? ` · ${t('lost.archived', 'Archived')}` : ''}</span>
                    <span className="tabular-nums text-foreground">{hoursMinutes(r.minutes)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex justify-between font-medium text-foreground">
                <span>{t('lost.total', 'Total')}</span><span className="tabular-nums">{hoursMinutes(lost.data.total_minutes)}</span>
              </p>
              <p className="mt-1 text-control text-muted-foreground">{t('lost.reports', 'From {{n}} reports', { n: lost.data.report_count })}</p>
            </>
          )}
        <Button variant="ghost" className="mt-2" onClick={() => navigate('/site-reports')}>{t('crews.toReports', 'Back to site reports')}</Button>
      </RecordSection>
    </div>
  );
};

export default CrewPunctuality;
