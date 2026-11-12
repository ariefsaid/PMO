/** Meeting repository implementation (#526). */
import {
  listMeetings,
  listMeetingsPage,
  countMeetings,
  listMeetingsForContact,
  getMeeting,
  createMeeting,
  updateMeeting,
  archiveMeeting,
  restoreMeeting,
  deleteMeeting,
  listMeetingAttendees,
  addMeetingAttendee,
  removeMeetingAttendee,
  listMeetingGrants,
  addMeetingGrant,
  revokeMeetingGrant,
} from '@/src/lib/db/meetings';
import { wrap } from './repositoryErrors';
import type { MeetingRepository } from './contracts/meetings';

export const meetingRepository: MeetingRepository = {
  list: (params) => wrap(() => listMeetings(params)),
  listPage: (params, offset) => wrap(() => listMeetingsPage(params, offset)),
  count: (params) => wrap(() => countMeetings(params)),
  listForContact: (contactId, offset) => wrap(() => listMeetingsForContact(contactId, offset)),
  get: (id) => wrap(() => getMeeting(id)),
  create: (input) => wrap(() => createMeeting(input)),
  update: (id, patch) => wrap(() => updateMeeting(id, patch)),
  archive: (id) => wrap(() => archiveMeeting(id)),
  restore: (id) => wrap(() => restoreMeeting(id)),
  delete: (id) => wrap(() => deleteMeeting(id)),
  listAttendees: (meetingId) => wrap(() => listMeetingAttendees(meetingId)),
  addAttendee: (meetingId, identity) => wrap(() => addMeetingAttendee(meetingId, identity)),
  removeAttendee: (id) => wrap(() => removeMeetingAttendee(id)),
  listGrants: (meetingId) => wrap(() => listMeetingGrants(meetingId)),
  addGrant: (meetingId, userId) => wrap(() => addMeetingGrant(meetingId, userId)),
  revokeGrant: (id) => wrap(() => revokeMeetingGrant(id)),
};
