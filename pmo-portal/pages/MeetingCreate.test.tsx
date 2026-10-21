import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const { mutations, permission } = vi.hoisted(() => ({
  permission: { allowed: true },
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
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour Upgrade' }] }) }));
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
  Object.values(mutations).forEach((mutation) => { mutation.mutateAsync.mockReset().mockResolvedValue(undefined); mutation.isPending = false; });
  mutations.create.mutateAsync.mockResolvedValue({ id: 'meeting-new' });
  permission.allowed = true;
});

describe('AC-MTG1-001 one-page meeting creation', () => {
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
    await user.click(screen.getByRole('button', { name: /Add guest/i }));
    await user.click(screen.getByRole('button', { name: 'Save meeting' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/meetings/meeting-new'));
    expect(mutations.create.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: 'Design review' }));
    expect(mutations.addAttendee.mutateAsync).toHaveBeenCalledWith({ meetingId: 'meeting-new', identity: { display_name: 'Guest One' } });
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'meeting-new', patch: { notes: expect.any(Array) } }));
  });

  it('AC-MTG1-003 a pristine editor baseline can be left without a discard dialog', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('link', { name: 'Meetings' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  it('AC-MTG1-002 keeps meeting editors disabled while attendee writes are pending', async () => {
    let resolveAttendee!: (value: unknown) => void;
    mutations.addAttendee.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { resolveAttendee = resolve; }));
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Title/), 'Design review');
    await user.type(screen.getByLabelText(/External guest/), 'Guest One');
    await user.click(screen.getByRole('button', { name: /Add guest/i }));
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
    await user.click(screen.getByRole('button', { name: /Add guest/i }));
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
    await user.click(screen.getByRole('button', { name: /Add guest/i }));
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
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave' }));
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
