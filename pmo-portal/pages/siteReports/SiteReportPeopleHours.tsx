import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ListState, NumberField, RecordSection, SelectField, TextArea, useToast } from '@/src/components/ui';
import { formatNumberMax2 } from '@/src/lib/format';
import { useRefusalLine } from '@/src/lib/refusals';
import { standingTotal, type ReportDayWorker } from '@/src/lib/db/attendanceSecondRecords';
import type { Standing } from '@/src/lib/repositories/attendanceSecondRecords';
import { useReportDayHours, useSecondRecordMutations } from '@/src/hooks/useAttendanceSecondRecords';

/**
 * The day's hours on a site report, person by person (pay-time, FR-PAY-007). The figure that stands is the one that is paid and
 * costed; a second record (a surveyor's or timekeeper's) sits beside it until a person the organisation names decides. UI only:
 * the database decides who may enter and who may decide (ADR-0016), and refuses a person who recorded one of the figures.
 * Only people who record or decide time get rows; everyone else keeps the total above.
 */

type Dialog = { kind: 'enter'; worker: ReportDayWorker } | { kind: 'decide'; worker: ReportDayWorker } | null;

export const SiteReportPeopleHours: React.FC<{ reportId: string; workOrderId: string; workDate: string }> = ({ reportId, workOrderId, workDate }) => {
  const { t } = useTranslation('siteReport');
  const { toast } = useToast();
  const refusal = useRefusalLine();
  const q = useReportDayHours(reportId);
  const m = useSecondRecordMutations();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [status, setStatus] = useState<'present' | 'absent'>('present');
  const [hours, setHours] = useState('');
  const [overtime, setOvertime] = useState('');
  const [note, setNote] = useState('');
  const [stand, setStand] = useState<Standing>('day');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (q.isPending || (q.data && !q.data.detail)) return null;
  const close = () => { setDialog(null); setError(null); };
  const open = (next: Dialog) => {
    setError(null); setStatus('present'); setHours(''); setOvertime(''); setNote(''); setStand('day'); setReason('');
    setDialog(next);
  };
  const fail = (e: unknown) => setError(refusal(e));

  const submitEnter = (w: ReportDayWorker) => {
    const h = Number(hours);
    if (status === 'present' && (hours.trim() === '' || !Number.isFinite(h) || h < 0 || h > 24)) { setError(t('people.hoursRange', 'Enter hours from 0 to 24.')); return; }
    const row = status === 'present'
      ? { worker_id: w.workerId, status, hours: h, overtime_hours: overtime.trim() === '' ? null : Number(overtime), note: note.trim() || null }
      : { worker_id: w.workerId, status, note: note.trim() || null };
    m.enter.mutate({ workOrderId, workDate, rows: [row] }, {
      onSuccess: () => { toast(t('people.savedSecond', 'Second record saved'), 'success'); close(); },
      onError: fail,
    });
  };
  const submitDecide = (w: ReportDayWorker) => {
    if (reason.trim() === '') { setError(t('people.reasonRequired', 'Say why this figure stands.')); return; }
    m.decide.mutate({ workerId: w.workerId, workOrderId, workDate, stand, reason }, {
      onSuccess: () => { toast(t('people.decidedToast', 'Decision saved'), 'success'); close(); },
      onError: fail,
    });
  };

  const figureText = (f: { status: string; hours: number | null; overtimeHours: number | null } | null) =>
    f && f.status === 'present' ? t('people.hours', '{{hours}} h', { hours: formatNumberMax2(standingTotal(f)) }) : t('people.absent', 'Absent');
  const sourceText = (source: string): string =>
    source === 'roster_tick' ? t('people.source.roster_tick', 'Site report')
      : source === 'phone_check_in' ? t('people.source.phone_check_in', 'Clock-in')
      : t('people.source.manual_correction', 'Office correction');
  const decideWhy = (w: ReportDayWorker, mayDecide: boolean): string | null =>
    !mayDecide ? t('people.cannotDecideRole', 'Your role does not decide which hours stand.')
      : w.mine ? t('people.cannotDecideMine', 'You recorded one of these figures. Someone else decides.')
      : !w.day ? t('people.cannotDecideNoDay', 'The site report figure for this day is not recorded yet.')
      : null;

  const data = q.data;
  return (
    <RecordSection title={t('people.byPerson', 'Hours by person')} data-testid="dsr-people-hours">
      {q.isError ? <ListState variant="error" onRetry={() => void q.refetch()} /> : null}
      {data ? (
        <>
          <p className="mb-3 text-control text-muted-foreground">{t('people.intro', 'The standing figure is the one paid and costed. A second record is kept beside it as evidence.')}</p>
          {data.workers.length === 0 ? (
            <p className="text-muted-foreground">{t('people.empty', 'No one is rostered on this work order for this day. Roster a crew on the Crews page.')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.workers.map((w) => {
                const why = w.undecided ? decideWhy(w, data.mayDecide) : null;
                const canAdd = data.mayEnter && !(w.second?.decidedAt);
                return (
                  <li key={w.workerId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid={`dsr-people-row-${w.workerId}`}>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{w.name}</div>
                      <div className="text-foreground">
                        {w.day
                          ? <>{t('people.standing', 'Stands')}: <span className="tabular-nums">{figureText(w.day)}</span> <span className="text-muted-foreground">({sourceText(w.day.source)})</span></>
                          : <span className="text-muted-foreground">{t('people.noHours', 'No hours recorded')}</span>}
                      </div>
                      {w.second ? (
                        <div className="text-muted-foreground">
                          {t('people.second', 'Second record')}: <span className="tabular-nums">{figureText(w.second)}</span>
                          {w.second.note ? ` · ${w.second.note}` : ''}
                          {w.second.standing ? ` · ${w.second.standing === 'second' ? t('people.decided.second', 'Second record stands') : t('people.decided.day', 'Site report figure stands')}${w.second.decisionReason ? ` (${w.second.decisionReason})` : ''}` : ''}
                        </div>
                      ) : null}
                      {w.undecided ? <div className="mt-1 font-medium text-foreground" role="status">{t('people.needsDecision', 'The two records differ. Decide which hours stand.')}</div> : null}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {canAdd ? <Button variant="outline" onClick={() => open({ kind: 'enter', worker: w })}>{t('people.addSecond', 'Add second record')}</Button> : null}
                      {w.undecided ? (
                        <div className="flex flex-col gap-1">
                          <Button variant="primary" disabled={why !== null} aria-describedby={why ? `why-${w.workerId}` : undefined} onClick={() => open({ kind: 'decide', worker: w })}>
                            {t('people.decide', 'Decide')}
                          </Button>
                          {why ? <span id={`why-${w.workerId}`} className="max-w-56 text-control text-muted-foreground">{why}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {dialog?.kind === 'enter' ? (
        <ConfirmDialog
          open title={t('people.addSecondFor', 'Second record for {{name}}', { name: dialog.worker.name })} confirmLabel={t('people.saveSecond', 'Save second record')}
          loading={m.enter.isPending} error={error} onCancel={close} onConfirm={() => submitEnter(dialog.worker)}
          description={(
            <div className="space-y-3">
              <SelectField label={t('people.field.status', 'Was this person present?')} fullWidth value={status} onChange={(v) => setStatus(v === 'absent' ? 'absent' : 'present')}
                options={[{ value: 'present', label: t('people.present', 'Present') }, { value: 'absent', label: t('people.absent', 'Absent') }]} />
              {status === 'present' ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label={t('people.field.hours', 'Hours')} required fullWidth value={hours} onChange={setHours} />
                  <NumberField label={t('people.field.overtime', 'Overtime hours')} fullWidth value={overtime} onChange={setOvertime} />
                </div>
              ) : null}
              <TextArea label={t('people.field.note', 'Note (optional)')} fullWidth rows={2} maxLength={500} value={note} onChange={setNote} />
            </div>
          )}
        />
      ) : null}

      {dialog?.kind === 'decide' ? (
        <ConfirmDialog
          open title={t('people.decideFor', 'Which hours stand for {{name}}', { name: dialog.worker.name })} confirmLabel={t('people.confirmDecide', 'Confirm')}
          loading={m.decide.isPending} error={error} onCancel={close} onConfirm={() => submitDecide(dialog.worker)}
          description={(
            <div className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="text-control font-medium text-foreground">{t('people.choose', 'The figure that stands is paid and costed. The other is kept as evidence.')}</legend>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="radio" name="stand" checked={stand === 'day'} onChange={() => setStand('day')} />
                  <span>{t('people.chooseDay', 'Site report: {{figure}}', { figure: figureText(dialog.worker.day) })}</span>
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="radio" name="stand" checked={stand === 'second'} onChange={() => setStand('second')} />
                  <span>{t('people.chooseSecond', 'Second record: {{figure}}', { figure: figureText(dialog.worker.second) })}</span>
                </label>
              </fieldset>
              <TextArea label={t('people.field.reason', 'Why this figure stands')} required fullWidth rows={2} maxLength={500} value={reason} onChange={setReason} />
            </div>
          )}
        />
      ) : null}
    </RecordSection>
  );
};

export default SiteReportPeopleHours;
