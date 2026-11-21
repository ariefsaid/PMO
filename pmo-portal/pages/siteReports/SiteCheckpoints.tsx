import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, StatusPill, TextArea, type StatusVariant } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useDayCheckpoints, useRecordCheckpoint } from '@/src/hooks/useSiteCheckpoints';
import { siteCheckpointRepository } from '@/src/lib/repositories/siteCheckpoints';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { checkpointState } from '@/src/lib/siteCheckpoints';
import type { DayCheckpoint } from '@/src/lib/repositories/siteCheckpoints';
import { checkpointTimeZone, formatCheckpointTime } from './checkpointTime';

/**
 * The day's timed checkpoints of a work order on its daily site report (#2594, FR-STC-032). Phone first: one row per
 * checkpoint, the next one due is marked current, recording takes a camera photo and an optional note. The server stamps the
 * time and the person. The section renders nothing while the organisation has no checkpoints (the list is empty or the
 * viewer may not read them), so it adds nothing to a report until an Admin sets a list. Late is said in words.
 */
export const SiteCheckpoints: React.FC<{ workOrderId: string; workDate: string; projectManagerId: string | null; canRecordDay: boolean }> = ({
  workOrderId, workDate, projectManagerId, canRecordDay,
}) => {
  const { t } = useTranslation('siteReport');
  const query = useDayCheckpoints(workOrderId, workDate);
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const [open, setOpen] = useState<string | null>(null);
  const now = new Date();

  // A report never waits on its checkpoints: while loading, on a failed read, and with none to show, the section is absent.
  if (query.isPending || query.isError) return null;
  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  const current = rows.find((r) => !r.recorded_at)?.id ?? null;
  const crews = [...new Set(rows.map((r) => r.crew_id))];
  return (
    <RecordSection title={t('checkpoints.title', 'Checkpoints')} subline={t('checkpoints.timezone', 'Times shown in {{zone}}', { zone: checkpointTimeZone() })} data-testid="dsr-checkpoints">
      <div className="space-y-4">
        {crews.map((crewId) => {
          const crewRows = rows.filter((r) => r.crew_id === crewId);
          return (
            <div key={crewId}>
              {crews.length > 1 && <h3 className="mb-1 text-control font-semibold text-foreground">{crewRows[0].crew_name}</h3>}
              <ul className="divide-y divide-border">
                {crewRows.map((r) => {
                  const mayRecord = canRecordDay && !r.recorded_at && can('create', 'siteCheckpoint', {
                    realRole, currentUserId: userId,
                    record: { project_manager_id: projectManagerId, field_controller_id: r.field_controller_id },
                  });
                  return (
                    <CheckpointRow key={r.id} row={r} now={now} isCurrent={r.id === current} open={open === r.id} mayRecord={mayRecord}
                      onToggle={() => setOpen(open === r.id ? null : r.id)} onDone={() => setOpen(null)} />
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </RecordSection>
  );
};

const stateWords = (r: DayCheckpoint, live: ReturnType<typeof checkpointState>): { variant: StatusVariant; key: string; text: string } => {
  if (r.recorded_at) return live === 'on_time'
    ? { variant: 'won', key: 'onTime', text: 'On time' }
    : { variant: 'overdue', key: 'recordedLate', text: 'Recorded late' };
  return live === 'late' ? { variant: 'overdue', key: 'late', text: 'Late' } : { variant: 'neutral', key: 'pending', text: 'Due' };
};

const CheckpointRow: React.FC<{ row: DayCheckpoint; now: Date; isCurrent: boolean; open: boolean; mayRecord: boolean; onToggle: () => void; onDone: () => void }> = ({
  row, now, isCurrent, open, mayRecord, onToggle, onDone,
}) => {
  const { t } = useTranslation('siteReport');
  const record = useRecordCheckpoint();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const live = checkpointState(row, now);
  const words = stateWords(row, live);

  const submit = async () => {
    setError(undefined);
    try {
      await record.mutateAsync({ checkpointId: row.id, file, note: note.trim() || null });
      setFile(null); setNote(''); onDone();
    } catch (err) {
      setError(classifyMutationError(err).headline);
    }
  };
  const openPhoto = async (path: string) => {
    const url = await siteCheckpointRepository.photoUrl(path);
    window.open(url, '_blank', 'noopener');
  };
  const needPhoto = row.photo_required && !file;

  return (
    <li className="py-2" data-testid={`checkpoint-${row.id}`} aria-current={isCurrent ? 'step' : undefined}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {row.name}
            {isCurrent && <span className="ml-2 text-control font-normal text-muted-foreground">{t('checkpoints.next', 'Next')}</span>}
          </p>
          <p className="tabular-nums text-control text-muted-foreground">
            {t('checkpoints.due', 'Due {{time}}', { time: formatCheckpointTime(row.due_at) })}
            {row.recorded_at && ` · ${t('checkpoints.recordedAt', 'Recorded {{time}}', { time: formatCheckpointTime(row.recorded_at) })}`}
            {row.recorded_by_name && ` · ${row.recorded_by_name}`}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <StatusPill variant={words.variant}>{t(`checkpoints.state.${words.key}`, words.text)}</StatusPill>
          {mayRecord && <Button variant={isCurrent ? 'primary' : 'outline'} size="sm" aria-expanded={open} onClick={onToggle}>{t('checkpoints.record', 'Record')}</Button>}
        </span>
      </div>
      {row.note && <p className="text-control text-muted-foreground">{row.note}</p>}
      {row.photo_path && (
        <button type="button" className="min-h-11 text-left text-control text-primary-text hover:underline" onClick={() => void openPhoto(row.photo_path as string)}>
          {t('checkpoints.viewPhoto', 'View photo')}
        </button>
      )}
      {open && mayRecord && (
        <div className="mt-2 space-y-3 rounded-md border border-border p-3" data-testid="checkpoint-record-panel">
          <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" data-testid="checkpoint-photo-input"
            aria-label={t('checkpoints.file', 'Photo file')}
            onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) setFile(f); }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => input.current?.click()}>{file ? t('checkpoints.retake', 'Retake photo') : t('checkpoints.takePhoto', 'Take photo')}</Button>
            <span className="text-control text-muted-foreground">
              {file ? file.name : row.photo_required ? t('checkpoints.photoNeeded', 'A photo is needed') : t('checkpoints.photoOptional', 'Photo is optional')}
            </span>
          </div>
          <TextArea label={t('checkpoints.note', 'Note (optional)')} value={note} onChange={setNote} maxLength={500} />
          {error && <p role="alert" className="text-foreground">{error}</p>}
          <Button variant="primary" onClick={() => void submit()} loading={record.isPending} disabled={needPhoto}>{t('checkpoints.confirm', 'Record now')}</Button>
        </div>
      )}
    </li>
  );
};
