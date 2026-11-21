import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, DateField, ListState, StatusPill } from '@/src/components/ui';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { usePermission } from '@/src/auth/usePermission';
import { useAttendanceRate, useAttendanceTarget } from '@/src/hooks/useAttendanceRate';
import { isBelowTarget, type CrewAttendanceRateRow } from '@/src/lib/db/attendanceRate';
import { formatPercent } from '@/src/lib/format';
import { monthStart, toIso } from '../equipment/equipmentWeek';

/**
 * Attendance rate per crew and period against the organisation's target (#2706, FR-ATR-004..013).
 *
 * The numbers come from `attendance_rate_by_crew` (1437): the database owns the counting, the role gate and the
 * period bound. This view only chooses the period and shows what the record says, including the days nobody
 * recorded — the gap a reviewer has to see. The rate is a dash, never 0 %, when the period holds no countable day.
 */

const rateText = (rate: number | null): string => formatPercent(rate === null ? null : rate / 100, 2);
const count = (n: number): string => String(n);

const BelowTarget: React.FC = () => {
  const { t } = useTranslation('crews');
  return <StatusPill variant="warn">{t('crews:rate.belowTarget', 'Below target')}</StatusPill>;
};

const CrewCard: React.FC<{ row: CrewAttendanceRateRow; target: number | null }> = ({ row, target }) => {
  const { t } = useTranslation('crews');
  const below = isBelowTarget(row);
  return (
    <li>
      <Card>
        <CardHead>
          <span className="flex flex-wrap items-center gap-2">
            {row.crew_code} · {row.crew_name}
            {below && <BelowTarget />}
          </span>
        </CardHead>
        <CardPad>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-muted-foreground">{t('crews:rate.expected', 'Expected days')}</dt><dd className="font-semibold tabular-nums">{count(row.expected_days)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.present', 'Present')}</dt><dd className="font-semibold tabular-nums">{count(row.present_days)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.absent', 'Absent')}</dt><dd className="font-semibold tabular-nums">{count(row.absent_days)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.leave', 'Leave')}</dt><dd className="font-semibold tabular-nums">{count(row.leave_days)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.offRotation', 'Off rotation')}</dt><dd className="font-semibold tabular-nums">{count(row.off_rotation_days)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.noRecord', 'No record')}</dt><dd className="font-semibold tabular-nums">{count(row.no_record_days)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.rate', 'Attendance rate')}</dt><dd className="font-semibold tabular-nums">{rateText(row.rate)}</dd></div>
            <div><dt className="text-muted-foreground">{t('crews:rate.target', 'Target')}</dt><dd className="font-semibold tabular-nums">{target === null ? '—' : formatPercent(target / 100, 2)}</dd></div>
          </dl>
        </CardPad>
      </Card>
    </li>
  );
};

const AttendanceRate: React.FC = () => {
  const { t } = useTranslation('crews');
  const may = usePermission();
  const canView = may('view', 'attendanceRate');
  const narrow = useIsNarrow();
  const target = useAttendanceTarget();
  const today = useMemo(() => toIso(new Date()), []);
  const [from, setFrom] = useState(() => monthStart(today));
  const [to, setTo] = useState(today);
  const rangeInvalid = from > to;
  const report = useAttendanceRate(canView && !rangeInvalid ? from : null, canView && !rangeInvalid ? to : null);

  if (!canView) return null;

  const targetValue = target.data ?? null;
  const rows = report.data ?? [];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,200px)_minmax(0,200px)]">
        <DateField label={t('crews:rate.from', 'From')} value={from} max={to} onChange={setFrom} />
        <DateField label={t('crews:rate.to', 'To')} value={to} min={from} max={today} onChange={setTo} />
      </div>
      <p className="max-w-prose text-control text-muted-foreground">
        {t('crews:rate.helper', 'A day is expected when the crew was rostered and the person was placed in it. Leave and off rotation are excused; a day nobody recorded counts against the rate.')}
      </p>
      {rangeInvalid && <p role="alert" className="text-sm text-destructive-text">{t('crews:rate.rangeError', 'The end date is before the start date.')}</p>}
      {!rangeInvalid && report.isPending && <ListState variant="loading" rows={4} />}
      {!rangeInvalid && report.isError && (
        <ListState variant="error" title={t('crews:rate.error', "Couldn't load the attendance rate")} onRetry={() => void report.refetch()} />
      )}
      {!rangeInvalid && report.isSuccess && rows.length === 0 && (
        <p className="text-control text-muted-foreground">{t('crews:rate.empty', 'No crew has attendance in this period.')}</p>
      )}
      {!rangeInvalid && report.isSuccess && rows.length > 0 && (narrow ? (
        <ul className="space-y-3">
          {rows.map((row) => <CrewCard key={row.crew_id} row={row} target={targetValue} />)}
        </ul>
      ) : (
        <Card>
          <CardPad>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-normal">{t('crews:rate.crew', 'Crew')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.expected', 'Expected days')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.present', 'Present')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.absent', 'Absent')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.leave', 'Leave')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.offRotation', 'Off rotation')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.noRecord', 'No record')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('crews:rate.rate', 'Attendance rate')}</th>
                    <th scope="col" className="py-2 text-right font-normal">{t('crews:rate.target', 'Target')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.crew_id} className="border-t border-border">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {row.crew_code} · {row.crew_name}
                          {isBelowTarget(row) && <BelowTarget />}
                        </span>
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">{count(row.expected_days)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{count(row.present_days)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{count(row.absent_days)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{count(row.leave_days)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{count(row.off_rotation_days)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{count(row.no_record_days)}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums">{rateText(row.rate)}</td>
                      <td className="py-2 text-right tabular-nums">{targetValue === null ? '—' : formatPercent(targetValue / 100, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardPad>
        </Card>
      ))}
    </div>
  );
};

export default AttendanceRate;
