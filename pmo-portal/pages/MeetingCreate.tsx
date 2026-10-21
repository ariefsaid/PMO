import React, { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button, Card, CardHead, CardPad, Combobox, ConfirmDialog, FormGrid,
  ListState, RecordHeader, SelectField, TextField, useToast,
  type ComboboxOption,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useProjects } from '@/src/hooks/useProjects';
import { useMeetingMutations } from '@/src/hooks/useMeetings';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { useListReturn } from '@/src/hooks/useListReturn';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { instantToZonedDatetimeLocal, zonedDatetimeLocalToInstant } from '@/src/lib/format';
import { useEntityForm } from '@/src/components/ui';
import type { NoteBlock } from '@/src/lib/meetingNotes';
import type { MinutesEditorHandle } from '@/src/components/meetings/MinutesEditor';

const MinutesEditor = React.lazy(() => import('@/src/components/meetings/MinutesEditor'));
interface Values { title: string; occurredAt: string; location: string; projectId: string }
const makeValidate = (t: TFunction) => (values: Values): Partial<Record<keyof Values, string>> => {
  const errors: Partial<Record<keyof Values, string>> = {};
  if (!values.title.trim()) errors.title = t('meetingDetail.form.errors.titleRequired', 'Meeting title is required.');
  if (!zonedDatetimeLocalToInstant(values.occurredAt)) errors.occurredAt = t('meetingDetail.form.errors.whenInvalid', 'Enter a valid date and time.');
  return errors;
};

