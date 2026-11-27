import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, ListState, ReasonDialog, RecordHeader, RecordStack, StatusPill, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProject } from '@/src/hooks/useProjects';
import { useSafetyDay, useSafetyMutations, useSafetyRoster } from '@/src/hooks/useSafetyDays';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { SAFETY_PART_LABEL } from '@/src/lib/safetyDay';
import { deriveSafetyDayStatus, lockReadiness } from '@/src/lib/safetyDay';
import type { SafetyDayDetail } from '@/src/lib/db/safetyDays';
import { FitnessPart } from './FitnessPart';
import { ToolboxPart } from './ToolboxPart';
import { ChecklistPart } from './ChecklistPart';
import { PermitsPart } from './PermitsPart';
import { OfficerPart } from './OfficerPart';

/**
 * `/safety-days/:dayId` (#2596). Phone first: the five parts in the order the field runs them. While a draft the
 * enterer edits; Submit locks the day for good; a locked day offers Correct (a new version with a reason) and the
 * safety officer's report. `can()` mirrors safety_may_enter; the database refuses what the UI hides (ADR-0016).
 */
const SafetyDayForm: React.FC = () => {
  const { dayId } = useParams<{ dayId: string }>();
  const query = useSafetyDay(dayId);
  const { t } = useTranslation('safety');
  const navigate = useNavigate();
  const back = <div className="mb-3.5 hidden max-[920px]:block"><Button variant="outline" onClick={() => navigate(-1)}>{t('form.back', 'Back')}</Button></div>;
  if (query.isPending) return (<>{back}<ListState variant="loading" rows={6} /></>);
  if (query.isError) return (<>{back}<ListState variant="error" title={t('form.error', "Couldn't load this safety day")} onRetry={() => void query.refetch()} /></>);
  if (!query.data) return (<>{back}<ListState variant="empty" icon="reports" title={t('form.notFound', 'Safety day not found')} /></>);
  return (<>{back}<SafetyDayRecord detail={query.data} /></>);
};

