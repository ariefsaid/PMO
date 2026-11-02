import React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  Combobox,
  Icon,
  type ComboboxOption,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useMeetingMutations } from '@/src/hooks/useMeetings';
import { repositories, type MeetingAttendeeWithRefs, type MeetingGrantWithRefs } from '@/src/lib/repositories';

interface MeetingSharingProps {
  meetingId: string;
  meetingAuthorId: string | null;
  currentUserId: string | null;
  projectManager: { id: string; full_name: string } | null;
  attendeesQuery: Pick<UseQueryResult<MeetingAttendeeWithRefs[]>, 'data' | 'isPending' | 'isError'>;
  grantsQuery: Pick<UseQueryResult<MeetingGrantWithRefs[]>, 'data' | 'isPending' | 'isError' | 'refetch'>;
  onError: (err: unknown) => void;
}

const MeetingSharing: React.FC<MeetingSharingProps> = ({
  meetingId,
  meetingAuthorId,
  currentUserId,
  projectManager,
  attendeesQuery,
  grantsQuery,
  onError,
}) => {
  const { t } = useTranslation();
  const { t: tMeetings } = useTranslation('meetings');
  const { toast } = useToast();
  const may = usePermission();
  const { addGrant, revokeGrant } = useMeetingMutations();
  const attendees = attendeesQuery.data ?? [];
  const grants = grantsQuery.data ?? [];
  const attendeeProfileIds = new Set(attendees.map((attendee) => attendee.profile_id).filter(Boolean) as string[]);
  const grantedUserIds = new Set(grants.map((grant) => grant.user_id));
  const hasAccess = (profileId: string): boolean =>
    profileId === meetingAuthorId || attendeeProfileIds.has(profileId) || grantedUserIds.has(profileId);

  // A cached response may still be displayed during a retry, but it is not a complete basis for
  // suggesting another recipient after either access query has failed or is still loading.
  const accessReady = !attendeesQuery.isPending && !attendeesQuery.isError && attendeesQuery.data !== undefined &&
    !grantsQuery.isPending && !grantsQuery.isError && grantsQuery.data !== undefined;
  const pmSuggestion = accessReady && projectManager && !hasAccess(projectManager.id) ? projectManager : null;

  const shareOptionsLoader = async (): Promise<ComboboxOption[]> => {
    const profiles = await repositories.profile.listOrgProfiles();
    return profiles
      .filter((profile) => !hasAccess(profile.id))
      .map((profile) => ({ value: profile.id, label: profile.full_name }));
  };

  const shareWith = async (userId: string, name: string) => {
    try {
      await addGrant.mutateAsync({ meetingId, userId });
      toast(t('meetingDetail.toast.shared', 'Meeting shared'), name, 'success');
    } catch (err) {
      onError(err);
    }
  };

  const retryLabel = tMeetings('sharing.retry', 'Retry sharing');

  return (
    <Card variant="bare" className="mb-4">
      <CardHead>{t('meetingDetail.share.title', 'Sharing')}</CardHead>
      <CardPad>
        <p className="mb-3 text-sm text-muted-foreground">
          {t(
            'meetingDetail.share.explainer',
            'Only attendees, the author, and people it is shared with can read this meeting. Shares are view-only.',
          )}
        </p>
        {grantsQuery.isPending && (
          <div data-testid="meeting-grants-loading" className="mb-3" role="status">
            <span className="text-sm text-muted-foreground">{tMeetings('sharing.loading', 'Loading shares…')}</span>
          </div>
        )}
        {grantsQuery.isError && (
          <div role="alert" data-testid="meeting-grants-error" className="mb-3 flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">
              {tMeetings('sharing.loadError', 'Sharing details could not be loaded. Retry to check who has access.')}
            </p>
            <Button variant="outline" size="sm" onClick={() => void grantsQuery.refetch()}>{retryLabel}</Button>
          </div>
        )}
        {pmSuggestion && (
          <div className="mb-3">
            <Button
              variant="outline"
              size="sm"
              data-testid="share-suggest-pm"
              disabled={addGrant.isPending}
              onClick={() => void shareWith(pmSuggestion.id, pmSuggestion.full_name)}
            >
              <Icon name="plus" />
              {t('meetingDetail.share.suggestPm', 'Share with {{name}} (Project Manager)', {
                name: pmSuggestion.full_name,
              })}
            </Button>
          </div>
        )}
        {grantsQuery.data !== undefined && (
          <ul className="flex flex-col gap-1.5" data-testid="grants-list">
            {grants.length === 0 && !grantsQuery.isPending && !grantsQuery.isError && (
              <li className="text-sm text-muted-foreground">
                {t('meetingDetail.share.empty', 'Not shared with anyone yet.')}
              </li>
            )}
            {grants.map((grant: MeetingGrantWithRefs) => {
              const canRevoke =
                may('delete', 'meeting') ||
                grant.granted_by === currentUserId ||
                meetingAuthorId === currentUserId;
              return (
                <li key={grant.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {grant.user?.full_name ?? '—'}
                    {grant.granter && (
                      <span className="ml-2 text-muted-foreground">
                        {t('meetingDetail.share.sharedBy', 'shared by')} {grant.granter.full_name}
                      </span>
                    )}
                  </span>
                  {canRevoke && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`grant-revoke-${grant.id}`}
                      onClick={() => void revokeGrant.mutateAsync(grant.id).catch(onError)}
                    >
                      {t('meetingDetail.share.revoke', 'Revoke')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 max-w-md">
          <Combobox
            label={t('meetingDetail.share.addLabel', 'Share with a named person')}
            value={null}
            onChange={(_value, option) => void shareWith(option.value, option.label)}
            loadOptions={shareOptionsLoader}
            placeholder={t('meetingDetail.share.addPlaceholder', 'Pick an organisation member…')}
            noun={t('meetingDetail.share.memberNoun', 'member')}
            disabled={!accessReady}
          />
        </div>
      </CardPad>
    </Card>
  );
};

export default MeetingSharing;
