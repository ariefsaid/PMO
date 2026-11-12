/** Meeting repository contract (#526, migrations 0205/0206). */
import type {
  MeetingRow,
  MeetingWithRefs,
  MeetingInput,
  MeetingPatch,
  MeetingListParams,
  MeetingListPage,
  ContactMeetingPage,
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
  /** Visible meetings, newest-first; optional project filter + notes/title search. */
  list(params?: MeetingListParams): Promise<MeetingListPage>;
  /** One explicit page of visible meetings; `hasMore` signals whether another page exists. */
  listPage(params: MeetingListParams | undefined, offset: number): Promise<MeetingListPage>;
  /** Exact RLS-scoped count for the same project/archive/search filters as the index. */
  count(params?: MeetingListParams): Promise<number | undefined>;
  /** One bounded page of meetings a contact attended (DD-MTG-6 timeline). */
  listForContact(contactId: string, offset: number): Promise<ContactMeetingPage>;
  /** A single meeting by id, or null when not found / not readable (attendance-scoped). */
  get(id: string): Promise<MeetingWithRefs | null>;
  /** Create a meeting (org_id + created_by_id stamped server-side, never sent). */
  create(input: MeetingInput): Promise<MeetingRow>;
  /** Update header fields and/or the notes block array (author or Admin at RLS). */
  update(id: string, patch: MeetingPatch): Promise<void>;
  /** Soft-archive (stamps archived_at, ADR-0018). */
  archive(id: string): Promise<void>;
  /** Restore an archived meeting; the database applies the same author/Admin rule as archive. */
  restore(id: string): Promise<void>;
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
