import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const { mutations, permission, projectsState } = vi.hoisted(() => ({
  permission: { allowed: true },
  /** The picker read's rows, in whatever order the reader returns them (C18 order is the page's). */
  projectsState: {
    data: [] as Array<{ id: string; name: string; short_name?: string | null }>,
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    addAttendee: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    removeAttendee: { mutateAsync: vi.fn(), isPending: false },
    addGrant: { mutateAsync: vi.fn(), isPending: false },
    revokeGrant: { mutateAsync: vi.fn(), isPending: false },
    createActionItem: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useMeetings', () => ({ useMeetingMutations: () => mutations }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permission.allowed }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: projectsState.data }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { profile: { listOrgProfiles: vi.fn().mockResolvedValue([{ id: 'u2', full_name: 'Sam Member' }]) } } }));
vi.mock('@/src/components/meetings/MinutesEditor', async () => {
  const React = await import('react');
  const liveDocument: never[] = [];
  const EditorStub = React.forwardRef(({ onReady, onChange, editable }: { onReady: (blocks: never[]) => void; onChange: (blocks: never[]) => void; editable: boolean }, ref: React.Ref<{ getDocument: () => never[]; insertActionItem: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ getDocument: () => liveDocument, insertActionItem: () => undefined }), []);
    React.useEffect(() => {
      liveDocument.splice(0, liveDocument.length, { type: 'paragraph', children: [], content: [] } as never);
      onReady([...liveDocument]);
    }, [onReady]);
    return <><button type="button" disabled={!editable} onClick={() => { liveDocument.splice(0, liveDocument.length, { type: 'paragraph', children: [], content: [{ text: 'Minutes text' }] } as never); onChange([...liveDocument]); }}>Edit minutes</button><button type="button" disabled={!editable} onClick={() => liveDocument.splice(0, liveDocument.length, { type: 'paragraph', children: [], content: [{ text: 'Pending minutes' }] } as never)}>Edit pending minutes</button></>;
  });
  return { default: EditorStub };
});

import MeetingCreate from './MeetingCreate';

const Probe = () => {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
};
const renderPage = (path = '/meetings/new') => render(<ToastProvider><MemoryRouter initialEntries={[path]}><Probe /><Link to="/meetings">Meetings</Link><MeetingCreate /></MemoryRouter></ToastProvider>);

beforeEach(() => {
  projectsState.data = [{ id: 'p1', name: 'Harbour Upgrade', short_name: 'North Terminal' }];
  Object.values(mutations).forEach((mutation) => { mutation.mutateAsync.mockReset().mockResolvedValue(undefined); mutation.isPending = false; });
  mutations.create.mutateAsync.mockResolvedValue({ id: 'meeting-new' });
  permission.allowed = true;
});

describe('AC-MTG1-001 one-page meeting creation', () => {
  it('AC-002 #1325: new meeting project option shows the short name only on its stable UUID', () => {
    renderPage();
    expect(screen.getByRole('option', { name: 'North Terminal' })).toHaveValue('p1');
  });

  it('C18 #1325: the new-meeting project select lists projects by the name a person reads, not the picker UUID order', () => {
    projectsState.data = [
      { id: '90000000-0000-4000-8000-000000000001', name: 'Zulu Refinery Upgrade', short_name: null },
      { id: '10000000-0000-4000-8000-000000000002', name: 'Legal Title', short_name: 'Arun Terminal' },
    ];
    renderPage();
    const select = screen.getByLabelText('Project', { selector: 'select' });
    expect([...select.querySelectorAll('option')].slice(1).map((option) => option.textContent)).toEqual([
      'Arun Terminal',
      'Zulu Refinery Upgrade',
    ]);
  });

  it('AC-MTG1-001: shows inline header, minutes and attendees, but no saved-only sections', () => {
    renderPage();
    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    expect(screen.getByLabelText(/When/)).toBeInTheDocument();
    expect(screen.getByText('Minutes')).toBeInTheDocument();
    expect(screen.getByText('Attendees')).toBeInTheDocument();
    expect(screen.queryByText('Action items')).not.toBeInTheDocument();
    expect(screen.queryByText('Sharing')).not.toBeInTheDocument();
  });

  it('AC-MTG1-002: saves the meeting, attendees and minutes, then replaces the route', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.click(screen.getByRole('button', { name: 'Edit minutes' }));
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.create.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: 'Design review' }));
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledWith({ meetingId: 'meeting-new', identity: { display_name: 'Guest One' } });
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'meeting-new', patch: { notes: expect.any(Array) } }));
  });

  it('AC-MTG1-003 a pristine editor baseline can be left without a discard dialog', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Meetings' }));
    // The unsaved-changes confirm is a destructive ConfirmDialog → role="alertdialog".
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/meetings');
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-MTG1-004: requires a title inline and creates nothing when left blank', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting' }));
    expect(await screen.findByText('Meeting title is required.')).toBeInTheDocument();
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-MTG1-002 saves the editor document even before its change notification arrives', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.click(screen.getByRole('button', { name: 'Edit pending minutes' }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      patch: { notes: expect.arrayContaining([expect.objectContaining({ content: [{ text: 'Pending minutes' }] })]) },
    }));
  });

  it('saves a typed guest when the meeting form is submitted', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledWith({
      meetingId: 'meeting-new',
      identity: { display_name: 'Guest One' },
    });
  });

  it('C10 MeetingCreate.tsx:155: prevents adding the same guest twice', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    const guest = screen.getByLabelText(/External guest/);
    await user.type(guest, 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(guest, ' guest one ');

    expect(screen.getByText('This guest is already on the list.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getAllByText(/Guest One/i)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledWith({
      meetingId: 'meeting-new',
      identity: { display_name: 'Guest One' },
    });
  });

  it('retains a typed-but-not-added guest after failure and retries it once on the same meeting', async () => {
    mutations.addAttendee.mutateAsync.mockRejectedValueOnce(new Error('attendee write failed'));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));

    expect(await screen.findByText(/some details were not saved/i)).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('path')).toHaveTextContent('/meetings/new');
    expect(screen.getByText('Guest One')).toBeVisible();
    expect(mutations.create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutations.addAttendee.mutateAsync.mock.calls[0][0]).toEqual({
      meetingId: 'meeting-new', identity: { display_name: 'Guest One' },
    });
    expect(mutations.addAttendee.mutateAsync.mock.calls[1][0]).toEqual({
      meetingId: 'meeting-new', identity: { display_name: 'Guest One' },
    });
  });

  it('AC-MTG1-002 keeps meeting editors disabled while attendee writes are pending', async () => {
    let resolveAttendee!: (value: unknown) => void;
    mutations.addAttendee.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { resolveAttendee = resolve; }));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(mutations.addAttendee.mutateAsync).toHaveBeenCalled());
    expect(screen.getByLabelText(/Title/)).toBeDisabled();
    expect(screen.getByLabelText(/External guest/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit minutes' })).toBeDisabled();
    resolveAttendee({});
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
  });

  it('AC-MTG1-002: retains failed minutes and attendees, then retries only those parts', async () => {
    mutations.addAttendee.mutateAsync.mockRejectedValueOnce(new Error('attendee write failed'));
    mutations.update.mutateAsync.mockRejectedValueOnce(new Error('minutes write failed'));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.click(screen.getByRole('button', { name: 'Edit minutes' }));
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    expect(await screen.findByText(/some details were not saved/i)).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('path')).toHaveTextContent('/meetings/new');
    expect(screen.getByLabelText(/Title/)).toBeDisabled();
    expect(screen.getByText('Guest One')).toBeVisible();
    expect(mutations.create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.update.mutateAsync).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutations.update.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutations.addAttendee.mutateAsync.mock.calls[1][0]).toEqual({ meetingId: 'meeting-new', identity: { display_name: 'Guest One' } });
    expect(mutations.update.mutateAsync.mock.calls[1][0]).toEqual(expect.objectContaining({ id: 'meeting-new', patch: { notes: expect.any(Array) } }));
    // The typed minutes survive the failed write and are what the retry sends.
    expect(JSON.stringify(mutations.update.mutateAsync.mock.calls[1][0].patch.notes)).toContain('Minutes text');
  });

  it('AC-MTG1-002 retries attendees without re-saving minutes already acknowledged', async () => {
    mutations.addAttendee.mutateAsync.mockRejectedValueOnce(new Error('attendee write failed'));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.click(screen.getByRole('button', { name: 'Edit minutes' }));
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    expect(await screen.findByText(/some details were not saved/i)).toHaveAttribute('role', 'alert');
    expect(mutations.update.mutateAsync).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.update.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it('AC-MTG1-003: leaving with an unsaved draft asks before discarding and creates nothing', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Unsaved meeting');
    await user.click(screen.getByRole('link', { name: 'Meetings' }));
    // Shared UnsavedChangesDialog (F3a, 444d4ce88): destructive tone, keeping the edits is the default.
    expect(await screen.findByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/meetings');
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-MTG1-006: keeps the create permission gate on direct route access', () => {
    permission.allowed = false;
    renderPage();
    expect(screen.getByText('You do not have permission to create meetings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save meeting' })).not.toBeInTheDocument();
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

/**
 * Floor (restructure step 0): every control a person can press, type into or choose on this form
 * keeps working. One test per control, each asserting the action and its outcome — never a class.
 */
describe('floor — the new-meeting controls keep working', () => {
  it('floor 1: the back control opens the meetings list and creates nothing', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Meetings' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/meetings');
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('floor 3: the When field saves the wall-clock time the person typed', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Title/), 'Design review');
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-11-13T09:30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting' }));

    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalled());
    const [payload] = mutations.create.mutateAsync.mock.calls[0] as [{ occurred_at: string }];
    // The suite pins the form's zone to UTC (test/setup.ts), so 09:30 on that day is that instant.
    expect(payload.occurred_at).toBe('2026-11-13T09:30:00.000Z');
  });

  it('floor 4: the Location field is saved with the meeting', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Title/), 'Design review');
    await userEvent.type(screen.getByLabelText('Location'), 'Site office');
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting' }));

    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Design review', location: 'Site office' }),
    ));
  });

  it('floor 5: the Project select saves the chosen project', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Title/), 'Design review');
    await userEvent.selectOptions(screen.getByLabelText('Project', { selector: 'select' }), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Save meeting' }));

    await waitFor(() => expect(mutations.create.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'p1' }),
    ));
  });

  it('floor 9: an organisation member can be added and is written as an attendee', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.click(screen.getByRole('combobox', { name: 'Add attendee' }));
    await user.click(await screen.findByRole('option', { name: 'Sam Member' }));

    const list = screen.getByTestId('attendees-list');
    expect(within(list).getByText('Sam Member')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledWith({
      meetingId: 'meeting-new', identity: { profile_id: 'u2' },
    }));
  });

  it('floor 10: a member can be removed from the list before saving', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.click(screen.getByRole('combobox', { name: 'Add attendee' }));
    await user.click(await screen.findByRole('option', { name: 'Sam Member' }));
    const list = screen.getByTestId('attendees-list');
    await user.click(within(list).getByRole('button', { name: 'Remove attendee' }));
    expect(within(list).queryByText('Sam Member')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.addAttendee.mutateAsync).not.toHaveBeenCalled();
  });

  it('floor 13: an added guest can be removed from the list before saving', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const list = screen.getByTestId('attendees-list');
    await user.click(within(list).getByRole('button', { name: 'Remove attendee' }));
    expect(within(list).queryByText('Guest One')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.addAttendee.mutateAsync).not.toHaveBeenCalled();
  });

  it('floor 15: Keep editing stays on the filled form and writes nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Title/), 'Unsaved meeting');
    await user.click(screen.getByRole('link', { name: 'Meetings' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/meetings/new');
    expect(screen.getByLabelText(/Title/)).toHaveValue('Unsaved meeting');
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

/**
 * Rule 1 (judging move 1): a create form is a plain page title, not a record header — there is no
 * record yet, so no avatar card and no second back beside the breadcrumb.
 */
describe('rule 1 — the create shell', () => {
  it('rule 1: the page carries a plain title, and typing a title does not grow a second header', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'New meeting' })).toBeVisible();

    await userEvent.type(screen.getByLabelText(/Title/), 'Design review');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Design review' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('Design review');
  });

  it('rule 1: the one primary action sits in the shared form footer', () => {
    renderPage();
    const footer = screen.getByTestId('form-footer');
    expect(within(footer).getByRole('button', { name: 'Save meeting' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Save meeting' })).toHaveLength(1);
  });
});
