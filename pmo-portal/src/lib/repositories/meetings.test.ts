import { describe, vi } from 'vitest';
import * as dal from '@/src/lib/db/meetings';
import { meetingRepository } from './meetings';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/meetings');

describe('meetingRepository', () => {
  itDelegates(meetingRepository as never, dal, [
    ['list', 'listMeetings', [{ projectId: 'p1' }]],
    ['listForContact', 'listMeetingsForContact', ['c1']],
    ['get', 'getMeeting', ['m1']],
    ['create', 'createMeeting', [{ title: 'Kickoff' }]],
    ['update', 'updateMeeting', ['m1', { title: 'New' }]],
    ['archive', 'archiveMeeting', ['m1']],
    ['delete', 'deleteMeeting', ['m1']],
    ['listAttendees', 'listMeetingAttendees', ['m1']],
    ['addAttendee', 'addMeetingAttendee', ['m1', { contactId: 'c1' }]],
    ['removeAttendee', 'removeMeetingAttendee', ['a1']],
    ['listGrants', 'listMeetingGrants', ['m1']],
    ['addGrant', 'addMeetingGrant', ['m1', 'u1']],
    ['revokeGrant', 'revokeMeetingGrant', ['g1']],
  ]);
});