const MeetingCreate: React.FC = () => {
  const { t } = useTranslation();
  const { t: tCreate } = useTranslation('meetingCreate');
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { returnToList } = useListReturn({ list: 'meetings' });
  const { data: projects } = useProjects();
  const { create, update, addAttendee } = useMeetingMutations();
  const [members, setMembers] = useState<ComboboxOption[]>([]);
  const [guests, setGuests] = useState<string[]>([]);
  const [guestName, setGuestName] = useState('');
  const [minutes, setMinutes] = useState<NoteBlock[]>([]);
  const [minutesPending, setMinutesPending] = useState(false);
  const editorRef = useRef<MinutesEditorHandle>(null);
  const initialMinutesRef = useRef<NoteBlock[]>([]);
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const validate = useMemo(() => makeValidate(t), [t]);
  const form = useEntityForm<Values>({
    initialValues: { title: '', occurredAt: instantToZonedDatetimeLocal(new Date()), location: '', projectId: '' },
    validate, idPrefix: 'meeting-create', requiredFields: ['title'], module: 'meetings',
  });
  const title = form.fieldProps('title');
  const when = form.fieldProps('occurredAt');
  const location = form.fieldProps('location');
  const project = form.fieldProps('projectId');
  const dirty = form.isDirty || guestName.trim().length > 0 || guests.length > 0 || members.length > 0 || minutesPending || minutes.length > 0;
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: (leave) => setPendingLeave(() => leave) });
  const onEditorReady = useCallback((blocks: NoteBlock[]) => { initialMinutesRef.current = blocks; setMinutes(blocks); }, []);
  const notifyError = (error: unknown, part: string) => {
    const { headline, detail } = classifyMutationError(error);
    toast(headline, `${part}: ${detail}`, 'warning');
  };
  const loadMembers = async (): Promise<ComboboxOption[]> => {
    const profiles = await repositories.profile.listOrgProfiles();
    return profiles.filter((profile) => profile.id !== currentUser?.id && !members.some((member) => member.value === profile.id))
      .map((profile) => ({ value: profile.id, label: profile.full_name }));
  };
  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    void form.handleSubmit(async (values) => {
      const instant = zonedDatetimeLocalToInstant(values.occurredAt);
      if (!instant) return;
      let meetingId = savedMeetingId;
      if (!meetingId) {
        try {
          const meeting = await create.mutateAsync({
            title: values.title.trim(), occurred_at: instant.toISOString(),
            location: values.location.trim() || null, project_id: values.projectId || null,
          });
          meetingId = meeting.id;
          setSavedMeetingId(meetingId);
        } catch (error) {
          notifyError(error, tCreate('createFailed', 'Meeting could not be created.'));
          return;
        }
      }
      const failedMembers: ComboboxOption[] = [];
      const failedGuests: string[] = [];
      let failedMinutes = false;
      for (const member of members) {
        try { await addAttendee.mutateAsync({ meetingId, identity: { profile_id: member.value } }); }
        catch { failedMembers.push(member); }
      }
      for (const name of guests) {
        try { await addAttendee.mutateAsync({ meetingId, identity: { display_name: name } }); }
        catch { failedGuests.push(name); }
      }
      const liveMinutes = editorRef.current?.getDocument() ?? minutes;
      const minutesChanged = minutesPending || JSON.stringify(liveMinutes) !== JSON.stringify(initialMinutesRef.current);
      if (minutesChanged) {
        try {
          await update.mutateAsync({ id: meetingId, patch: { notes: liveMinutes } });
          setMinutesPending(false);
        } catch { failedMinutes = true; }
      }
      setMembers(failedMembers);
      setGuests(failedGuests);
      if (failedMembers.length || failedGuests.length || failedMinutes) {
        setSaveError(true);
        return;
      }
      navigate(`/meetings/${meetingId}`, { replace: true, state: routerLocation.state });
      toast(t('meetings.toast.created', 'Meeting created'), values.title.trim(), 'success');
    });
  };

  if (!may('create', 'meeting')) return <ListState variant="empty" title={tCreate('denied', 'You do not have permission to create meetings.')} />;

  return <form onSubmit={onSave}>
    <div className="mb-3"><BackBar label={t('meetingDetail.backToMeetings', 'Meetings')} onBack={() => guardLeave(() => returnToList())} /></div>
    <RecordHeader name={title.value || t('meetings.form.newTitle', 'New meeting')} icon="M" status={null} />
    <section className="mb-4" aria-label={t('meetingDetail.form.sections.details', 'Details')}>
      <FormGrid>
        <TextField id={title.id} label={t('meetings.form.title.label', 'Title')} required placeholder={t('meetings.form.title.placeholder', 'e.g. Weekly site coordination')} value={title.value} onChange={title.onChange} onBlur={title.onBlur} error={title.error} fullWidth disabled={Boolean(savedMeetingId) || form.isSubmitting} />
        <TextField id={when.id} label={t('meetings.form.when.label', 'When')} type="datetime-local" value={when.value} onChange={when.onChange} onBlur={when.onBlur} error={when.error} disabled={Boolean(savedMeetingId) || form.isSubmitting} />
        <TextField id={location.id} label={t('meetings.form.location.label', 'Location')} placeholder={t('meetings.form.location.placeholder', 'e.g. Site office, Teams call')} value={location.value} onChange={location.onChange} onBlur={location.onBlur} disabled={Boolean(savedMeetingId) || form.isSubmitting} />
        <SelectField id={project.id} label={t('meetings.form.project.label', 'Project')} value={project.value} onChange={project.onChange} options={[{ value: '', label: t('meetings.form.project.none', 'No project') }, ...(projects ?? []).map((item) => ({ value: item.id, label: item.name }))]} disabled={Boolean(savedMeetingId) || form.isSubmitting} />
      </FormGrid>
    </section>
    <Card variant="bare" className="mb-4"><CardHead>{t('meetingDetail.minutes.title', 'Minutes')}</CardHead><CardPad><Suspense fallback={<ListState variant="loading" rows={3} />}><MinutesEditor ref={editorRef} initialBlocks={[]} editable={!form.isSubmitting} tasksExternal={false} onReady={onEditorReady} onChange={(blocks) => { setMinutes(blocks); setMinutesPending(true); }} onRequestAction={() => undefined} /></Suspense></CardPad></Card>
    <Card variant="bare" className="mb-4"><CardHead>{t('meetingDetail.attendees.title', 'Attendees')}</CardHead><CardPad>
      <fieldset disabled={form.isSubmitting}>
      <ul className="mb-3 flex flex-col gap-1.5" data-testid="attendees-list">
        {members.map((member) => <li key={member.value} className="flex items-center gap-2 text-sm"><span className="flex-1">{member.label}</span><Button type="button" variant="ghost" size="sm" aria-label={t('meetingDetail.attendees.remove', 'Remove attendee')} onClick={() => setMembers((existing) => existing.filter((item) => item.value !== member.value))}>{t('meetingDetail.attendees.remove', 'Remove attendee')}</Button></li>)}
        {guests.map((guest, index) => <li key={`${guest}-${index}`} className="flex items-center gap-2 text-sm"><span className="flex-1">{guest} <span className="text-muted-foreground">{t('meetingDetail.attendees.guestTag', 'Guest')}</span></span><Button type="button" variant="ghost" size="sm" aria-label={t('meetingDetail.attendees.remove', 'Remove attendee')} onClick={() => setGuests((existing) => existing.filter((_item, guestIndex) => guestIndex !== index))}>{t('meetingDetail.attendees.remove', 'Remove attendee')}</Button></li>)}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><Combobox label={t('meetingDetail.attendees.addMember', 'Add attendee')} value={null} onChange={(_value, option) => setMembers((existing) => [...existing, option])} loadOptions={loadMembers} placeholder={t('meetingDetail.attendees.addMemberPlaceholder', 'Pick an organisation member…')} noun={t('meetingDetail.attendees.memberNoun', 'member')} /></div>
        <div className="flex min-w-0 flex-1 items-end gap-2"><div className="min-w-0 flex-1"><TextField id="meeting-create-guest" label={t('meetingDetail.attendees.guestLabel', 'External guest')} value={guestName} onChange={setGuestName} /></div><Button type="button" variant="outline" disabled={!guestName.trim()} onClick={() => { setGuests((existing) => [...existing, guestName.trim()]); setGuestName(''); }}>{t('meetingDetail.attendees.addGuest', 'Add guest')}</Button></div>
      </div>
      </fieldset>
    </CardPad></Card>
    {saveError && <p role="alert" className="mb-4 text-sm text-destructive-text">{tCreate('partialSaveFailed', 'Meeting saved, but some details were not saved. Save again to retry.')}</p>}
    <div className="flex justify-end pb-6"><Button type="submit" variant="primary" disabled={form.isSubmitting || create.isPending}>{tCreate('save', 'Save meeting')}</Button></div>
    <ConfirmDialog open={pendingLeave !== null} tone="default" title={t('meetingDetail.confirm.unsavedMinutes.title', 'Unsaved minutes')} description={t('meetingDetail.confirm.unsavedMinutes.description', 'Your meeting minutes have unsaved changes. Leave this page and discard them?')} confirmLabel={t('meetingDetail.confirm.unsavedMinutes.leave', 'Leave')} cancelLabel={t('meetingDetail.confirm.unsavedMinutes.stay', 'Stay')} onConfirm={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }} onCancel={() => setPendingLeave(null)} />
  </form>;
};

export default MeetingCreate;
