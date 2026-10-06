import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { Breadcrumb } from '@/src/components/shell/Breadcrumb';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const { meetingState, attendeesState, grantsState, actionItemsState, mutations, routeTaskWriteMock } =
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

// list-working-set-return (#683): BackBar/archive/delete now navigate via the real router
// (useListReturn), so `useNavigate` stays UNMOCKED — only `useParams` is pinned, since these
// tests render MeetingDetail directly rather than through a matched `/meetings/:meetingId` route.
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
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


// #805: the real BlockNote editor is a lazy chunk exercised by its own tests + e2e. Here a stub honours
// the same contract (onReady baseline, onChange, /action request, imperative insertActionItem) so
// the page's save / modal / gate wiring is what is under test.
const { insertActionItem } = vi.hoisted(() => ({ insertActionItem: vi.fn() }));
vi.mock('@/src/components/meetings/MinutesEditor', async () => {
  const React = await import('react');
  type Block = { content?: Array<{ text?: string }>; children: unknown[]; type: string };
  const Stub = React.forwardRef<
    { insertActionItem: (id: string) => void },
    {
      initialBlocks: Block[];
      editable: boolean;
      tasksExternal: boolean;
      onReady: (b: Block[]) => void;
      onChange: (b: Block[]) => void;
      onRequestAction: (line: string) => void;
    }
  >(function Stub({ initialBlocks, editable, tasksExternal, onReady, onChange, onRequestAction }, ref) {
    React.useImperativeHandle(ref, () => ({ insertActionItem }), []);
    React.useEffect(() => onReady(initialBlocks), []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <div data-testid="stub-editor" data-editable={String(editable)} data-tasks-external={String(tasksExternal)}>
        {initialBlocks.map((b, i) => (
          <p key={i}>{(b.content ?? []).map((r) => r.text).join('')}</p>
        ))}
        {editable && (
          <button
            type="button"
            data-testid="stub-type"
            onClick={() =>
              onChange([
                ...initialBlocks,
                { type: 'paragraph', content: [{ text: 'by Friday' }], children: [] },
              ])
            }
          >
            type
          </button>
        )}
        {editable && !tasksExternal && (
          <button
            type="button"
            data-testid="stub-action"
            onClick={() => onRequestAction('Order the flange samples')}
          >
            /action
          </button>
        )}
      </div>
    );
  });
  return { default: Stub };
});

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

// list-working-set-return (#683): reads the URL a Meetings-index Route landed on, for the
// AC-LRC-008 return-context tests below (a plain <MeetingDetail /> above has no Routes to land
// anywhere, so those tests route it properly instead).
const MeetingsIndexProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="meetings-index-probe">Meetings index{location.search}</div>;
};

const renderRouted = (initialEntry: string | { pathname: string; state?: unknown }, role: Role = 'Engineer') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/meetings/:meetingId" element={<MeetingDetail />} />
          <Route path="/meetings" element={<MeetingsIndexProbe />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

const MeetingDetailWithBreadcrumb: React.FC = () => {
  const navigate = useNavigate();
  return (
    <>
      <Breadcrumb
        parts={[
          { label: 'Meetings', href: '/meetings', onClick: () => navigate('/meetings') },
          { label: 'Kickoff with Acme' },
        ]}
      />
      <MeetingDetail />
    </>
  );
};

const renderRoutedWithBreadcrumb = (role: Role = 'Engineer') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/meetings/m1']}>
        <Routes>
          <Route path="/meetings/:meetingId" element={<MeetingDetailWithBreadcrumb />} />
          <Route path="/meetings" element={<MeetingsIndexProbe />} />
        </Routes>
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
  routeTaskWriteMock.mockReset();
  routeTaskWriteMock.mockReturnValue('pmo');
  currentUserId = 'author-1';
  realRole = 'Engineer';
});

