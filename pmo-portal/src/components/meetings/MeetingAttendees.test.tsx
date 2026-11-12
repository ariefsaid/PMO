import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MeetingAttendeeWithRefs } from '@/src/lib/repositories';
import MeetingAttendees from './MeetingAttendees';

const h = vi.hoisted(() => ({ remove: vi.fn(), add: vi.fn() }));
vi.mock('@/src/hooks/useMeetings', () => ({
  useMeetingMutations: () => ({
    addAttendee: { mutateAsync: h.add },
    removeAttendee: { mutateAsync: h.remove },
  }),
}));

const attendees = [{
  id: 'attendee-1', meeting_id: 'meeting-1', profile_id: 'profile-1', contact_id: null,
  display_name: null, added_by: 'owner-1', created_at: '2026-11-01T00:00:00Z',
  profile: { id: 'profile-1', full_name: 'Meeting attendee' }, contact: null,
}] as MeetingAttendeeWithRefs[];

describe('MeetingAttendees', () => {
  beforeEach(() => {
    h.remove.mockReset().mockResolvedValue(undefined);
    h.add.mockReset().mockResolvedValue(undefined);
  });

  it('C2 MeetingAttendees.tsx:100-107 asks before revoking attendee access to the minutes', async () => {
    render(
      <MeetingAttendees
        meetingId="meeting-1"
        canEdit
        attendeesQuery={{ data: attendees, isPending: false, isError: false, refetch: vi.fn() }}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove attendee' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Remove attendee?' });
    expect(dialog).toHaveTextContent('Meeting attendee');
    expect(dialog).toHaveTextContent(/access to this meeting.s minutes/i);
    expect(h.remove).not.toHaveBeenCalled();
  });
});
