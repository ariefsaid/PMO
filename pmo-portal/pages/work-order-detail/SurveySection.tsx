import React, { useContext, useMemo, useState } from 'react';
import { useAreaHelp } from './useAreaHelp';
import { QueryClientContext } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useAuth } from '@/src/auth/useAuth';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { ConfirmDialog, ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useSurveyMutations, useSurveyRecords } from '@/src/hooks/useSurveyRecords';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useRefusalText } from '@/src/lib/refusals';
import { formatIsoDay, formatNumberExact } from '@/src/lib/format';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { milli } from '@/src/lib/progressBilling';
import type { SurveyRecord } from '@/src/lib/db/surveyRecords';
import SurveyModal, { type SurveyLineOption } from './SurveyModal';

/**
 * A work order's survey records (survey-cap-record). Confirmed surveys of a line add up to its certified quantity, the ceiling a claim
 * is measured against. Recording follows the BAST people (the project's manager, Finance rank and above); confirming is Finance or an
 * Admin and never the recorder. The database decides all of it; `can()` only hides what would be refused.
 */
export interface SurveySectionProps {
  workOrderId: string;
  projectId: string;
  /** Surveys are recorded and confirmed only while the work order is Issued. */
  status: string;
  projectManagerId: string | null;
  /** The contract lines allocated to this work order. */
  lines: SurveyLineOption[];
  today?: string;
}

