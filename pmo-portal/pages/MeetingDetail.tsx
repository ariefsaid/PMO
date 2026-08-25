import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  ListState,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
  GateNotice,
  Combobox,
  useEntityForm,
  useToast,
  type SubmitError,
  type ComboboxOption,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import {
  useMeeting,
  useMeetingAttendees,
  useMeetingGrants,
  useMeetingActionItems,
  useMeetingMutations,
} from '@/src/hooks/useMeetings';
import { useProjects } from '@/src/hooks/useProjects';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError, isMeetingReadDenied } from '@/src/lib/classifyMutationError';
import { formatDateTime, formatDate } from '@/src/lib/format';
import { toDatetimeLocalValue } from '@/src/lib/datetimeLocal';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { routeTaskWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  parseNoteBlocks,
  type MeetingWithRefs,
  type MeetingNoteBlock,
  type MeetingAttendeeWithRefs,
  type MeetingGrantWithRefs,
} from '@/src/lib/db/meetings';

/**
 * MeetingDetail — the routable `/meetings/:id` record page (#526).
 *
 * The minutes body is the v1 typed-paragraph block editor (spec §3 as scoped by the brief: a
 * line-per-block editor, NOT the BlockNote spike — DD-MTG-2 ruled the typed block down to a task
 * reference, and this slice keeps action items as real `tasks` rows linked via
 * `tasks.meeting_id`). Reading is attendance ∪ author ∪ grant ∪ Admin (FR-MTG-031, RLS is the
 * authority); editing the minute is the AUTHOR or Admin (grants are view-only, OD-MTG-2).
 * The share panel (FR-MTG-032..034): named users, view-only, no tiers/links/expiry, and the
 * project's PM is PRE-SUGGESTED as a one-click add — never auto-granted (DD-MTG-7).
 */

const attendeeName = (a: MeetingAttendeeWithRefs): string =>
  a.profile?.full_name ?? a.contact?.full_name ?? a.display_name ?? '—';

