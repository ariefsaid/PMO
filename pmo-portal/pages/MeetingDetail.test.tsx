import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const { meetingState, attendeesState, grantsState, actionItemsState, mutations, navigateMock, routeTaskWriteMock } =
  vi.hoisted(() => ({
    meetingState: {
      data: null as unknown,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    attendeesState: { data: [] as unknown[], isPending: false, isError: false },
    grantsState: { data: [] as unknown[], isPending: false, isError: false },
    actionItemsState: { data: [] as unknown[], isPending: false, isError: false },
    mutations: {
      create: { mutateAsync: vi.fn(), isPending: false },
      update: { mutateAsync: vi.fn(), isPending: false },
      archive: { mutateAsync: vi.fn(), isPending: false },
      remove: { mutateAsync: vi.fn(), isPending: false },
      addAttendee: { mutateAsync: vi.fn(), isPending: false },
      removeAttendee: { mutateAsync: vi.fn(), isPending: false },
      addGrant: { mutateAsync: vi.fn(), isPending: false },
      revokeGrant: { mutateAsync: vi.fn(), isPending: false },
      createActionItem: { mutateAsync: vi.fn(), isPending: false },
    },
    navigateMock: vi.fn(),
    routeTaskWriteMock: vi.fn(() => 'pmo'),
  }));

vi.mock('@/src/hooks/useMeetings', () => ({
  useMeeting: () => meetingState,
  useMeetingAttendees: () => attendeesState,
  useMeetingGrants: () => grantsState,
  useMeetingActionItems: () => actionItemsState,
  useMeetingMutations: () => mutations,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour Upgrade' }], isPending: false }),
}));

let currentUserId = 'author-1';
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: currentUserId, org_id: 'org-1' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ meetingId: 'm1' }),
  };
});

let realRole: Role = 'Engineer';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  routeTaskWrite: routeTaskWriteMock,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    profile: {
      listOrgProfiles: vi.fn().mockResolvedValue([
        { id: 'author-1', full_name: 'Ari Author' },
        { id: 'peer-1', full_name: 'Putri Peer' },
        { id: 'pm-1', full_name: 'Paula PM' },
      ]),
    },
  },
}));

import MeetingDetail from './MeetingDetail';

const baseMeeting = {
  id: 'm1',
  org_id: 'org-1',
  title: 'Kickoff with Acme',
  occurred_at: '2026-08-20T09:00:00Z',
  location: 'Site office',
  project_id: 'p1',
  project: {
    id: 'p1',
    name: 'Harbour Upgrade',
    project_manager_id: 'pm-1',
    pm: { id: 'pm-1', full_name: 'Paula PM' },
  },
  notes: [
    { type: 'p', text: 'Discussed the pipeline schedule' },
    { type: 'p', text: 'Order the flange samples' },
  ],
  notes_schema_version: 1,
  created_by_id: 'author-1',
  is_template: false,
  archived_at: null,
  created_at: '2026-08-20T09:00:00Z',
  updated_at: '2026-08-20T09:00:00Z',
};

const renderPage = (role: Role = 'Engineer') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/meetings/m1']}>
        <MeetingDetail />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  meetingState.data = { ...baseMeeting };
  meetingState.isPending = false;
  meetingState.isError = false;
  attendeesState.data = [];
  grantsState.data = [];
  actionItemsState.data = [];
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  navigateMock.mockClear();
  routeTaskWriteMock.mockReset();
  routeTaskWriteMock.mockReturnValue('pmo');
  currentUserId = 'author-1';
  realRole = 'Engineer';
});

describe('MeetingDetail — author editing (OD-MTG-1: an Engineer author minutes their own meeting)', () => {
  it('the AUTHOR sees the minutes editor with their lines and a Save affordance', () => {
    renderPage('Engineer');
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Discussed the pipeline schedule')).toBeInTheDocument();
    expect(screen.getByTestId('minutes-save')).toBeInTheDocument();
  });

  it('Save persists the edited block array through the repository (never notes_text)', async () => {
    renderPage('Engineer');
    const line = screen.getByDisplayValue('Order the flange samples');
    await userEvent.type(line, ' by Friday');
    await userEvent.click(screen.getByTestId('minutes-save'));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const call = mutations.update.mutateAsync.mock.calls[0][0];
    expect(call.id).toBe('m1');
    expect(call.patch.notes).toEqual([
      { type: 'p', text: 'Discussed the pipeline schedule' },
      { type: 'p', text: 'Order the flange samples by Friday' },
    ]);
  });

  // DD-MTG-8: /action is an INFORMED authoring act — the modal, never a silent copy. The task
  // name lands in org-wide `tasks_select`, outside the attendance-keyed read model, so the
  // author must consciously publish exactly the text they choose.
  it('/action opens the task-create modal PREFILLED from the line — no task exists yet (DD-MTG-8)', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByTestId('minute-action-1'));
    const dialog = await screen.findByRole('dialog', { name: /New action item/ });
    expect(within(dialog).getByLabelText(/Task name/)).toHaveValue('Order the flange samples');
    expect(within(dialog).getByTestId('action-modal-project')).toHaveTextContent('Harbour Upgrade');
    // The privacy point: NOTHING was created by merely opening the modal.
    expect(mutations.createActionItem.mutateAsync).not.toHaveBeenCalled();
  });

  it('submitting the modal creates the task with the text the author EDITED, meeting linkage set', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByTestId('minute-action-1'));
    const dialog = await screen.findByRole('dialog', { name: /New action item/ });
    const name = within(dialog).getByLabelText(/Task name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Chase the flange samples (redacted client)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(mutations.createActionItem.mutateAsync).toHaveBeenCalledWith({
        meetingId: 'm1',
        projectId: 'p1',
        name: 'Chase the flange samples (redacted client)',
      }),
    );
  });

  it('an emptied name falls back to the FR-MTG-017 placeholder on save', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByTestId('minute-action-0'));
    const dialog = await screen.findByRole('dialog', { name: /New action item/ });
    await userEvent.clear(within(dialog).getByLabelText(/Task name/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(mutations.createActionItem.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Untitled action' }),
      ),
    );
  });
});

