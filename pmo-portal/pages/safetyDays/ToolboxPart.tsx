import { getActiveOrgTimezone } from "@/src/lib/locale/activeLocale";
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, RecordSection, TextField, useToast } from '@/src/components/ui';
import { useSafetyMutations } from '@/src/hooks/useSafetyDays';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import { formatDay, zonedDatetimeLocalToInstant } from '@/src/lib/format';
import type { RosterWorker, SafetyDayDetail, SafetyTalk } from '@/src/lib/db/safetyDays';
import { workerName } from './partHelpers';

const PhotoLink: React.FC<{ path: string; label: string }> = ({ path, label }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <><Button variant="outline" size="sm" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { window.open(await repositories.safetyDay.photoUrl(path), '_blank', 'noopener'); } catch (err) { setError(classifyMutationError(err).headline); } finally { setBusy(false); }
    }}>{label}</Button>{error && <p role="alert">{error}</p>}</>
  );
};

const TalkCard: React.FC<{ talk: SafetyTalk; detail: SafetyDayDetail; roster: RosterWorker[]; editable: boolean; seePeople: boolean }> = ({ talk, detail, roster, editable, seePeople }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const m = useSafetyMutations();
  const file = useRef<HTMLInputElement>(null);
  const fail = (err: unknown) => { const { headline, detail: d } = classifyMutationError(err); toast(headline, d, 'warning'); };
  return (
    <li className="py-3" data-testid="safety-talk">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{talk.topic}</div>
          <div className="text-muted-foreground">{t('toolbox.presentedBy', { defaultValue: 'Presented by {{name}}', name: talk.presenter })} · {formatDay(talk.held_at)}</div>
          <div className="mt-1" data-testid="safety-talk-attendees">
            {seePeople
              ? talk.attendees.map((a) => a.visitor_name ?? workerName(roster, a.worker_id, t('fitness.worker', 'Worker'))).join(', ')
              : t('toolbox.attendeeCount', { defaultValue: '{{count}} attendees', count: talk.attendees.length })}
          </div>
        </div>
        {editable && <Button variant="ghost" size="sm" onClick={() => void m.deleteTalk.mutateAsync(talk.id).catch(fail)}>{t('form.remove', 'Remove')}</Button>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="safety-talk-photos">
        {seePeople && talk.photos.map((p, i) => <PhotoLink key={p.id} path={p.file_path} label={t('toolbox.viewPhoto', { defaultValue: 'Attendance photo {{n}}', n: i + 1 })} />)}
        {!seePeople && talk.photos.length > 0 && <span className="text-muted-foreground">{t('toolbox.photoCount', { defaultValue: '{{count}} photos', count: talk.photos.length })}</span>}
        {editable && (
          <>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="sr-only" data-testid="safety-photo-input" aria-label={t('toolbox.photoInput', 'Attendance photo')}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void m.uploadTalkPhoto.mutateAsync({ day: detail.day, talkId: talk.id, file: f }).catch(fail); }} />
            <Button variant="outline" size="sm" loading={m.uploadTalkPhoto.isPending} onClick={() => file.current?.click()}>{t('toolbox.addPhoto', 'Add attendance photo')}</Button>
          </>
        )}
      </div>
    </li>
  );
};

/** Toolbox talk (FR-DSF-003): topic, presenter, time, attendees from the roster (or visitors) and the attendance photo. */
export const ToolboxPart: React.FC<{ detail: SafetyDayDetail; roster: RosterWorker[]; editable: boolean; seePeople: boolean }> = ({ detail, roster, editable, seePeople }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const m = useSafetyMutations();
  const [topic, setTopic] = useState('');
  const [presenter, setPresenter] = useState('');
  const [time, setTime] = useState('07:00');
  const [picked, setPicked] = useState<string[]>([]);
  const [visitor, setVisitor] = useState('');
  const attendees = [...picked.map((workerId) => ({ workerId })), ...(visitor.trim() ? [{ visitorName: visitor.trim() }] : [])];
  const heldAt = zonedDatetimeLocalToInstant(`${detail.day.work_date}T${time}`, getActiveOrgTimezone())?.toISOString();
  const ok = heldAt && topic.trim() && presenter.trim() && /^\d{2}:\d{2}$/.test(time) && attendees.length > 0;

  const save = async () => {
    try {
      await m.saveTalk.mutateAsync({ dayId: detail.day.id, topic, presenter, heldAt: heldAt!, attendees });
      setTopic(''); setPresenter(''); setPicked([]); setVisitor('');
    } catch (err) { const { headline, detail: d } = classifyMutationError(err); toast(headline, d, 'warning'); }
  };
  return (
    <RecordSection title={t('toolbox.title', 'Toolbox talk')} data-testid="safety-toolbox">
      {detail.talks.length === 0 && <p className="text-muted-foreground">{t('toolbox.none', 'No toolbox talk recorded')}</p>}
      <ul className="divide-y divide-border">{detail.talks.map((x) => <TalkCard key={x.id} talk={x} detail={detail} roster={roster} editable={editable} seePeople={seePeople} />)}</ul>
      {editable && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (ok) void save(); }}>
          <TextField label={t('toolbox.topic', 'Topic')} value={topic} onChange={setTopic} required />
          <TextField label={t('toolbox.presenter', 'Presenter')} value={presenter} onChange={setPresenter} required />
          <TextField label={t('toolbox.time', 'Held at')} type="time" value={time} onChange={setTime} required error={heldAt ? undefined : t("form.invalidWallTime", "This time does not exist in the organisation timezone")} />
          <TextField label={t('toolbox.visitor', 'Named visitor (optional)')} value={visitor} onChange={setVisitor} />
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 font-medium">{t('toolbox.attendees', 'Attendees from the roster')}</legend>
            {roster.length === 0 && <p className="text-muted-foreground">{t('toolbox.noRoster', 'No one is rostered on this work order for this date')}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {roster.map((w) => (
                <label key={w.worker_id} className="flex items-center gap-2">
                  <Checkbox checked={picked.includes(w.worker_id)} label={w.display_name} onChange={(on) => setPicked((p) => (on ? [...p, w.worker_id] : p.filter((x) => x !== w.worker_id)))} />
                  <span aria-hidden>{w.display_name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!ok || m.saveTalk.isPending} data-testid="safety-talk-save">{t('toolbox.save', 'Save toolbox talk')}</Button></div>
        </form>
      )}
    </RecordSection>
  );
};
