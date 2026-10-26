import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button, Card, CardHead, CardPad, Combobox, ConfirmDialog, FormGrid,
  ListState, SelectField, TextField, useToast,
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
import ActionItemModal from '@/src/components/meetings/ActionItemModal';
import WorkPageHeading from './WorkPageHeading';

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
  const { create, update, addAttendee, createActionItem } = useMeetingMutations();
  const [members, setMembers] = useState<ComboboxOption[]>([]);
  const [guests, setGuests] = useState<string[]>([]);
  const [guestName, setGuestName] = useState('');
  const [minutes, setMinutes] = useState<NoteBlock[]>([]);
  const [minutesPending, setMinutesPending] = useState(false);
  const editorRef = useRef<MinutesEditorHandle>(null);
  const initialMinutesRef = useRef<NoteBlock[]>([]);
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(null);
  const [actionLine, setActionLine] = useState<string | null>(null);
  const [identityPending, setIdentityPending] = useState(false);
  const identityCreationRef = useRef<Promise<string | null> | null>(null);
  const [saveError, setSaveError] = useState(false);
  const routeState = routerLocation.state as { projectId?: unknown } | null;
  const requestedProjectId = typeof routeState?.projectId === 'string'
    ? routeState.projectId
    : new URLSearchParams(routerLocation.search).get('project') ?? '';
  const validate = useMemo(() => makeValidate(t), [t]);
  const form = useEntityForm<Values>({
    initialValues: { title: '', occurredAt: instantToZonedDatetimeLocal(new Date()), location: '', projectId: '' },
    validate, idPrefix: 'meeting-create', requiredFields: ['title'], module: 'meetings',
  });
  const { values: formValues, reset: resetForm } = form;
  const selectedProject = (projects ?? []).find((item) => item.id === formValues.projectId);
  const projectPresetApplied = useRef(false);
  useEffect(() => {
    if (projectPresetApplied.current || !requestedProjectId || !projects) return;
    projectPresetApplied.current = true;
    if (projects.some((item) => item.id === requestedProjectId)) {
      resetForm({ ...formValues, projectId: requestedProjectId });
    }
  }, [formValues, projects, requestedProjectId, resetForm]);
  const title = form.fieldProps('title');
  const when = form.fieldProps('occurredAt');
  const location = form.fieldProps('location');
  const project = form.fieldProps('projectId');
  const dirty = form.isDirty || guestName.trim().length > 0 || guests.length > 0 || members.length > 0 || minutesPending;
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: (leave) => setPendingLeave(() => leave) });
  const onEditorReady = useCallback((blocks: NoteBlock[]) => { initialMinutesRef.current = structuredClone(blocks); setMinutes(blocks); }, []);
  const notifyError = (error: unknown, part: string) => {
    const { headline, detail } = classifyMutationError(error);
    toast(headline, `${part}: ${detail}`, 'warning');
  };
  const loadMembers = async (): Promise<ComboboxOption[]> => {
    const profiles = await repositories.profile.listOrgProfiles();
    return profiles.filter((profile) => profile.id !== currentUser?.id && !members.some((member) => member.value === profile.id))
      .map((profile) => ({ value: profile.id, label: profile.full_name }));
  };
  const ensureMeetingCreated = async (values: Values): Promise<string | null> => {
    if (savedMeetingId) return savedMeetingId;
    if (identityCreationRef.current) return identityCreationRef.current;
    const instant = zonedDatetimeLocalToInstant(values.occurredAt);
    if (!instant) return null;
    setIdentityPending(true);
    const operation = create.mutateAsync({
      title: values.title.trim(),
      occurred_at: instant.toISOString(),
      location: values.location.trim() || null,
      project_id: values.projectId || null,
    }).then((meeting) => {
      setSavedMeetingId(meeting.id);
      return meeting.id;
    }).catch((error: unknown) => {
      notifyError(error, tCreate('createFailed', 'Meeting could not be created.'));
      return null;
    }).finally(() => {
      setIdentityPending(false);
      identityCreationRef.current = null;
    });
    identityCreationRef.current = operation;
    return operation;
  };
  const requestActionItem = async (lineText: string) => {
    if (savedMeetingId) {
      setActionLine(lineText);
      return;
    }
    let validValues: Values | undefined;
    await form.handleSubmit(async (values) => { validValues = values; });
    if (!validValues) return;
    const meetingId = await ensureMeetingCreated(validValues);
    if (meetingId) setActionLine(lineText);
  };
  const onCreateActionItem = async (input: { name: string; assigneeId: string; endDate: string }) => {
    if (!savedMeetingId) throw new Error('Meeting identity is not ready.');
    const finalName = input.name.trim() || t('meetingDetail.action.placeholderName', 'Untitled action');
    const created = await createActionItem.mutateAsync({
      meetingId: savedMeetingId,
      projectId: formValues.projectId || null,
      name: finalName,
      assigneeId: input.assigneeId || null,
      endDate: input.endDate || null,
    });
    editorRef.current?.insertActionItem(created.id);
    toast(t('meetingDetail.toast.actionCreated', 'Action item created'), finalName, 'success');
    setActionLine(null);
  };
  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    void form.handleSubmit(async (values) => {
      const meetingId = await ensureMeetingCreated(values);
      if (!meetingId) return;
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
          initialMinutesRef.current = structuredClone(liveMinutes);
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

  if (!may('create', 'meeting')) return <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
    <WorkPageHeading title={t('workPageHeading.meeting', 'Meeting')} scope={t('workPageHeading.meetingScope', 'Meeting record')} />
    <ListState variant="empty" title={tCreate('denied', 'You do not have permission to create meetings.')} />
  </main>;

  const attendeeCount = members.length + guests.length;
  const lockedIdentity = Boolean(savedMeetingId) || identityPending || form.isSubmitting;
  return <main className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-6">
    <div className="mb-4"><BackBar label={t('meetingDetail.backToMeetings', 'Meetings')} onBack={() => guardLeave(() => returnToList())} /></div>
    <WorkPageHeading
      className="mb-6"
      title={t('meetings.form.newTitle', 'New meeting')}
      scope={selectedProject
        ? tCreate('scopeForProject', 'For {{project}}', { project: projectDisplayName(selectedProject) })
        : tCreate('scopeHint', 'Record the discussion, actions and attendees for one meeting.')}
    />
    <form onSubmit={onSave}>
      <section className="mb-5" aria-label={t('meetingDetail.form.sections.details', 'Details')}>
        <FormGrid className="[&_input]:min-h-11 [&_button]:min-h-11 [&_select]:min-h-11">
          <TextField id={title.id} label={t('meetings.form.title.label', 'Title')} required placeholder={t('meetings.form.title.placeholder', 'e.g. Weekly site coordination')} value={title.value} onChange={title.onChange} onBlur={title.onBlur} error={title.error} fullWidth disabled={lockedIdentity} />
          <TextField id={when.id} label={t('meetings.form.when.label', 'When')} type="datetime-local" value={when.value} onChange={when.onChange} onBlur={when.onBlur} error={when.error} disabled={lockedIdentity} />
          <SelectField id={project.id} label={t('meetings.form.project.label', 'Project')} value={project.value} onChange={project.onChange} options={[{ value: '', label: t('meetings.form.project.none', 'No project') }, ...(projects ?? []).map((item) => ({ value: item.id, label: projectDisplayName(item) }))]} disabled={lockedIdentity} />
          <TextField id={location.id} label={t('meetings.form.location.label', 'Location')} placeholder={t('meetings.form.location.placeholder', 'e.g. Site office, Teams call')} value={location.value} onChange={location.onChange} onBlur={location.onBlur} disabled={lockedIdentity} />
        </FormGrid>
      </section>
      {savedMeetingId && <p role="status" className="mb-4 text-sm text-muted-foreground">{tCreate('identitySaved', 'Meeting details are saved so actions can be linked. Finish the minutes and attendees, then save the meeting.')}</p>}
      <Card variant="bare" className="mb-5"><CardHead>{t('meetingDetail.minutes.title', 'Minutes')}</CardHead><CardPad>
        <Suspense fallback={<ListState variant="loading" rows={3} />}>
          <MinutesEditor ref={editorRef} initialBlocks={[]} editable={!form.isSubmitting && !identityPending} tasksExternal={false} onReady={onEditorReady} onChange={(blocks) => { setMinutes(blocks); setMinutesPending(true); }} onRequestAction={(lineText) => { void requestActionItem(lineText); }} />
        </Suspense>
      </CardPad></Card>
      <Card variant="bare" className="mb-5"><details>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>{t('meetingDetail.attendees.title', 'Attendees')}</span>
          <span className="text-xs font-normal text-muted-foreground">{attendeeCount > 0
            ? tCreate('attendeeCount', '{{count}} added', { count: attendeeCount })
            : tCreate('optional', 'Optional')}</span>
        </summary>
        <CardPad>
          <fieldset disabled={form.isSubmitting}>
            <ul className="mb-3 flex flex-col gap-1.5" data-testid="attendees-list">
              {members.map((member) => <li key={member.value} className="flex min-h-11 items-center gap-2 text-sm"><span className="flex-1">{member.label}</span><Button className="min-h-11" type="button" variant="ghost" size="sm" aria-label={t('meetingDetail.attendees.remove', 'Remove attendee')} onClick={() => setMembers((existing) => existing.filter((item) => item.value !== member.value))}>{t('meetingDetail.attendees.remove', 'Remove attendee')}</Button></li>)}
              {guests.map((guest, index) => <li key={`${guest}-${index}`} className="flex min-h-11 items-center gap-2 text-sm"><span className="flex-1">{guest} <span className="text-muted-foreground">{t('meetingDetail.attendees.guestTag', 'Guest')}</span></span><Button className="min-h-11" type="button" variant="ghost" size="sm" aria-label={t('meetingDetail.attendees.remove', 'Remove attendee')} onClick={() => setGuests((existing) => existing.filter((_item, guestIndex) => guestIndex !== index))}>{t('meetingDetail.attendees.remove', 'Remove attendee')}</Button></li>)}
            </ul>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 [&_button]:min-h-11"><Combobox label={t('meetingDetail.attendees.addMember', 'Add attendee')} value={null} onChange={(_value, option) => setMembers((existing) => [...existing, option])} loadOptions={loadMembers} placeholder={t('meetingDetail.attendees.addMemberPlaceholder', 'Pick an organisation member…')} noun={t('meetingDetail.attendees.memberNoun', 'member')} /></div>
              <div className="flex min-w-0 flex-1 items-end gap-2"><div className="min-w-0 flex-1"><TextField className="[&_input]:min-h-11" id="meeting-create-guest" label={t('meetingDetail.attendees.guestLabel', 'External guest')} value={guestName} onChange={setGuestName} /></div><Button className="min-h-11" type="button" variant="outline" disabled={!guestName.trim()} onClick={() => { setGuests((existing) => [...existing, guestName.trim()]); setGuestName(''); }}>{t('meetingDetail.attendees.addGuest', 'Add guest')}</Button></div>
            </div>
          </fieldset>
        </CardPad>
      </details></Card>
      {saveError && <p role="alert" className="mb-4 text-sm text-destructive-text">{tCreate('partialSaveFailed', 'Meeting saved, but some details were not saved. Save again to retry.')}</p>}
      <div className="flex justify-end pb-6"><Button className="min-h-11" type="submit" variant="primary" disabled={form.isSubmitting || identityPending || create.isPending || addAttendee.isPending || update.isPending}>{tCreate('save', 'Save meeting')}</Button></div>
      {actionLine !== null && <ActionItemModal
        key={actionLine}
        initialName={actionLine}
        projectName={selectedProject ? projectDisplayName(selectedProject) : null}
        onClose={() => setActionLine(null)}
        onCreate={onCreateActionItem}
        onError={(error: unknown) => notifyError(error, t('meetingDetail.action.createFailed', 'Action item could not be created.'))}
      />}
      <ConfirmDialog open={pendingLeave !== null} tone="default" title={t('meetingDetail.confirm.unsavedMinutes.title', 'Unsaved meeting changes')} description={t('meetingDetail.confirm.unsavedMinutes.description', 'Your meeting details, minutes or attendees have not been saved. Leave and discard them?')} confirmLabel={t('meetingDetail.confirm.unsavedMinutes.leave', 'Leave')} cancelLabel={t('meetingDetail.confirm.unsavedMinutes.stay', 'Stay')} onConfirm={() => { const leave = pendingLeave; setPendingLeave(null); leave?.(); }} onCancel={() => setPendingLeave(null)} />
    </form>
  </main>;
};

export default MeetingCreate;
