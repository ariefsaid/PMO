/** Meeting repository contract (#526, migrations 0205/0206). */
import type {
  MeetingRow,
  MeetingWithRefs,
  ContactMeetingRef,
  MeetingInput,
  MeetingPatch,
  MeetingListParams,
  MeetingAttendeeRow,
  MeetingAttendeeWithRefs,
  MeetingAttendeeInput,
  MeetingGrantRow,
  MeetingGrantWithRefs,
} from '@/src/lib/db/meetings';

/**
 * Meetings repository (#526, migrations 0205/0206). Reads are RLS-scoped to attendance ∪ author ∪
 * grant ∪ Admin (FR-MTG-031) — the repository never widens them. Grants are view-only, named
 * users (OD-MTG-2/FR-MTG-033).
 */
export interface MeetingRepository {
  /** Visible meetings, newest-first, capped; optional project filter + notes/title search. */
  list(params?: MeetingListParams): Promise<MeetingWithRefs[]>;
  /** Meetings a CONTACT attended, RLS-filtered to what the viewer may read (DD-MTG-6 timeline). */
  listForContact(contactId: string): Promise<ContactMeetingRef[]>;
  /** A single meeting by id, or null when not found / not readable (attendance-scoped). */
  get(id: string): Promise<MeetingWithRefs | null>;
  /** Create a meeting (org_id + created_by_id stamped server-side, never sent). */
  create(input: MeetingInput): Promise<MeetingRow>;
  /** Update header fields and/or the notes block array (author or Admin at RLS). */
  update(id: string, patch: MeetingPatch): Promise<void>;
  /** Soft-archive (stamps archived_at, ADR-0018). */
  archive(id: string): Promise<void>;
  /** Hard-delete (Admin-only at RLS); rejects 23503 while tasks reference the meeting. */
  delete(id: string): Promise<void>;
  /** A meeting's attendees with profile/contact identity. */
  listAttendees(meetingId: string): Promise<MeetingAttendeeWithRefs[]>;
  /** Add an attendee (exactly one of profile/contact/display_name — the table CHECK). */
  addAttendee(meetingId: string, identity: MeetingAttendeeInput): Promise<MeetingAttendeeRow>;
  /** Remove an attendee row. */
  removeAttendee(id: string): Promise<void>;
  /** A meeting's view grants (both profile embeds constraint-qualified). */
  listGrants(meetingId: string): Promise<MeetingGrantWithRefs[]>;
  /** Grant a named user view access (audit-logged server-side). */
  addGrant(meetingId: string, userId: string): Promise<MeetingGrantRow>;
  /** Revoke a grant (granter, author, or Admin; audit-logged server-side). */
  revokeGrant(id: string): Promise<void>;
}
