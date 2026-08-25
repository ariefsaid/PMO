import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type {
  MeetingWithRefs,
  MeetingInput,
  MeetingPatch,
  MeetingListParams,
  MeetingAttendeeWithRefs,
  MeetingAttendeeInput,
  MeetingGrantWithRefs,
} from '@/src/lib/db/meetings';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Meetings hooks (#526) over the repository seam (ADR-0017). Reads are RLS-scoped to
 * attendance ∪ author ∪ grant ∪ Admin (FR-MTG-031, migration 0205) — the caller sees only the
 * rows the server admits, and no hook widens that. queryKeys include org_id so caches are
 * tenant-scoped (FR-QRY).
 */
export function useMeetings(params?: MeetingListParams) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<MeetingWithRefs[]>({
    queryKey: ['meetings', orgId, params?.projectId ?? 'all', params?.search ?? ''],
    queryFn: () => repositories.meeting.list(params),
    enabled: Boolean(orgId),
    // Keep the previous rows on screen while a search/filter keystroke refetches — the list
    // must not flash its loading skeleton (and unmount the search box) on every character.
    placeholderData: (prev: MeetingWithRefs[] | undefined) => prev,
  });
}

/** A single meeting by id — null when absent or RLS-scoped out (calm not-found, FR-MTG-031). */
export function useMeeting(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<MeetingWithRefs | null>({
    queryKey: ['meeting', orgId, id],
    queryFn: () => repositories.meeting.get(id!),
    enabled: Boolean(orgId && id),
  });
}

/** A meeting's attendees (visible iff the meeting is). */
export function useMeetingAttendees(meetingId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<MeetingAttendeeWithRefs[]>({
    queryKey: ['meeting-attendees', orgId, meetingId],
    queryFn: () => repositories.meeting.listAttendees(meetingId!),
    enabled: Boolean(orgId && meetingId),
  });
}

/** A meeting's view grants (OD-MTG-2 — the share panel's list). */
export function useMeetingGrants(meetingId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<MeetingGrantWithRefs[]>({
    queryKey: ['meeting-grants', orgId, meetingId],
    queryFn: () => repositories.meeting.listGrants(meetingId!),
    enabled: Boolean(orgId && meetingId),
  });
}

/** The tasks minuted out of this meeting (the /action seam, migration 0206). */
export function useMeetingActionItems(meetingId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<TaskWithRefs[]>({
    queryKey: ['meeting-action-items', orgId, meetingId],
    queryFn: () => repositories.task.listByMeeting(meetingId!),
    enabled: Boolean(orgId && meetingId),
  });
}

export interface UpdateMeetingArgs {
  id: string;
  patch: MeetingPatch;
}

export interface AddAttendeeArgs {
  meetingId: string;
  identity: MeetingAttendeeInput;
}

export interface AddGrantArgs {
  meetingId: string;
  userId: string;
}

export interface CreateActionItemArgs {
  meetingId: string;
  /** The meeting's own project (or null) — the /action contract pins the task to it. */
  projectId: string | null;
  /** Prefilled from the minute line; FR-MTG-017's placeholder when the line is blank. */
  name: string;
}

/**
 * Meeting mutations over the repository seam. Each invalidates the relevant query family so
 * open lists/details refetch. Errors propagate as `AppError` (code preserved) for
 * `classifyMutationError`.
 */
export function useMeetingMutations() {
  const qc = useQueryClient();
  const invalidateMeetings = () => {
    qc.invalidateQueries({ queryKey: ['meetings'] });
    qc.invalidateQueries({ queryKey: ['meeting'] });
  };

  const create = useMutation({
    mutationFn: (input: MeetingInput) => repositories.meeting.create(input),
    onSuccess: invalidateMeetings,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: UpdateMeetingArgs) => repositories.meeting.update(id, patch),
    onSuccess: invalidateMeetings,
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.meeting.archive(id),
    onSuccess: invalidateMeetings,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.meeting.delete(id),
    onSuccess: invalidateMeetings,
  });

  const addAttendee = useMutation({
    mutationFn: ({ meetingId, identity }: AddAttendeeArgs) =>
      repositories.meeting.addAttendee(meetingId, identity),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-attendees'] }),
  });

  const removeAttendee = useMutation({
    mutationFn: (id: string) => repositories.meeting.removeAttendee(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-attendees'] }),
  });

  const addGrant = useMutation({
    mutationFn: ({ meetingId, userId }: AddGrantArgs) =>
      repositories.meeting.addGrant(meetingId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-grants'] }),
  });

  const revokeGrant = useMutation({
    mutationFn: (id: string) => repositories.meeting.revokeGrant(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-grants'] }),
  });

  /**
   * The /action seam (FR-MTG-017, DD-MTG-2 "immediate, never lossy"): create the task NOW, with
   * `meeting_id` set and `project_id` pinned to the meeting's own project (or null — a
   * project-less action item under a project-less meeting is legal, DD-TASK-1). The task write
   * goes through the SAME repository path the task list uses — the meeting never owns a copy.
   */
  const createActionItem = useMutation({
    mutationFn: ({ meetingId, projectId, name }: CreateActionItemArgs) =>
      repositories.task.create({
        project_id: projectId,
        name,
        status: 'To Do',
        assignee_id: null,
        meeting_id: meetingId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting-action-items'] });
      // A /action task is a real task — refresh any open task list too, not just the meeting's
      // own action-item list: the project Tasks tab keys off ['tasks', …] and My Tasks off
      // ['my-tasks', …] (distinct caches — both must be busted).
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });

  return {
    create,
    update,
    archive,
    remove,
    addAttendee,
    removeAttendee,
    addGrant,
    revokeGrant,
    createActionItem,
  };
}
