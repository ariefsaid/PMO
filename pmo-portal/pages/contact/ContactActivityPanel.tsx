import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button,
  Icon,
  StatusPill,
  ListState,
  ConfirmDialog,
  TextField,
  TextArea,
  SelectField,
  FormGrid,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useContactActivities, useContactMeetings, useContactMutations } from '@/src/hooks/useContacts';
import type { ContactMeetingRef } from '@/src/lib/db/meetings';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { firstInstantOfZonedCalendarDay, formatCalendarDayInTimeZone, formatDay } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { crmActivityVariant } from '@/src/lib/status/statusVariants';
import type { CrmActivityKind, CrmActivityInput, CrmActivityRow } from '@/src/lib/db/crmActivities';
import { EditActivityModal } from '@/pages/activity/EditActivityModal';
import { ActivityShowMore } from '@/pages/activity/ActivityShowMore';
import { hrefForActivity } from './activityLinks';

/**
 * The contact record page's activity panel (CROSS-69): the touchpoint log + timeline, moved off
 * ContactDetail. The timeline UNIONS the touchpoint log with MINUTED meetings this contact
 * attended (DD-MTG-6); the meetings half stays a separate query — a meeting failure degrades to
 * a quiet one-line note and never takes down the touchpoint log, and the two timeline halves are
 * never merged into one query. Edit/delete go through the ONE shared CRM activity edit modal.
 */
const kindOptions = (t: TFunction) => [
  { value: 'Call', label: t('contactDetail.activityKind.call', 'Call') },
  { value: 'Email', label: t('contactDetail.activityKind.email', 'Email') },
  { value: 'Meeting', label: t('contactDetail.activityKind.meeting', 'Meeting') },
  { value: 'Note', label: t('contactDetail.activityKind.note', 'Note') },
];

/** The kind's localized label — the pill reads the same words as the form's select. */
const kindLabel = (kind: string, t: TFunction): string =>
  kindOptions(t).find((option) => option.value === kind)?.label ?? kind;

/** formatDay renders unparseable input as an em-dash — never echo a raw ISO string. */
const formatOccurred = (iso: string): string => formatDay(iso);

const todayInActiveTimeZone = (date = new Date()): string =>
  formatCalendarDayInTimeZone(date, getActiveLocale().timezone);

interface ContactActivityPanelProps {
  contactId: string;
  canLog: boolean;
  logFormOpen: boolean;
  onLogFormOpenChange: (open: boolean) => void;
}