const SafetyDayRecord: React.FC<{ detail: SafetyDayDetail }> = ({ detail }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const navigate = useNavigate();
  const { day } = detail;
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const project = useProject(day.project_id).data ?? null;
  const ctx = { realRole, currentUserId: userId, record: { project_manager_id: project?.project_manager_id ?? null } };
  const mayEnter = can('create', 'safetyDay', ctx);
  const seePeople = can('viewPeople', 'safetyDay', ctx);
  const editable = day.status === 'draft' && mayEnter;
  const roster = useSafetyRoster(day.work_order_id, day.work_date);
  const m = useSafetyMutations();
  const [correcting, setCorrecting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const rosterReady = !roster.isPending && !roster.isError;
  const readiness = lockReadiness(detail.checklist, detail.fitness, roster.data ?? []);

  const status = deriveSafetyDayStatus({
    status: day.status,
    presentWorkerIds: [],
    fitness: detail.fitness.map((f) => ({ workerId: f.worker_id, result: f.result })),
    talks: detail.talks.map((x) => ({ photoCount: x.photos.length })),
    checklist: detail.checklist.map((c) => ({ answer: c.answer })),
  });
  // The database's refusals, in the reader's language (never the raw sentence).
  const lockRefusal = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : '';
    if (/needs a note/.test(msg)) return t('lock.errNote', 'A checklist item answered No needs a note. Write the note, then lock again.');
    if (/already locked/.test(msg)) return t('lock.errLocked', 'This day is already locked. Reload the page.');
    if (/only the author/.test(msg)) return t('lock.errAuthor', 'Only the person who started this safety day can lock it.');
    const { headline, detail: d } = classifyMutationError(err);
    return d ? joinSentences(headline, d) : headline;
  };
  const submit = async () => {
    setLockError(null);
    try {
      await m.submitDay.mutateAsync(day.id);
      setLocking(false);
      toast(t('toast.submitted', 'Safety day submitted and locked'), undefined, 'success');
    } catch (err) { setLockError(lockRefusal(err)); }
  };
  const correct = async (reason: string) => {
    setDialogError(null);
    try {
      const id = await m.correctDay.mutateAsync({ id: day.id, reason });
      setCorrecting(false);
      toast(t('toast.corrected', 'Correction started'), undefined, 'success');
      navigate(`/safety-days/${id}`);
    } catch (err) { const { headline, detail: d } = classifyMutationError(err); setDialogError(d ? joinSentences(headline, d) : headline); }
  };

  return (
    <div>
      <RecordHeader
        panelInset
        actionsOnTitleRow
        clampNameOnMobile
        name={t('form.title', 'Safety day')}
        status={<span data-testid="safety-day-status" data-status={day.status}>
          <StatusPill variant={day.status === 'locked' ? 'won' : 'open'}>{day.status === 'locked' ? t('day.locked', 'Locked') : t('day.draft', 'Draft')}</StatusPill>
        </span>}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatDay(day.work_date)}</span>
            <Link to={`/work-orders/${day.work_order_id}`} className="text-primary-text hover:underline">{t('form.workOrder', 'Work order')}</Link>
            {day.version > 1 && <span>{t('form.version', { defaultValue: 'Version {{n}}', n: day.version })}</span>}
          </span>
        }
        actions={(
          <div className="flex flex-wrap gap-2">
            {editable && <Button disabled={!rosterReady} variant="primary" onClick={() => { setLockError(null); setLocking(true); }} data-testid="safety-submit">{t('actions.submit', 'Submit and lock')}</Button>}
            {day.status === 'locked' && mayEnter && <Button variant="outline" onClick={() => { setDialogError(null); setCorrecting(true); }} data-testid="safety-correct">{t('actions.correct', 'Correct')}</Button>}
          </div>
        )}
      >
        {day.correction_reason && <p className="text-foreground">{t('form.correction', { defaultValue: 'Correction: {{reason}}', reason: day.correction_reason })}</p>}
        {day.status === 'draft' && status.missing.length > 0 && (
          <p className="text-muted-foreground" data-testid="safety-missing">{t('form.stillNeeded', { defaultValue: 'Still needed: {{parts}}', parts: status.missing.map((p) => t(`parts.${p}`, SAFETY_PART_LABEL[p as keyof typeof SAFETY_PART_LABEL] ?? p)).join(', ') })}</p>
        )}
      </RecordHeader>
      <RecordStack>
        {roster.isError && <ListState variant="error" title={t("common:ui.errorBoundary.title", "Something went wrong")} onRetry={() => void roster.refetch()} />}
        {roster.isPending && <ListState variant="loading" />}
        {rosterReady && <FitnessPart detail={detail} roster={roster.data ?? []} editable={editable} seePeople={seePeople} />}
        {rosterReady && <ToolboxPart detail={detail} roster={roster.data ?? []} editable={editable} seePeople={seePeople} />}
        <ChecklistPart detail={detail} editable={editable} />
        <PermitsPart detail={detail} editable={editable} />
        <OfficerPart detail={detail} mayEnter={mayEnter} />
      </RecordStack>
      <ConfirmDialog confirmDisabled={!rosterReady} open={locking} tone="default" title={t('lock.title', 'Lock this safety day?')}
        description={(
          <div className="space-y-2" data-testid="safety-lock-body">
            <p>{t('lock.body', 'After locking, this record cannot be edited. Only a correction with a reason changes it.')}</p>
            {readiness.uncheckedWorkers.length > 0 && (
              <p data-testid="safety-lock-unchecked">{t('lock.unchecked', { defaultValue: 'Not yet checked: {{names}}', names: readiness.uncheckedWorkers.join(', ') })}</p>
            )}
            {readiness.noWithoutNote.length > 0 && (
              <p className="text-destructive-text" data-testid="safety-lock-note">{t('lock.needNote', { defaultValue: 'Write a note for the No answers first: {{items}}', items: readiness.noWithoutNote.join(', ') })}</p>
            )}
          </div>
        )}
        confirmLabel={t('actions.submit', 'Submit and lock')} confirmDisabled={readiness.noWithoutNote.length > 0} loading={m.submitDay.isPending}
        error={lockError} onCancel={() => setLocking(false)} onConfirm={() => void submit()} />
      <ReasonDialog open={correcting} kind="return" title={t('correct.title', 'Correct this safety day')} label={t('correct.label', 'Reason for the correction')}
        confirmLabel={t('correct.confirm', 'Start correction')} loading={m.correctDay.isPending} error={dialogError}
        onConfirm={(r) => void correct(r)} onCancel={() => setCorrecting(false)} />
    </div>
  );
};
export default SafetyDayForm;