describe('MeetingDetail — unsaved minutes navigation guard', () => {
  it('AC-MTG-301: pristine minutes breadcrumb reaches Meetings without a dialog', async () => {
    renderRoutedWithBreadcrumb();
    expect(await screen.findByTestId('stub-editor', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByTestId('minutes-save')).toBeDisabled();

    await userEvent.click(screen.getByRole('link', { name: 'Meetings' }));

    expect(await screen.findByTestId('meetings-index-probe')).toHaveTextContent('Meetings index');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('AC-MTG-302: beforeunload is armed only while Save minutes is enabled', async () => {
    renderPage('Engineer');
    await screen.findByTestId('stub-editor', {}, { timeout: 10_000 });

    const pristineEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pristineEvent);
    expect(pristineEvent.defaultPrevented).toBe(false);

    await userEvent.click(screen.getByTestId('stub-type'));
    expect(screen.getByTestId('minutes-save')).toBeEnabled();
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBe(false);

    await userEvent.click(screen.getByTestId('minutes-save'));
    await waitFor(() => expect(screen.getByTestId('minutes-save')).toBeDisabled());
    const savedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savedEvent);
    expect(savedEvent.defaultPrevented).toBe(false);
  });

  it('blocks ordinary same-origin anchor activation while dirty; Stay preserves edits', async () => {
    renderRoutedWithBreadcrumb();
    await screen.findByTestId('stub-editor', {}, { timeout: 10_000 });
    await userEvent.click(screen.getByTestId('stub-type'));

    await userEvent.click(screen.getByRole('link', { name: 'Meetings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved minutes' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));

    expect(screen.queryByRole('dialog', { name: 'Unsaved minutes' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('meetings-index-probe')).not.toBeInTheDocument();
    expect(screen.getByTestId('minutes-save')).toBeEnabled();
  });

  it('the mobile Back to Meetings bar goes through the same guard: dialog while dirty; Leave returns to the captured list context', async () => {
    renderRouted({
      pathname: '/meetings/m1',
      state: {
        pmoListReturn: {
          list: 'meetings',
          path: '/meetings?project=33333333-3333-4333-8333-333333333333',
        },
      },
    });
    await screen.findByTestId('stub-editor', {}, { timeout: 10_000 });
    await userEvent.click(screen.getByTestId('stub-type'));

    await userEvent.click(screen.getByRole('button', { name: /back to meetings/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved minutes' });
    expect(screen.queryByTestId('meetings-index-probe')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByTestId('meetings-index-probe')).toHaveTextContent(
      'Meetings index?project=33333333-3333-4333-8333-333333333333',
    );
    expect(mutations.update.mutateAsync).not.toHaveBeenCalled();
  });

  it('Leave from a breadcrumb runs the crumb\'s own navigation (router state intact)', async () => {
    const CrumbWithState: React.FC = () => {
      const navigate = useNavigate();
      return (
        <>
          <Breadcrumb
            parts={[
              {
                label: 'Meetings',
                href: '/meetings?project=p1',
                onClick: () => navigate('/meetings?project=p1', { state: { restoreScroll: 120 } }),
              },
              { label: 'Kickoff with Acme' },
            ]}
          />
          <MeetingDetail />
        </>
      );
    };
    const StateProbe: React.FC = () => {
      const location = useLocation();
      return <div data-testid="state-probe">{`${location.search}|${JSON.stringify(location.state)}`}</div>;
    };
    realRole = 'Engineer';
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/meetings/m1']}>
          <Routes>
            <Route path="/meetings/:meetingId" element={<CrumbWithState />} />
            <Route path="/meetings" element={<StateProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    await screen.findByTestId('stub-editor', {}, { timeout: 10_000 });
    await userEvent.click(screen.getByTestId('stub-type'));

    await userEvent.click(screen.getByRole('link', { name: 'Meetings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved minutes' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    expect(await screen.findByTestId('state-probe')).toHaveTextContent('?project=p1|{"restoreScroll":120}');
  });

  it('navigates to the captured local destination after Leave without saving minutes', async () => {
    renderRoutedWithBreadcrumb();
    await screen.findByTestId('stub-editor', {}, { timeout: 10_000 });
    await userEvent.click(screen.getByTestId('stub-type'));

    await userEvent.click(screen.getByRole('link', { name: 'Meetings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved minutes' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));

    expect(await screen.findByTestId('meetings-index-probe')).toHaveTextContent('Meetings index');
    expect(mutations.update.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('MeetingDetail — author editing (OD-MTG-1: an Engineer author minutes their own meeting)', () => {
  it('the AUTHOR sees the editable minutes editor — v1 lines upgraded to blocks — and a Save affordance', async () => {
    renderPage('Engineer');
    expect(await screen.findByTestId('stub-editor')).toHaveAttribute('data-editable', 'true');
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument();
    // AC-MTG-201: the v1 lines reach the editor as paragraphs with the same text — no data loss.
    expect(screen.getByText('Discussed the pipeline schedule')).toBeInTheDocument();
    expect(screen.getByText('Order the flange samples')).toBeInTheDocument();
    expect(screen.getByTestId('minutes-save')).toBeInTheDocument();
  });

  it('Save is disabled until the document changes, then persists the BlockNote document through the repository', async () => {
    renderPage('Engineer');
    await screen.findByTestId('stub-editor');
    expect(screen.getByTestId('minutes-save')).toBeDisabled();
    await userEvent.click(screen.getByTestId('stub-type'));
    await userEvent.click(screen.getByTestId('minutes-save'));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const call = mutations.update.mutateAsync.mock.calls[0][0];
    expect(call.id).toBe('m1');
    // v2: the saved array is the editor's blocks (upgraded v1 + the new one) — never notes_text.
    expect(call.patch.notes).toHaveLength(3);
    expect(call.patch.notes[0]).toMatchObject({ type: 'paragraph', content: [{ text: 'Discussed the pipeline schedule' }] });
    expect(call.patch.notes[2]).toMatchObject({ type: 'paragraph', content: [{ text: 'by Friday' }] });
    expect(call.patch).not.toHaveProperty('notes_text');
  });

  // DD-MTG-8: /action is an INFORMED authoring act — the modal, never a silent copy. The task
  // name lands in org-wide `tasks_select`, outside the attendance-keyed read model, so the
  // author must consciously publish exactly the text they choose.
  it('/action opens the task-create modal PREFILLED from the line — no task exists yet (DD-MTG-8)', async () => {
    renderPage('Engineer');
    await userEvent.click(await screen.findByTestId('stub-action'));
    const dialog = await screen.findByRole('dialog', { name: /New action item/ });
    expect(within(dialog).getByLabelText(/Task name/)).toHaveValue('Order the flange samples');
    expect(within(dialog).getByTestId('action-modal-project')).toHaveTextContent('Harbour Upgrade');
    // The privacy point: NOTHING was created by merely opening the modal.
    expect(mutations.createActionItem.mutateAsync).not.toHaveBeenCalled();
    expect(insertActionItem).not.toHaveBeenCalled();
  });

  it('submitting the modal creates the task with the text the author EDITED and inserts a block referencing ONLY its id (DD-MTG-2)', async () => {
    mutations.createActionItem.mutateAsync.mockResolvedValue({ id: 'task-new' });
    renderPage('Engineer');
    await userEvent.click(await screen.findByTestId('stub-action'));
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
    await waitFor(() => expect(insertActionItem).toHaveBeenCalledWith('task-new'));
  });

  it('an emptied name falls back to the FR-MTG-017 placeholder on save', async () => {
    mutations.createActionItem.mutateAsync.mockResolvedValue({ id: 'task-new' });
    renderPage('Engineer');
    await userEvent.click(await screen.findByTestId('stub-action'));
    const dialog = await screen.findByRole('dialog', { name: /New action item/ });
    await userEvent.clear(within(dialog).getByLabelText(/Task name/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(mutations.createActionItem.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Untitled action' }),
      ),
    );
  });

  it('a v2 note (notes_schema_version 2) reaches the editor untouched, not re-upgraded', async () => {
    const v2 = [
      { id: 'a', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Agenda', styles: {} }], children: [] },
    ];
    meetingState.data = { ...baseMeeting, notes: v2, notes_schema_version: 2 };
    renderPage('Engineer');
    expect(await screen.findByText('Agenda')).toBeInTheDocument();
  });
});

describe('MeetingDetail — non-author read-only (grants are VIEW-ONLY, OD-MTG-2)', () => {
  it('a non-author viewer gets read-only minutes: a non-editable editor, no Save, no Edit header action', async () => {
    currentUserId = 'peer-1';
    renderPage('Project Manager');
    expect((await screen.findByTestId('stub-editor'))).toHaveAttribute('data-editable', 'false');
    expect(screen.getByTestId('minutes-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('minutes-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('minutes-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-edit')).not.toBeInTheDocument();
    expect(screen.getByText('Discussed the pipeline schedule')).toBeInTheDocument();
  });

  it('Admin (break-glass) gets the editor on a meeting they did not author', async () => {
    currentUserId = 'someone-else';
    renderPage('Admin');
    expect(await screen.findByTestId('minutes-editor')).toBeInTheDocument();
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

  it('when the tasks domain is externally owned, /action is not offered and the page explains why', async () => {
    routeTaskWriteMock.mockReturnValue('external');
    renderPage('Engineer');
    expect(await screen.findByTestId('stub-editor')).toHaveAttribute('data-tasks-external', 'true');
    expect(screen.getByTestId('minutes-external-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-action')).not.toBeInTheDocument();
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

  it.each([
    ['loading', { isPending: true, isError: false, data: null }],
    ['not-found', { isPending: false, isError: false, data: null }],
    ['error', { isPending: false, isError: true, data: null }],
  ])('#707: the %s state shows the Back bar only at phone width (hidden on desktop)', (_n, s) => {
    Object.assign(meetingState, s);
    renderPage('Engineer');
    const bar = screen.getByRole('button', { name: /^back to /i }).parentElement!;
    expect(bar.className).toContain('hidden');
    expect(bar.className).toContain('max-[920px]:flex');
  });

  it('Admin header carries Archive + Delete', () => {
    renderPage('Admin');
    expect(screen.getByTestId('meeting-archive')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-delete')).toBeInTheDocument();
  });

  it('AC-MTG-029: a non-Admin author gets Edit + Archive but not Delete', () => {
    renderPage('Engineer');
    expect(screen.getByTestId('meeting-edit')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-archive')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-delete')).not.toBeInTheDocument();
  });
});

describe('AC-PLC-005/006 (#684): Edit "When" prefill and submit follow the PROFILE timezone, not the device zone', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    // Simulate a device/browser zone that DIFFERS from the resolved profile timezone (#684's
    // reported scenario: profile Asia/Jakarta, browser America/Los_Angeles).
    process.env.TZ = 'America/Los_Angeles';
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' });
    meetingState.data = { ...baseMeeting, occurred_at: '2026-06-14T14:15:00Z' }; // 21:15 Jakarta, 07:15 LA
  });

  afterEach(() => {
    process.env.TZ = originalTz;
    resetActiveLocale();
  });

  it('prefills "When" with the same wall time the header displays, in the profile timezone', async () => {
    renderPage('Engineer');
    expect(screen.getByText(/09:15\s?PM/i)).toBeInTheDocument(); // header, profile-zone wall time
    await userEvent.click(screen.getByTestId('meeting-edit'));
    const when = screen.getByLabelText(/When/i) as HTMLInputElement;
    expect(when.value).toBe('2026-06-14T21:15');
  });

  it('submitting the unedited default keeps the same instant', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByTestId('meeting-edit'));
    await userEvent.click(screen.getByRole('button', { name: /Save meeting/ }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const call = mutations.update.mutateAsync.mock.calls[0][0];
    expect(call.patch.occurred_at).toBe('2026-06-14T14:15:00.000Z');
  });

  it('editing to 10:00 saves 10:00 in the profile timezone', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByTestId('meeting-edit'));
    const when = screen.getByLabelText(/When/i) as HTMLInputElement;
    // fireEvent-style direct value set + change, mirroring datetime-local input semantics.
    when.focus();
    await userEvent.clear(when);
    await userEvent.type(when, '2026-06-14T10:00');
    await userEvent.click(screen.getByRole('button', { name: /Save meeting/ }));
    await waitFor(() => expect(mutations.update.mutateAsync).toHaveBeenCalled());
    const call = mutations.update.mutateAsync.mock.calls[0][0];
    // 10:00 Asia/Jakarta (UTC+7) is 03:00Z.
    expect(call.patch.occurred_at).toBe('2026-06-14T03:00:00.000Z');
  });

  it('clearing "When" blocks the save with a visible error, and never falls back to the old time', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByTestId('meeting-edit'));
    const when = screen.getByLabelText(/When/i) as HTMLInputElement;
    when.focus();
    await userEvent.clear(when);
    await userEvent.click(screen.getByRole('button', { name: /Save meeting/ }));
    // Shown twice by design: the inline field error and the dialog's error summary banner.
    expect((await screen.findAllByText(/valid date and time/i)).length).toBeGreaterThan(0);
    expect(mutations.update.mutateAsync).not.toHaveBeenCalled();
  });
});

// list-working-set-return (#683, AC-LRC-008): the mobile BackBar honours a validated captured
// Meetings context and falls back to the bare index for a direct/copied link; archive/delete
// success also return to the same filtered context (not a bare reset).
describe('MeetingDetail — list-return context (AC-LRC-008)', () => {
  it('AC-LRC-010: a direct/copied link (no captured context) Back returns to the bare Meetings index', async () => {
    renderRouted('/meetings/m1', 'Admin');
    await userEvent.click(screen.getByRole('button', { name: /back to meetings/i }));
    expect(screen.getByTestId('meetings-index-probe')).toHaveTextContent('Meetings index');
    expect(screen.getByTestId('meetings-index-probe').textContent).toBe('Meetings index');
  });

  it('AC-LRC-008: a record opened from a narrowed Meetings list returns to that SAME filtered URL', async () => {
    renderRouted(
      {
        pathname: '/meetings/m1',
        state: {
          pmoListReturn: {
            list: 'meetings',
            path: '/meetings?project=33333333-3333-4333-8333-333333333333',
          },
        },
      },
      'Admin',
    );
    await userEvent.click(screen.getByRole('button', { name: /back to meetings/i }));
    expect(screen.getByTestId('meetings-index-probe')).toHaveTextContent(
      'Meetings index?project=33333333-3333-4333-8333-333333333333',
    );
  });

  it('AC-LRC-008: archive-success returns to the SAME filtered list context, not a bare reset', async () => {
    renderRouted(
      {
        pathname: '/meetings/m1',
        state: { pmoListReturn: { list: 'meetings', path: '/meetings?q=kickoff' } },
      },
      'Admin',
    );
    await userEvent.click(screen.getByTestId('meeting-archive'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /archive meeting/i }));
    await screen.findByTestId('meetings-index-probe');
    expect(screen.getByTestId('meetings-index-probe')).toHaveTextContent('Meetings index?q=kickoff');
  });

  it('AC-LRC-008: delete-success returns to the SAME filtered list context, not a bare reset', async () => {
    renderRouted(
      {
        pathname: '/meetings/m1',
        state: { pmoListReturn: { list: 'meetings', path: '/meetings?q=kickoff' } },
      },
      'Admin',
    );
    await userEvent.click(screen.getByTestId('meeting-delete'));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete meeting/i }));
    await screen.findByTestId('meetings-index-probe');
    expect(screen.getByTestId('meetings-index-probe')).toHaveTextContent('Meetings index?q=kickoff');
  });
});