export const ContactActivityPanel: React.FC<ContactActivityPanelProps> = ({
  contactId,
  canLog,
  logFormOpen,
  onLogFormOpenChange,
}) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useContactActivities(contactId);
  // DD-MTG-6 (second half): the timeline unions the touchpoint log with MINUTED meetings this
  // contact attended. RLS filters the meetings to what the viewer may read (FR-MTG-031) — most
  // viewers legitimately see none, so empty is a normal state, never an error.
  const meetingsQuery = useContactMeetings(contactId);
  const { logActivity, updateActivity, deleteActivity } = useContactMutations();
  const canEdit = may('edit', 'contactActivity');
  const canDelete = may('delete', 'contactActivity');

  const [kind, setKind] = useState<CrmActivityKind>('Call');
  const [activityDate, setActivityDate] = useState(() => todayInActiveTimeZone());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Edit modal state
  const [editingActivity, setEditingActivity] = useState<CrmActivityRow | null>(null);
  // Delete confirm state
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);

  const activities = data ?? [];
  // #1990: only the newest activity page is loaded, so a meeting older than the oldest loaded
  // activity waits for "Show more" rather than jumping ahead of activity that is not loaded yet.
  const oldestLoaded = hasNextPage ? activities[activities.length - 1]?.occurred_at : undefined;
  const contactMeetings = (meetingsQuery.data ?? []).filter(
    (m) => oldestLoaded === undefined || m.occurred_at >= oldestLoaded,
  );

  // One timeline, newest-first: touchpoints (editable) + minuted meetings (read-only links).
  type TimelineEntry =
    | { kind: 'activity'; occurredAt: string; activity: CrmActivityRow }
    | { kind: 'meeting'; occurredAt: string; meeting: ContactMeetingRef };
  const timeline: TimelineEntry[] = [
    ...activities.map((a): TimelineEntry => ({ kind: 'activity', occurredAt: a.occurred_at, activity: a })),
    ...contactMeetings.map((m): TimelineEntry => ({ kind: 'meeting', occurredAt: m.occurred_at, meeting: m })),
  ].sort((x, y) => (x.occurredAt < y.occurredAt ? 1 : x.occurredAt > y.occurredAt ? -1 : 0));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() && !body.trim()) return;
    const now = new Date();
    const occurredAt = activityDate === todayInActiveTimeZone(now)
      ? now
      : firstInstantOfZonedCalendarDay(activityDate);
    if (!occurredAt) return;
    const input: CrmActivityInput = {
      contact_id: contactId,
      kind,
      subject: subject.trim() || null,
      body: body.trim() || null,
      occurred_at: occurredAt.toISOString(),
      company_id: null,
      project_id: null,
    };
    try {
      await logActivity.mutateAsync(input);
      toast(t('contactDetail.toast.activityLogged', 'Activity logged'), subject.trim() || kind, 'success');
      setSubject('');
      setBody('');
      setKind('Call');
      setActivityDate(todayInActiveTimeZone());
      onLogFormOpenChange(false);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deletingActivityId) return;
    try {
      await deleteActivity.mutateAsync(deletingActivityId);
      toast(t('contactDetail.toast.activityDeleted', 'Activity deleted'), '', 'success');
      setDeletingActivityId(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      {isPending && <ListState variant="loading" rows={3} />}

      {!isPending && isError && (
        <ListState
          variant="error"
          title={t('contactDetail.activity.error.title', "Couldn't load activity")}
          sub={t('contactDetail.activity.error.sub', 'The request failed. Try again.')}
          onRetry={() => refetch()}
        />
      )}

      {/* The meetings half of the union failing must not take down the touchpoint log — a quiet
          one-line note, never an error card (the activities query above owns the error surface). */}
      {!isPending && !isError && meetingsQuery.isError && (
        <p className="mb-2 text-control text-muted-foreground">
          {t('contactDetail.meetings.error', 'Minuted meetings could not be loaded.')}
        </p>
      )}

      {!isPending && !isError && timeline.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-control text-muted-foreground">
          {t('contactDetail.activity.empty', 'No activity logged yet.')}
        </p>
      )}

      {!isPending && !isError && timeline.length > 0 && (
        <ol data-testid="activity-timeline" className="flex flex-col gap-3">
          {timeline.map((entry) => {
            // DD-MTG-6: a minuted meeting renders READ-ONLY — its record lives in the meeting
            // module (edit rights are the author's there), the timeline only links across.
            if (entry.kind === 'meeting') {
              const m = entry.meeting;
              return (
                <li
                  key={`meeting-${m.id}`}
                  data-testid="timeline-meeting"
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill variant="violet">
                      {t('contactDetail.meetings.pill', 'Minuted meeting')}
                    </StatusPill>
                    <span className="text-control text-muted-foreground">
                      {formatOccurred(m.occurred_at)}
                    </span>
                  </div>
                  <Link
                    to={`/meetings/${m.id}`}
                    className="text-control font-medium text-foreground hover:text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    {m.title}
                  </Link>
                </li>
              );
            }
            const a = entry.activity;
            const relatedHref = hrefForActivity(a);
            return (
              <li key={a.id} className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill variant={crmActivityVariant(a.kind)}>{kindLabel(a.kind, t)}</StatusPill>
                  <div className="flex items-center gap-1">
                    <span className="text-control text-muted-foreground">{formatOccurred(a.occurred_at)}</span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('contactDetail.activity.editAction', 'Edit activity')}
                        onClick={() => setEditingActivity(a)}
                      >
                        <Icon name="pencil" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('contactDetail.activity.deleteAction', 'Delete activity')}
                        onClick={() => setDeletingActivityId(a.id)}
                      >
                        <Icon name="trash" />
                      </Button>
                    )}
                  </div>
                </div>
                {a.subject && (
                  relatedHref ? (
                    <Link
                      to={relatedHref}
                      className="text-control font-medium text-foreground hover:text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    >
                      {a.subject}
                    </Link>
                  ) : (
                    <span className="text-control font-medium text-foreground">{a.subject}</span>
                  )
                )}
                {a.body && <p className="text-control text-muted-foreground">{a.body}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {!isPending && !isError && timeline.length > 0 && (
        <ActivityShowMore
          shown={timeline.length}
          hasNextPage={Boolean(hasNextPage || meetingsQuery.hasNextPage)}
          isFetchingNextPage={Boolean(isFetchingNextPage || meetingsQuery.isFetchingNextPage)}
          onShowMore={() => {
            if (hasNextPage) void fetchNextPage();
            if (meetingsQuery.hasNextPage) void meetingsQuery.fetchNextPage();
          }}
        />
      )}

      {canLog && logFormOpen && (
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3 rounded-md border border-border bg-card p-3">
          <FormGrid>
            <SelectField
              label={t('contactDetail.activity.type', 'Activity type')}
              value={kind}
              onChange={(v) => setKind(v as CrmActivityKind)}
              options={kindOptions(t)}
            />
            <TextField
              label={t('contactDetail.activity.date', 'Date')}
              aria-label={t('contactDetail.activity.date', 'Date')}
              type="date"
              value={activityDate}
              onChange={setActivityDate}
              required
            />
            <TextField
              label={t('contactDetail.activity.subject', 'Subject')}
              value={subject}
              onChange={setSubject}
              placeholder={t('contactDetail.activity.subjectPlaceholder', 'e.g. Kickoff call')}
            />
          </FormGrid>
          <TextArea
            label={t('contactDetail.activity.notes', 'Notes')}
            value={body}
            onChange={setBody}
            rows={2}
            fullWidth
            placeholder={t('contactDetail.activity.notesPlaceholder', 'What was discussed?')}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={logActivity.isPending}
              disabled={!activityDate || (!subject.trim() && !body.trim())}
            >
              {t('contactDetail.activity.logAction', 'Log activity')}
            </Button>
          </div>
        </form>
      )}

      {/* Edit activity modal — the ONE shared CRM activity edit form (PGA02-006/CROSS-69). */}
      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          module="contacts"
          onClose={() => setEditingActivity(null)}
          onSave={async (patch) => {
            await updateActivity.mutateAsync({ id: editingActivity.id, ...patch });
            toast(
              t('contactDetail.toast.activityUpdated', 'Activity updated'),
              patch.subject ?? editingActivity.kind,
              'success',
            );
            setEditingActivity(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
          isPending={updateActivity.isPending}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deletingActivityId !== null}
        tone="destructive"
        title={t('contactDetail.activity.deleteConfirm.title', 'Delete this activity?')}
        description={t(
          'contactDetail.activity.deleteConfirm.description',
          'This action cannot be undone. The activity log entry will be permanently removed.',
        )}
        confirmLabel={t('contactDetail.activity.deleteConfirm.confirmLabel', 'Delete')}
        loading={deleteActivity.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeletingActivityId(null)}
      />
    </div>
  );
};
