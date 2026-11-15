import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/src/components/ui';
import type { MeetingAttendeeWithRefs, MeetingGrantWithRefs } from '@/src/lib/repositories';

const h = vi.hoisted(() => ({ revoke: vi.fn(), add: vi.fn(), may: vi.fn(() => true) }));
vi.mock('@/src/hooks/useMeetings', () => ({
  useMeetingMutations: () => ({
    addGrant: { mutateAsync: h.add },
    revokeGrant: { mutateAsync: h.revoke },
  }),
}));
vi.mock('@/src/hooks/useOrgProfilesLoader', () => ({ useOrgProfilesLoader: () => async () => [] }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));

import MeetingSharing from './MeetingSharing';

const attendees = [{
  id: 'attendee-1', meeting_id: 'meeting-1', profile_id: 'profile-1', contact_id: null,
  display_name: null, created_at: '2026-11-01T00:00:00Z',
  profile: { id: 'profile-1', full_name: 'Meeting attendee' }, contact: null,
}] as MeetingAttendeeWithRefs[];

const grants = [{
  id: 'grant-1', meeting_id: 'meeting-1', user_id: 'u2', granted_by: 'u9', created_at: '2026-11-01T00:00:00Z',
  user: { id: 'u2', full_name: 'Grant Recipient' }, granter: { id: 'u9', full_name: 'Sharer' },
}] as unknown as MeetingGrantWithRefs[];

function renderSharing() {
  return render(
    <ToastProvider>
      <MeetingSharing
        meetingId="meeting-1"
        meetingAuthorId="u1"
        currentUserId="u1"
        projectManager={null}
        attendeesQuery={{ data: attendees, isPending: false, isError: false }}
        grantsQuery={{ data: grants, isPending: false, isError: false, refetch: vi.fn() }}
        onError={vi.fn()}
      />
    </ToastProvider>,
  );
}

describe('MeetingSharing', () => {
  beforeEach(() => {
    h.revoke.mockReset().mockResolvedValue(undefined);
    h.add.mockReset().mockResolvedValue(undefined);
    h.may.mockReturnValue(true);
  });

  it('a11y(#2085) each Revoke names the person whose access it removes', () => {
    renderSharing();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke — Grant Recipient' }));
  });

  it('floor: the named Revoke still revokes the grant', () => {
    renderSharing();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke — Grant Recipient' }));
    // Revoke writes only after the confirm dialog (#2083).
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    expect(h.revoke).toHaveBeenCalledWith('grant-1');
  });
});
