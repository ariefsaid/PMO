import React, { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  Combobox,
  ListState,
  TextField,
  type ComboboxOption,
} from '@/src/components/ui';
import { useMeetingMutations } from '@/src/hooks/useMeetings';
import { profileRepository } from '@/src/lib/repositories/admin';
import type { MeetingAttendeeWithRefs } from '@/src/lib/repositories/dataTypes';

interface MeetingAttendeesProps {
  meetingId: string;
  canEdit: boolean;
  attendeesQuery: Pick<UseQueryResult<MeetingAttendeeWithRefs[]>, 'data' | 'isPending' | 'isError' | 'refetch'>;
  onError: (err: unknown) => void;
}

const attendeeName = (attendee: MeetingAttendeeWithRefs): string =>
  attendee.profile?.full_name ?? attendee.contact?.full_name ?? attendee.display_name ?? '—';

const MeetingAttendees: React.FC<MeetingAttendeesProps> = ({ meetingId, canEdit, attendeesQuery, onError }) => {
  const { t } = useTranslation();
  const { t: tMeetings } = useTranslation('meetings');
  const { addAttendee, removeAttendee } = useMeetingMutations();
  const [guestName, setGuestName] = useState('');
  const attendees = attendeesQuery.data ?? [];
  const attendeeProfileIds = new Set(attendees.map((attendee) => attendee.profile_id).filter(Boolean) as string[]);

  const memberOptionsLoader = async (): Promise<ComboboxOption[]> => {
    const profiles = await profileRepository.listOrgProfiles();
    return profiles
      .filter((profile) => !attendeeProfileIds.has(profile.id))
      .map((profile) => ({ value: profile.id, label: profile.full_name }));
  };

  const addMember = async (option: ComboboxOption) => {
    try {
      await addAttendee.mutateAsync({ meetingId, identity: { profile_id: option.value } });
    } catch (err) {
      onError(err);
    }
  };

  const addGuest = async () => {
    const name = guestName.trim();
    if (!name) return;
    try {
      await addAttendee.mutateAsync({ meetingId, identity: { display_name: name } });
      setGuestName('');
    } catch (err) {
      onError(err);
    }
  };

  return (
    <Card variant="bare" className="mb-4">
      <CardHead>{t('meetingDetail.attendees.title', 'Attendees')}</CardHead>
      <CardPad>
        {attendeesQuery.isPending && (
          <div data-testid="meeting-attendees-loading"><ListState variant="loading" rows={3} /></div>
        )}
        {attendeesQuery.isError && (
          <div role="alert" data-testid="meeting-attendees-error" className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              {tMeetings('attendees.loadError', 'Attendees could not be loaded. Retry to view the access list.')}
            </p>
            <Button variant="outline" size="sm" onClick={() => void attendeesQuery.refetch()}>
              {tMeetings('attendees.retry', 'Retry attendees')}
            </Button>
          </div>
        )}
        {attendeesQuery.data !== undefined && (
          <>
            {attendees.length === 0 && !attendeesQuery.isPending && !attendeesQuery.isError && (
              <p className="mb-2 text-sm text-muted-foreground">
                {t('meetingDetail.attendees.empty', 'No attendees recorded. Attendees can read this meeting’s minutes.')}
              </p>
            )}
            <ul className="flex flex-col gap-1.5" data-testid="attendees-list">
              {attendees.map((attendee) => (
                <li key={attendee.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {attendeeName(attendee)}
                    {!attendee.profile_id && (
                      <span className="ml-2 text-muted-foreground">
                        {attendee.contact_id
                          ? t('meetingDetail.attendees.contactTag', 'Contact')
                          : t('meetingDetail.attendees.guestTag', 'Guest')}
                      </span>
                    )}
                  </span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('meetingDetail.attendees.remove', 'Remove attendee')}
                      onClick={() => void removeAttendee.mutateAsync(attendee.id).catch(onError)}
                    >
                      {t('meetingDetail.attendees.remove', 'Remove attendee')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Combobox
                    label={t('meetingDetail.attendees.addMember', 'Add attendee')}
                    value={null}
                    onChange={(_value, option) => void addMember(option)}
                    loadOptions={memberOptionsLoader}
                    placeholder={t('meetingDetail.attendees.addMemberPlaceholder', 'Pick an organisation member…')}
                    noun={t('meetingDetail.attendees.memberNoun', 'member')}
                    disabled={attendeesQuery.isPending || attendeesQuery.isError}
                  />
                </div>
                <div className="flex min-w-0 flex-1 items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <TextField
                      id="meeting-guest-name"
                      label={t('meetingDetail.attendees.guestLabel', 'External guest')}
                      value={guestName}
                      onChange={setGuestName}
                      placeholder={t('meetingDetail.attendees.guestPlaceholder', 'e.g. Guest from a partner organisation')}
                    />
                  </div>
                  <Button
                    variant="outline"
                    data-testid="attendee-add-guest"
                    disabled={
                      !guestName.trim() || addAttendee.isPending || attendeesQuery.isPending ||
                      attendeesQuery.isError || attendeesQuery.data === undefined
                    }
                    onClick={() => void addGuest()}
                  >
                    {t('meetingDetail.attendees.addGuest', 'Add guest')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardPad>
    </Card>
  );
};

export default MeetingAttendees;