describe('MeetingDetail — non-author read-only (grants are VIEW-ONLY, OD-MTG-2)', () => {
  it('a non-author viewer gets read-only minutes: no editor, no Save, no Edit header action', () => {
    currentUserId = 'peer-1';
    renderPage('Project Manager');
    expect(screen.getByTestId('minutes-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('minutes-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-edit')).not.toBeInTheDocument();
    expect(screen.getByText('Discussed the pipeline schedule')).toBeInTheDocument();
  });

  it('Admin (break-glass) gets the editor on a meeting they did not author', () => {
    currentUserId = 'someone-else';
    renderPage('Admin');
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument();
  });
});

describe('MeetingDetail — the share panel (FR-MTG-032..034)', () => {
  it('⚑ FR-MTG-034: pre-suggests the project PM as a ONE-CLICK add when they lack access', async () => {
    renderPage('Engineer');
    const suggest = screen.getByTestId('share-suggest-pm');
    expect(suggest).toHaveTextContent('Paula PM');
    await userEvent.click(suggest);
    await waitFor(() =>
      expect(mutations.addGrant.mutateAsync).toHaveBeenCalledWith({
        meetingId: 'm1',
        userId: 'pm-1',
      }),
    );
  });

  it('the PM suggestion disappears once the PM already holds a grant (never a duplicate)', () => {
    grantsState.data = [
      {
        id: 'g1',
        meeting_id: 'm1',
        user_id: 'pm-1',
        granted_by: 'author-1',
        granted_at: '2026-08-21T00:00:00Z',
        user: { id: 'pm-1', full_name: 'Paula PM' },
        granter: { id: 'author-1', full_name: 'Ari Author' },
      },
    ];
    renderPage('Engineer');
    expect(screen.queryByTestId('share-suggest-pm')).not.toBeInTheDocument();
  });

  it('the PM suggestion disappears when the PM is already an attendee', () => {
    attendeesState.data = [
      {
        id: 'a1',
        meeting_id: 'm1',
        profile_id: 'pm-1',
        contact_id: null,
        display_name: null,
        profile: { id: 'pm-1', full_name: 'Paula PM' },
        contact: null,
      },
    ];
    renderPage('Engineer');
    expect(screen.queryByTestId('share-suggest-pm')).not.toBeInTheDocument();
  });

  it('a grant row shows the named user and its granter, and the granter can revoke it', async () => {
    currentUserId = 'peer-1'; // the granter, NOT the author
    grantsState.data = [
      {
        id: 'g2',
        meeting_id: 'm1',
        user_id: 'pm-1',
        granted_by: 'peer-1',
        granted_at: '2026-08-21T00:00:00Z',
        user: { id: 'pm-1', full_name: 'Paula PM' },
        granter: { id: 'peer-1', full_name: 'Putri Peer' },
      },
    ];
    renderPage('Finance');
    const list = screen.getByTestId('grants-list');
    expect(within(list).getByText('Paula PM')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('grant-revoke-g2'));
    await waitFor(() => expect(mutations.revokeGrant.mutateAsync).toHaveBeenCalledWith('g2'));
  });
});

describe('MeetingDetail — action items + the external-tasks gate (spec §8.5)', () => {
  it('lists the tasks minuted out of this meeting', () => {
    actionItemsState.data = [
      {
        id: 't1',
        name: 'Order the flange samples',
        status: 'To Do',
        assignee: { id: 'peer-1', full_name: 'Putri Peer' },
        end_date: null,
        dependencies: [],
      },
    ];
    renderPage('Engineer');
    const list = screen.getByTestId('action-items-list');
    expect(within(list).getByText('Order the flange samples')).toBeInTheDocument();
    expect(within(list).getByText('Putri Peer')).toBeInTheDocument();
  });

  it('when the tasks domain is externally owned, /action is disabled WITH an explanation', () => {
    routeTaskWriteMock.mockReturnValue('external');
    renderPage('Engineer');
    expect(screen.getByTestId('minutes-external-gate')).toBeInTheDocument();
    expect(screen.getByTestId('minute-action-0')).toBeDisabled();
  });
});

describe('MeetingDetail — states', () => {
  it('not-found renders the calm empty state (an unshared meeting is null, not an error)', () => {
    meetingState.data = null;
    renderPage('Engineer');
    expect(screen.getByTestId('meeting-not-found')).toBeInTheDocument();
    expect(screen.getByText('Meeting not found')).toBeInTheDocument();
  });

  it('loading renders the skeleton', () => {
    meetingState.isPending = true;
    meetingState.data = null;
    renderPage('Engineer');
    expect(screen.getByTestId('meeting-loading')).toBeInTheDocument();
  });

  it('a query error renders the error state with retry', async () => {
    meetingState.isError = true;
    meetingState.data = null;
    renderPage('Engineer');
    expect(screen.getByText("Couldn't load meeting")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(meetingState.refetch).toHaveBeenCalled();
  });

  it('Admin header carries Archive + Delete; a non-Admin author gets Edit only', () => {
    renderPage('Admin');
    expect(screen.getByTestId('meeting-archive')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-delete')).toBeInTheDocument();
  });

  it('a non-Admin author gets Edit but neither Archive nor Delete', () => {
    renderPage('Engineer');
    expect(screen.getByTestId('meeting-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-archive')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-delete')).not.toBeInTheDocument();
  });
});