const SurveyBody: React.FC<SurveySectionProps> = ({ workOrderId, projectId, status, projectManagerId, lines, today: todayProp }) => {
  const orgDay = useOrgToday();
  const today = todayProp ?? orgDay;
  const { t } = useTranslation('survey');
  const may = usePermission();
  const { currentUser } = useAuth();
  const refusal = useRefusalText();
  const query = useSurveyRecords(workOrderId);
  const documents = useDocuments(projectId);
  const { record, confirm, discard } = useSurveyMutations(workOrderId, projectId);
  const [form, setForm] = useState<{ correcting: { id: string; boqItemId: string } | null } | null>(null);
  const [confirming, setConfirming] = useState<SurveyRecord | null>(null);
  const [discarding, setDiscarding] = useState<SurveyRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const lineOf = (id: string) => lines.find((l) => l.id === id);
  const eligible = useMemo(() => (documents.data ?? []).filter((d) => (d.status === 'Issued' || d.status === 'Approved') && Boolean(d.file_path)).map((d) => ({ id: d.id, title: d.title ?? d.id })), [documents.data]);
  const titleOf = (id: string) => (documents.data ?? []).find((d) => d.id === id)?.title ?? t('documents_one', '{{count}} document', { count: 1 });

  const title = t('title', 'Surveys');
  // What a survey is and who records and confirms it: the page's help; the record dialog says how to enter one.
  useAreaHelp('surveys', title, `${t('subline', "What was measured on site, by line. Each confirmed survey ADDS to the line's certified quantity, which caps a claim. Enter what this survey measured, not a running total; to change a mistaken survey use Correct.")} ${t('emptyWho', 'The project manager, Finance or an Admin records a survey here; Finance or an Admin other than the recorder confirms it. A confirmed survey adds to the certified quantity, so enter each measurement once.')}`);
  if (query.isError) {
    return <RecordSection title={title}><ListState variant="error" title={t('loadError', "Couldn't load the surveys")} onRetry={() => void query.refetch()} /></RecordSection>;
  }
  const records = query.data ?? [];
  const ctx = { currentUserId: currentUser?.id ?? null, record: { status, project_manager_id: projectManagerId } };
  const canRecord = may('create', 'surveyRecord', ctx as never);
  const certified = lines.map((l) => {
    const live = records.filter((r) => r.boqItemId === l.id && r.status === 'confirmed' && !r.supersededAt);
    return { line: l, surveyed: live.reduce((a, r) => a + milli(r.surveyedQuantity), 0) / 1000, quality: live.reduce((a, r) => a + milli(r.qualityReadyQuantity), 0) / 1000, any: live.length > 0 };
  });
  const statusOf = (r: SurveyRecord): 'draft' | 'confirmed' | 'superseded' => (r.supersededAt ? 'superseded' : r.status);
  const run = async (action: () => Promise<unknown>, done: () => void) => {
    setMessage(null);
    try { await action(); done(); } catch (err) { const r = refusal(err); setMessage(r.detail ? `${r.headline} ${r.detail}` : r.headline); done(); }
  };

  return <RecordSection title={title}
    actions={canRecord ? <Button variant="outline" size="sm" onClick={() => setForm({ correcting: null })}>{t('record', 'Record a survey')}</Button> : undefined}>
    {!canRecord && (
      <p className="text-control text-muted-foreground" data-testid="survey-hint">
        {status === 'Issued' ? t('hintNotPermitted', 'Only the project manager, Finance or an Admin can record a survey.') : t('hintNotIssued', 'Surveys are recorded while the work order is issued.')}
      </p>
    )}
    {message && <p role="alert" className="mt-2 text-control text-destructive">{message}</p>}
    {records.length === 0 ? (
      <div data-testid="survey-empty" className="mt-2">
        <p className="text-control text-muted-foreground">{t('empty', 'No surveys recorded yet.')}</p>
      </div>
    ) : (
      <>
        <h3 className="mt-3 text-control font-medium">{t('certifiedHeading', 'Certified per line')}</h3>
        <ul className="mt-1 text-control" data-testid="survey-certified">
          {certified.filter((c) => c.any || records.some((r) => r.boqItemId === c.line.id)).map((c) => (
            <li key={c.line.id} className="tabular-nums">
              {c.any
                ? t('certifiedLine', '{{line}}: certified {{certified}} {{unit}}, quality-ready {{quality}} {{unit}}', { line: c.line.label, certified: formatNumberExact(c.surveyed), quality: formatNumberExact(c.quality), unit: c.line.unit })
                : t('noCertified', '{{line}}: nothing certified yet', { line: c.line.label })}
            </li>
          ))}
        </ul>
        <ul aria-label={title} className="mt-3 divide-y divide-border" data-testid="survey-list">
          {records.map((r) => {
            const line = lineOf(r.boqItemId);
            const lineLabel = line?.label ?? r.boqItemId;
            const state = statusOf(r);
            const rec = { status: r.status, recorded_by: r.recordedBy };
            const unit = line?.unit ?? '';
            return <li key={r.id} className="py-3" data-testid={`survey-${r.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium tabular-nums">{t('row', '{{line}}: surveyed {{surveyed}} {{unit}}, quality-ready {{quality}} {{unit}}', { line: lineLabel, surveyed: formatNumberExact(r.surveyedQuantity), quality: formatNumberExact(r.qualityReadyQuantity), unit })}</span>
                <StatusPill variant={state === 'confirmed' ? 'won' : state === 'draft' ? 'progress' : 'neutral'} wrap={false}>{state === 'confirmed' ? t('status.confirmed', 'Confirmed') : state === 'draft' ? t('status.draft', 'Draft') : t('status.superseded', 'Corrected')}</StatusPill>
              </div>
              <p className="mt-1 text-control text-muted-foreground">
                {t('on', 'Surveyed on {{date}}', { date: formatIsoDay(r.surveyDate) })}
                {r.recordedByName ? ` · ${t('by', 'Recorded by {{name}}', { name: r.recordedByName })}` : ''}
                {r.confirmedByName ? ` · ${t('confirmedBy', 'Confirmed by {{name}}', { name: r.confirmedByName })}` : ''}
                {r.supersedesId ? ` · ${t('corrects', 'Corrects an earlier survey')}` : ''}
              </p>
              <p className="mt-1 text-control">
                {r.participants.length > 0
                  ? t('participants', 'Took part: {{list}}', { list: r.participants.map((p) => [p.name, [p.company, p.role].filter(Boolean).join(', ')].filter(Boolean).join(' (') + (p.company || p.role ? ')' : '')).join('; ') })
                  : t('noParticipants', 'No participants listed')}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-control">
                {r.documentIds.length === 0
                  ? <span className="text-muted-foreground">{t('noDocuments', 'No documents attached')}</span>
                  : r.documentIds.map((d) => <Link key={d} to={`/projects/${encodeURIComponent(projectId)}/documents?open=${encodeURIComponent(d)}`} className="font-medium text-primary-text hover:underline">{titleOf(d)}</Link>)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {may('confirm', 'surveyRecord', { ...ctx, record: { ...ctx.record, ...rec } } as never) && !r.supersededAt && (
                  <Button variant="primary" size="sm" aria-label={t('confirm', 'Confirm') + ' ' + lineLabel} onClick={() => setConfirming(r)}>{t('confirm', 'Confirm')}</Button>)}
                {may('delete', 'surveyRecord', { ...ctx, record: { ...ctx.record, ...rec } } as never) && (
                  <Button variant="outline" size="sm" aria-label={t('discard', 'Discard draft') + ' ' + lineLabel} onClick={() => setDiscarding(r)}>{t('discard', 'Discard draft')}</Button>)}
                {r.status === 'confirmed' && !r.supersededAt && canRecord && (
                  <Button variant="outline" size="sm" aria-label={t('correct', 'Correct') + ' ' + lineLabel} onClick={() => setForm({ correcting: { id: r.id, boqItemId: r.boqItemId } })}>{t('correct', 'Correct')}</Button>)}
              </div>
            </li>;
          })}
        </ul>
      </>
    )}
    {form && <SurveyModal workOrderId={workOrderId} lines={lines} documents={eligible} correcting={form.correcting} today={today}
      onClose={() => setForm(null)} onSave={(input) => record.mutateAsync(input)} />}
    <ConfirmDialog open={confirming !== null} title={t('confirmTitle', 'Confirm this survey')} confirmLabel={t('confirmAction', 'Confirm survey')}
      description={confirming ? t('confirmBody', 'Confirming adds {{surveyed}} {{unit}} to the certified quantity of {{line}}. A confirmed survey cannot be edited; a mistake is fixed by recording a correction.',
        { surveyed: formatNumberExact(confirming.surveyedQuantity), unit: lineOf(confirming.boqItemId)?.unit ?? '', line: lineOf(confirming.boqItemId)?.label ?? '' }) : ''}
      loading={confirm.isPending}
      onCancel={() => setConfirming(null)}
      onConfirm={() => { const r = confirming; if (r) void run(() => confirm.mutateAsync(r.id), () => setConfirming(null)); }} />
    <ConfirmDialog open={discarding !== null} tone="destructive" title={t('discardTitle', 'Discard this draft')} confirmLabel={t('discardAction', 'Discard draft')}
      description={t('discardBody', 'The draft is removed from the list. It never counted towards the certified quantity.')}
      loading={discard.isPending}
      onCancel={() => setDiscarding(null)}
      onConfirm={() => { const r = discarding; if (r) void run(() => discard.mutateAsync(r.id), () => setDiscarding(null)); }} />
  </RecordSection>;
};

/** Renders nothing outside the auth and query providers (the page's own read-only tests mount it bare). */
export const SurveySection: React.FC<SurveySectionProps> = (props) => {
  const auth = useContext(AuthContext);
  const queryClient = useContext(QueryClientContext);
  if (!auth || !queryClient) return null;
  return <SurveyBody {...props} />;
};

export default SurveySection;