const MeetingDetail: React.FC = () => {
  const { t } = useTranslation();
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;

  const query = useMeeting(meetingId);
  const attendeesQuery = useMeetingAttendees(meetingId);
  const grantsQuery = useMeetingGrants(meetingId);
  const actionItemsQuery = useMeetingActionItems(meetingId);
  const { data: projects } = useProjects();
  const { update, archive, remove, addAttendee, removeAttendee, addGrant, revokeGrant, createActionItem } =
    useMeetingMutations();

  // ── Minutes editor state (blocks re-seed when a different meeting loads) ──
  const meeting = query.data ?? null;
  const [blocks, setBlocks] = useState<MeetingNoteBlock[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (meeting && meeting.id !== seededFor) {
      setBlocks(parseNoteBlocks(meeting.notes));
      setSeededFor(meeting.id);
    }
  }, [meeting, seededFor]);

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [guestName, setGuestName] = useState('');
  // DD-MTG-8: /action opens the task-create modal prefilled from THIS line (null = closed).
  const [actionLine, setActionLine] = useState<string | null>(null);

  const savedBlocks = useMemo(() => (meeting ? parseNoteBlocks(meeting.notes) : []), [meeting]);
  const minutesDirty = useMemo(
    () => JSON.stringify(blocks) !== JSON.stringify(savedBlocks),
    [blocks, savedBlocks],
  );

  const canEdit = may('edit', 'meeting', {
    currentUserId,
    record: { created_by_id: meeting?.created_by_id ?? null },
  });
  const canArchive = may('archive', 'meeting');
  const canDelete = may('delete', 'meeting');

  // §8.5: in an org whose tasks domain is externally-owned (ClickUp), /action cannot create a
  // task — the affordance explains itself instead of 42501-ing (fail-closed 'pmo' when unknown).
  const tasksExternal = routeTaskWrite(meeting?.project_id ?? undefined) === 'external';

  const goBack = () => navigate('/meetings');
  const backLabel = t('meetingDetail.backToMeetings', 'Meetings');

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  // ── Loading / error / not-found ───────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label={backLabel} onBack={goBack} />
        <div data-testid="meeting-loading">
          <ListState variant="loading" rows={5} />
        </div>
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        <BackBar label={backLabel} onBack={goBack} />
        <ListState
          variant="error"
          title={t('meetingDetail.error.title', "Couldn't load meeting")}
          sub={t('meetingDetail.error.sub', 'Something went wrong fetching this meeting.')}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  if (!meeting) {
    return (
      <>
        <BackBar label={backLabel} onBack={goBack} />
        <div data-testid="meeting-not-found">
          <ListState
            variant="empty"
            icon="cal"
            title={t('meetingDetail.notFound.title', 'Meeting not found')}
            sub={t(
              'meetingDetail.notFound.sub',
              "This meeting either doesn't exist or isn't shared with you. Ask an attendee or its author to share it.",
            )}
          />
        </div>
      </>
    );
  }

  const attendees = attendeesQuery.data ?? [];
  const grants = grantsQuery.data ?? [];
  const actionItems = actionItemsQuery.data ?? [];

  // The identities that already have access — the share panel never re-suggests them.
  const attendeeProfileIds = new Set(attendees.map((a) => a.profile_id).filter(Boolean) as string[]);
  const grantedUserIds = new Set(grants.map((g) => g.user_id));
  const hasAccess = (profileId: string): boolean =>
    profileId === meeting.created_by_id ||
    attendeeProfileIds.has(profileId) ||
    grantedUserIds.has(profileId);

  // FR-MTG-034 (DD-MTG-7): the project's PM gets NO automatic read — pre-suggest them for a
  // one-click share when a project is set and they don't already have access.
  const pmSuggestion =
    meeting.project?.pm && !hasAccess(meeting.project.pm.id) ? meeting.project.pm : null;

  const onSaveMinutes = async () => {
    try {
      await update.mutateAsync({ id: meeting.id, patch: { notes: blocks } });
      toast(t('meetingDetail.toast.minutesSaved', 'Minutes saved'), meeting.title, 'success');
    } catch (err) {
      onMutationError(err);
    }
  };

  /**
   * DD-MTG-8: the /action save — invoked from the modal with the text the author CHOSE to
   * publish, never straight from the line. `tasks_select` is org-wide, so the task name leaves
   * the attendance-keyed read model the moment it is created; the modal is what makes that an
   * informed act. FR-MTG-017's placeholder remains the empty-name fallback.
   */
  const onCreateActionItem = async (name: string) => {
    const finalName =
      name.trim() || t('meetingDetail.action.placeholderName', 'Untitled action');
    await createActionItem.mutateAsync({
      meetingId: meeting.id,
      projectId: meeting.project_id,
      name: finalName,
    });
    toast(t('meetingDetail.toast.actionCreated', 'Action item created'), finalName, 'success');
    setActionLine(null);
  };

  const onAddMember = async (option: ComboboxOption) => {
    try {
      await addAttendee.mutateAsync({
        meetingId: meeting.id,
        identity: { profile_id: option.value },
      });
    } catch (err) {
      onMutationError(err);
    }
  };

  const onAddGuest = async () => {
    const name = guestName.trim();
    if (!name) return;
    try {
      await addAttendee.mutateAsync({ meetingId: meeting.id, identity: { display_name: name } });
      setGuestName('');
    } catch (err) {
      onMutationError(err);
    }
  };

  const onShareWith = async (userId: string, name: string) => {
    try {
      await addGrant.mutateAsync({ meetingId: meeting.id, userId });
      toast(t('meetingDetail.toast.shared', 'Meeting shared'), name, 'success');
    } catch (err) {
      onMutationError(err);
    }
  };

  const onArchiveConfirm = async () => {
    try {
      await archive.mutateAsync(meeting.id);
      toast(t('meetingDetail.toast.archived', 'Meeting archived'), meeting.title, 'success');
      setArchiveOpen(false);
      navigate('/meetings');
    } catch (err) {
      onMutationError(err);
    }
  };

  const onDeleteConfirm = async () => {
    try {
      await remove.mutateAsync(meeting.id);
      toast(t('meetingDetail.toast.deleted', 'Meeting deleted'), meeting.title, 'success');
      setDeleteOpen(false);
      navigate('/meetings');
    } catch (err) {
      onMutationError(err);
      setDeleteOpen(false);
    }
  };

  const memberOptionsLoader = async (): Promise<ComboboxOption[]> => {
    const profiles = await repositories.profile.listOrgProfiles();
    return profiles
      .filter((p) => !attendeeProfileIds.has(p.id))
      .map((p) => ({ value: p.id, label: p.full_name }));
  };

  const shareOptionsLoader = async (): Promise<ComboboxOption[]> => {
    const profiles = await repositories.profile.listOrgProfiles();
    // Author, attendees and existing grantees already read the meeting — offering them again
    // would only manufacture duplicate-grant 23505s.
    return profiles
      .filter((p) => !hasAccess(p.id))
      .map((p) => ({ value: p.id, label: p.full_name }));
  };

  const hasHeaderActions = canEdit || canArchive || canDelete;

  return (
    <div>
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label={backLabel} onBack={goBack} />
      </div>

      <RecordHeader
        name={meeting.title}
        icon={(meeting.title.trim().charAt(0) || '•').toUpperCase()}
        status={
          meeting.archived_at ? (
            <StatusPill variant="neutral">{t('meetingDetail.pill.archived', 'Archived')}</StatusPill>
          ) : (
            <StatusPill variant="violet">{t('meetingDetail.pill.meeting', 'Meeting')}</StatusPill>
          )
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatDateTime(new Date(meeting.occurred_at))}</span>
            {meeting.location && <span>{meeting.location}</span>}
            {meeting.project && (
              <Link
                to={`/projects/${meeting.project.id}`}
                className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {meeting.project.name}
              </Link>
            )}
          </span>
        }
        actions={
          hasHeaderActions ? (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="meeting-edit" onClick={() => setEditOpen(true)}>
                  {t('meetingDetail.edit', 'Edit')}
                </Button>
              )}
              {canArchive && !meeting.archived_at && (
                <Button variant="ghost" size="sm" data-testid="meeting-archive" onClick={() => setArchiveOpen(true)}>
                  {t('meetingDetail.archive', 'Archive')}
                </Button>
              )}
              {canDelete && (
                <Button variant="ghost" size="sm" data-testid="meeting-delete" onClick={() => setDeleteOpen(true)}>
                  {t('meetingDetail.delete', 'Delete')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* ── Minutes ─────────────────────────────────────────────────────────── */}
      <Card variant="bare" className="mb-4">
        <CardHead>
          <span>{t('meetingDetail.minutes.title', 'Minutes')}</span>
          {canEdit && (
            <span className="ml-auto">
              <Button
                variant="primary"
                size="sm"
                data-testid="minutes-save"
                disabled={!minutesDirty || update.isPending}
                onClick={() => void onSaveMinutes()}
              >
                {t('meetingDetail.minutes.save', 'Save minutes')}
              </Button>
            </span>
          )}
        </CardHead>
        <CardPad>
          {canEdit ? (
            <div className="flex flex-col gap-2" data-testid="minutes-editor">
              {tasksExternal && (
                <GateNotice variant="blocked" className="mb-2" data-testid="minutes-external-gate">
                  {t(
                    'meetingDetail.action.externalGate',
                    'Tasks are managed by the connected task system, so action items cannot be created from these minutes.',
                  )}
                </GateNotice>
              )}
              {blocks.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('meetingDetail.minutes.emptyEditor', 'No minutes yet — add the first line.')}
                </p>
              )}
              {blocks.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <TextField
                      id={`minute-line-${i}`}
                      label={t('meetingDetail.minutes.lineLabel', 'Minute line')}
                      hideLabel
                      value={b.text}
                      onChange={(v) =>
                        setBlocks((prev) => prev.map((p, j) => (j === i ? { ...p, text: v } : p)))
                      }
                      placeholder={t('meetingDetail.minutes.linePlaceholder', 'Type a minute…')}
                      fullWidth
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`minute-action-${i}`}
                    disabled={tasksExternal || createActionItem.isPending}
                    title={t(
                      'meetingDetail.action.buttonTitle',
                      'Create a task from this line (the meeting keeps only a reference)',
                    )}
                    // DD-MTG-8: opens the task-create modal, prefilled and editable — the task
                    // name is org-visible, so publishing it is the AUTHOR's explicit choice.
                    onClick={() => setActionLine(b.text)}
                  >
                    {t('meetingDetail.action.button', 'Action')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('meetingDetail.minutes.removeLine', 'Remove line')}
                    onClick={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Icon name="x" />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="minutes-add-line"
                  onClick={() => setBlocks((prev) => [...prev, { type: 'p', text: '' }])}
                >
                  <Icon name="plus" />
                  {t('meetingDetail.minutes.addLine', 'Add line')}
                </Button>
              </div>
            </div>
          ) : savedBlocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('meetingDetail.minutes.empty', 'No minutes were recorded for this meeting.')}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5" data-testid="minutes-readonly">
              {savedBlocks.map((b, i) => (
                <p key={i} className="text-sm leading-6">
                  {b.text || ' '}
                </p>
              ))}
            </div>
          )}
        </CardPad>
      </Card>

      {/* ── Action items (real tasks, linked via tasks.meeting_id — DD-MTG-2) ── */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('meetingDetail.actionItems.title', 'Action items')}</CardHead>
        <CardPad>
          {actionItemsQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              {t('meetingDetail.actionItems.error', "Couldn't load this meeting's action items.")}
            </p>
          ) : actionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'meetingDetail.actionItems.empty',
                'No action items yet. Use Action on a minute line to create one.',
              )}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="action-items-list">
              {actionItems.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{task.name}</span>
                  <StatusPill variant={workflowVariant(task.status)}>{task.status}</StatusPill>
                  {task.assignee && (
                    <span className="text-muted-foreground">{task.assignee.full_name}</span>
                  )}
                  {task.end_date && (
                    <span className="text-muted-foreground">{formatDate(task.end_date)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardPad>
      </Card>

      {/* ── Attendees (the read-access list — FR-MTG-031) ──────────────────── */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('meetingDetail.attendees.title', 'Attendees')}</CardHead>
        <CardPad>
          {attendees.length === 0 && (
            <p className="mb-2 text-sm text-muted-foreground">
              {t(
                'meetingDetail.attendees.empty',
                'No attendees recorded. Attendees can read this meeting’s minutes.',
              )}
            </p>
          )}
          <ul className="flex flex-col gap-1.5" data-testid="attendees-list">
            {attendees.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {attendeeName(a)}
                  {!a.profile_id && (
                    <span className="ml-2 text-muted-foreground">
                      {a.contact_id
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
                    onClick={() => void removeAttendee.mutateAsync(a.id).catch(onMutationError)}
                  >
                    <Icon name="x" />
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
                  onChange={(_v, option) => void onAddMember(option)}
                  loadOptions={memberOptionsLoader}
                  placeholder={t('meetingDetail.attendees.addMemberPlaceholder', 'Pick an organisation member…')}
                  noun={t('meetingDetail.attendees.memberNoun', 'member')}
                />
              </div>
              <div className="flex min-w-0 flex-1 items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextField
                    id="meeting-guest-name"
                    label={t('meetingDetail.attendees.guestLabel', 'External guest')}
                    value={guestName}
                    onChange={setGuestName}
                    placeholder={t('meetingDetail.attendees.guestPlaceholder', 'e.g. Ir. Sari (Acme)')}
                  />
                </div>
                <Button
                  variant="outline"
                  data-testid="attendee-add-guest"
                  disabled={!guestName.trim() || addAttendee.isPending}
                  onClick={() => void onAddGuest()}
                >
                  {t('meetingDetail.attendees.addGuest', 'Add guest')}
                </Button>
              </div>
            </div>
          )}
        </CardPad>
      </Card>

      {/* ── Share (view-only grants — OD-MTG-2 / FR-MTG-032..034) ──────────── */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('meetingDetail.share.title', 'Sharing')}</CardHead>
        <CardPad>
          <p className="mb-3 text-sm text-muted-foreground">
            {t(
              'meetingDetail.share.explainer',
              'Only attendees, the author, and people it is shared with can read this meeting. Shares are view-only.',
            )}
          </p>
          {pmSuggestion && (
            <div className="mb-3">
              <Button
                variant="outline"
                size="sm"
                data-testid="share-suggest-pm"
                disabled={addGrant.isPending}
                onClick={() => void onShareWith(pmSuggestion.id, pmSuggestion.full_name)}
              >
                <Icon name="plus" />
                {/* M12: interpolated key — safe now that test/setup.ts initialises i18next. */}
                {t('meetingDetail.share.suggestPm', 'Share with {{name}} (Project Manager)', {
                  name: pmSuggestion.full_name,
                })}
              </Button>
            </div>
          )}
          <ul className="flex flex-col gap-1.5" data-testid="grants-list">
            {grants.length === 0 && (
              <li className="text-sm text-muted-foreground">
                {t('meetingDetail.share.empty', 'Not shared with anyone yet.')}
              </li>
            )}
            {grants.map((g: MeetingGrantWithRefs) => {
              const canRevoke =
                may('delete', 'meeting') ||
                g.granted_by === currentUserId ||
                meeting.created_by_id === currentUserId;
              return (
                <li key={g.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {g.user?.full_name ?? '—'}
                    {g.granter && (
                      <span className="ml-2 text-muted-foreground">
                        {t('meetingDetail.share.sharedBy', 'shared by')} {g.granter.full_name}
                      </span>
                    )}
                  </span>
                  {canRevoke && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`grant-revoke-${g.id}`}
                      onClick={() => void revokeGrant.mutateAsync(g.id).catch(onMutationError)}
                    >
                      {t('meetingDetail.share.revoke', 'Revoke')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 max-w-md">
            <Combobox
              label={t('meetingDetail.share.addLabel', 'Share with a named person')}
              value={null}
              onChange={(_v, option) => void onShareWith(option.value, option.label)}
              loadOptions={shareOptionsLoader}
              placeholder={t('meetingDetail.share.addPlaceholder', 'Pick an organisation member…')}
              noun={t('meetingDetail.share.memberNoun', 'member')}
            />
          </div>
        </CardPad>
      </Card>

      {/* ── /action task-create modal (DD-MTG-8) ───────────────────────────── */}
      {actionLine !== null && (
        <ActionItemModal
          initialName={actionLine.trim()}
          projectName={meeting.project?.name ?? null}
          onClose={() => setActionLine(null)}
          onCreate={onCreateActionItem}
          onError={onMutationError}
        />
      )}

      {/* ── Edit modal ─────────────────────────────────────────────────────── */}
      {editOpen && (
        <MeetingEditModal
          meeting={meeting}
          projectOptions={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onClose={() => setEditOpen(false)}
          onSave={async (patch) => {
            await update.mutateAsync({ id: meeting.id, patch });
            toast(t('meetingDetail.toast.updated', 'Meeting updated'), meeting.title, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={t('meetingDetail.confirm.archiveTitle', 'Archive meeting?')}
        description={t(
          'meetingDetail.confirm.archiveDescription',
          'It will be hidden from the default list. Its minutes, attendees and action items stay intact.',
        )}
        confirmLabel={t('meetingDetail.confirm.archiveConfirm', 'Archive meeting')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />

      <ConfirmDialog
        open={deleteOpen}
        tone="destructive"
        title={t('meetingDetail.confirm.deleteTitle', 'Delete meeting?')}
        description={t(
          'meetingDetail.confirm.deleteDescription',
          'This permanently removes the meeting and its minutes. A meeting whose action items still exist as tasks cannot be deleted; archive it instead.',
        )}
        confirmLabel={t('meetingDetail.confirm.deleteConfirm', 'Delete meeting')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
};

// ── /action task-create modal (DD-MTG-8) ────────────────────────────────────

interface ActionItemModalProps {
  /** The minute line's text — the PREFILL, fully editable (never silently published). */
  initialName: string;
  /** The meeting's project name, or null — the task's project is FIXED to it, shown not chosen. */
  projectName: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onError: (err: unknown) => void;
}

/**
 * DD-MTG-8: `/action` is an informed authoring act. The minute line prefills the task name, the
 * author edits it freely, and only what they submit reaches `tasks.name` — a column the org-wide
 * `tasks_select` exposes to peers the attendance-keyed meeting read model excludes. Project is
 * fixed to the meeting's own project (the /action contract); meeting linkage is set on save.
 * Built on the shared form primitives, matching every other create modal.
 */
const ActionItemModal: React.FC<ActionItemModalProps> = ({
  initialName,
  projectName,
  onClose,
  onCreate,
  onError,
}) => {
  const { t } = useTranslation();
  const form = useEntityForm<{ name: string }>({
    initialValues: { name: initialName },
    validate: () => ({}), // an empty name is legal — FR-MTG-017's placeholder covers it on save
    idPrefix: 'meeting-action-form',
    module: 'meetings',
  });
  const nameField = form.fieldProps('name');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onCreate(values.name);
      } catch (err) {
        // #526 security review: the 0206 trigger blocks linking a task to a meeting the caller
        // can't read. This should never fire here — the modal only opens from a meeting already
        // on screen — but if it does, name it plainly rather than as a generic role denial.
        if (isMeetingReadDenied(err)) {
          setSaveError({
            headline: t('meetingDetail.action.readDeniedHeadline', 'Action item not created'),
            detail: t(
              'meetingDetail.action.readDeniedDetail',
              'You can only create action items on meetings you can access.',
            ),
          });
          onError(err);
          return;
        }
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'meetings',
          operation: 'create',
          suppressCapture: true,
        });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('meetingDetail.action.modalTitle', 'New action item')}
      subtitle={t(
        'meetingDetail.action.modalSubtitle',
        'This creates a real task. Its name is visible to everyone who can see tasks — edit it before publishing.',
      )}
      submitLabel={t('meetingDetail.action.modalSubmit', 'Create task')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitError={saveError}
    >
      <FormSection legend={t('meetingDetail.action.modalSection', 'Task')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('meetingDetail.action.nameLabel', 'Task name')}
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            placeholder={t('meetingDetail.action.placeholderName', 'Untitled action')}
            helper={t(
              'meetingDetail.action.nameHelper',
              'Prefilled from the minute line. Left empty, the task is created with the placeholder name.',
            )}
            fullWidth
          />
          <div className="text-sm">
            <div className="mb-1 font-medium text-muted-foreground">
              {t('meetingDetail.action.projectLabel', 'Project')}
            </div>
            <p data-testid="action-modal-project">
              {projectName ?? t('meetingDetail.action.projectNone', 'No project')}{' '}
              <span className="text-muted-foreground">
                {t('meetingDetail.action.projectFixed', '(fixed to this meeting’s project)')}
              </span>
            </p>
          </div>
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

// ── Edit header modal ───────────────────────────────────────────────────────

interface EditFormValues {
  title: string;
  occurredAt: string;
  location: string;
  projectId: string;
}

const makeEditValidate =
  (t: TFunction) =>
  (v: EditFormValues): Partial<Record<keyof EditFormValues, string>> => {
    const errors: Partial<Record<keyof EditFormValues, string>> = {};
    if (!v.title.trim())
      errors.title = t('meetingDetail.form.errors.titleRequired', 'Meeting title is required.');
    return errors;
  };

interface MeetingEditModalProps {
  meeting: MeetingWithRefs;
  projectOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (patch: {
    title: string;
    occurred_at: string;
    location: string | null;
    project_id: string | null;
  }) => Promise<void>;
  onError: (err: unknown) => void;
}

const MeetingEditModal: React.FC<MeetingEditModalProps> = ({
  meeting,
  projectOptions,
  onClose,
  onSave,
  onError,
}) => {
  const { t } = useTranslation();
  const validate = useMemo(() => makeEditValidate(t), [t]);
  const form = useEntityForm<EditFormValues>({
    initialValues: {
      title: meeting.title,
      occurredAt: toDatetimeLocalValue(new Date(meeting.occurred_at)),
      location: meeting.location ?? '',
      projectId: meeting.project_id ?? '',
    },
    validate,
    idPrefix: 'meeting-edit-form',
    requiredFields: ['title'],
    module: 'meetings',
  });

  const titleField = form.fieldProps('title');
  const occurredField = form.fieldProps('occurredAt');
  const locationField = form.fieldProps('location');
  const projectField = form.fieldProps('projectId');

  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          title: values.title.trim(),
          occurred_at: new Date(values.occurredAt).toISOString(),
          location: values.location.trim() || null,
          project_id: values.projectId || null,
        });
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'meetings',
          operation: 'update',
          suppressCapture: true,
        });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('meetingDetail.form.editTitle', 'Edit meeting')}
      subtitle={t('meetingDetail.form.editSubtitle', 'Update this meeting record')}
      submitLabel={t('meetingDetail.form.editSubmit', 'Save meeting')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={
        form.errors.title ? [{ fieldId: titleField.id, message: form.errors.title }] : undefined
      }
      submitError={saveError}
    >
      <FormSection legend={t('meetingDetail.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField
            id={titleField.id}
            label={t('meetingDetail.form.title.label', 'Title')}
            required
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            error={titleField.error}
            fullWidth
          />
          <TextField
            id={occurredField.id}
            label={t('meetingDetail.form.when.label', 'When')}
            type="datetime-local"
            value={occurredField.value}
            onChange={occurredField.onChange}
            onBlur={occurredField.onBlur}
          />
          <TextField
            id={locationField.id}
            label={t('meetingDetail.form.location.label', 'Location')}
            value={locationField.value}
            onChange={locationField.onChange}
            onBlur={locationField.onBlur}
          />
          <SelectField
            id={projectField.id}
            label={t('meetingDetail.form.project.label', 'Project')}
            value={projectField.value}
            onChange={(v) => projectField.onChange(v)}
            onBlur={projectField.onBlur}
            options={[
              { value: '', label: t('meetingDetail.form.project.none', 'No project') },
              ...projectOptions,
            ]}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default MeetingDetail;
