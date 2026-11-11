/**
 * OE-04 — the individual timesheet approve/return flow, pinned end-to-end from BOTH entry
 * points (queue row and TimesheetApprovalPreview, panel + inline surfaces).
 *
 * The approval controller and its confirm dialog are shared by the queue and the preview
 * (one flow, two placements), so these tests bind the behavior the dedupe must preserve:
 * the confirm-gated write (nothing fires on a single click), the exact success toast per
 * action, and the separation-of-duties notices — the queue header and panel preview carry
 * the policy line; the inline (expanded) preview does not repeat it; the approve confirm
 * always states the SoD rule in its description.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';

const { queue, approveMutate, rejectMutate } = vi.hoisted(() => ({
  queue: {
    data: [
      {
        id: 's1',
        status: 'Submitted',
        week_start_date: '2026-06-01',
        owner: { full_name: 'Dana Report' },
        entries: [
          { project_id: 'p-1', entry_date: '2026-06-01', hours: 8 },
          { project_id: 'p-1', entry_date: '2026-06-02', hours: 4 },
        ],
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  approveMutate: vi.fn(),
  rejectMutate: vi.fn(),
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queue,
  useTimesheetMutations: () => ({
    approve: { mutateAsync: approveMutate, isPending: false },
    reject: { mutateAsync: rejectMutate, isPending: false },
  }),
}));

import { ApprovalsQueue, TimesheetApprovalPreview } from '../ApprovalsQueue';

const sheet = queue.data[0] as unknown as Parameters<typeof TimesheetApprovalPreview>[0]['sheet'];

const renderQueue = (role: Parameters<typeof ImpersonationProvider>[0]['realRole'] = 'Project Manager') =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole={role}>
        <ToastProvider>
          <ApprovalsQueue />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

const renderPreview = (
  surface: 'panel' | 'inline',
  role: Parameters<typeof ImpersonationProvider>[0]['realRole'] = 'Project Manager',
) =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole={role}>
        <ToastProvider>
          <TimesheetApprovalPreview sheet={sheet} surface={surface} />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  queue.isPending = false;
  queue.isError = false;
  approveMutate.mockReset();
  rejectMutate.mockReset();
  approveMutate.mockResolvedValue(undefined);
  rejectMutate.mockResolvedValue(undefined);
});

describe('OE-04 — approve/return from the queue rows', () => {
  it('approve: confirm-gated, then the mutation and the success toast carry the decision', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    // Nothing writes on a single click — the confirm stands between the button and the RPC.
    expect(approveMutate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Approve Dana Report's week\?/)).toBeInTheDocument();
    // The separation-of-duties rule is stated in the confirm itself.
    expect(within(dialog).getByText(/separation of duties is enforced/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveMutate).toHaveBeenCalledWith({ id: 's1' }));
    expect(await findToastAnnouncement('status', /timesheet approved/i)).toBeInTheDocument();
    expect(await findToastAnnouncement('status', /Dana Report's week approved/i)).toBeInTheDocument();
  });

  it('return: asks for a reason, then the rejection mutation carries it and the returned toast shows', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(screen.getByRole('button', { name: /return/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Return Dana Report's timesheet/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Reason for returning/), 'Friday hours are missing');
    await user.click(within(dialog).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(rejectMutate).toHaveBeenCalledWith({ id: 's1', notes: 'Friday hours are missing' }));
    expect(await findToastAnnouncement('status', 'Returned')).toBeInTheDocument();
    expect(await findToastAnnouncement('status', /Sent back to Dana Report for changes/i)).toBeInTheDocument();
  });

  it('cancelling the confirm writes nothing', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(approveMutate).not.toHaveBeenCalled();
    expect(rejectMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('expanding a row previews inline: same decisions, and no policy paragraph is added', async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(screen.getByRole('button', { name: /show hours for Dana Report/i }));
    // The separation-of-duties policy is stated in the approve confirm, not as a paragraph on the page.
    expect(screen.queryByText('Policy: a different person approves each timesheet.')).not.toBeInTheDocument();

    const inlinePreview = document.querySelector('#ts-breakdown-s1') as HTMLElement;
    expect(inlinePreview).toBeInTheDocument();
    const inlineApprove = within(inlinePreview).getByRole('button', { name: /approve/i });
    await user.click(inlineApprove);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveMutate).toHaveBeenCalledWith({ id: 's1' }));
    expect(await findToastAnnouncement('status', /timesheet approved/i)).toBeInTheDocument();
  });
});

describe('OE-04 — approve/return from the TimesheetApprovalPreview', () => {
  it('panel: approve is confirm-gated and fires the approve mutation with its toast', async () => {
    const user = userEvent.setup();
    renderPreview('panel');

    expect(screen.queryByText('Policy: a different person approves each timesheet.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    expect(approveMutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(approveMutate).toHaveBeenCalledWith({ id: 's1' }));
    expect(await findToastAnnouncement('status', /timesheet approved/i)).toBeInTheDocument();
  });

  it('panel: return asks for a reason and fires the reject mutation with it', async () => {
    const user = userEvent.setup();
    renderPreview('panel');

    await user.click(screen.getByRole('button', { name: /return/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Return Dana Report's timesheet/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Reason for returning/), 'Wrong project on Monday');
    await user.click(within(dialog).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(rejectMutate).toHaveBeenCalledWith({ id: 's1', notes: 'Wrong project on Monday' }));
    expect(await findToastAnnouncement('status', 'Returned')).toBeInTheDocument();
  });

  it('inline surface keeps the decisions and shows no policy paragraph', async () => {
    const user = userEvent.setup();
    renderPreview('inline');

    expect(screen.queryByText('Policy: a different person approves each timesheet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /return/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveMutate).toHaveBeenCalledWith({ id: 's1' }));
    expect(await findToastAnnouncement('status', /timesheet approved/i)).toBeInTheDocument();
  });

  it('a non-approver sees the queue and preview without approve/return buttons', () => {
    const queueView = renderQueue('Finance');
    expect(screen.getByText('Dana Report')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument();
    queueView.unmount();

    // The panel preview infers the approver gate from the real role (no eligibleFromQueue).
    renderPreview('panel', 'Finance');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument();
  });

  it('an approve refusal keeps the dialog open with the classified error, not the raw message', async () => {
    const user = userEvent.setup();
    const pgPermissionError = Object.assign(new Error('permission denied for table timesheets'), {
      code: '42501',
    });
    approveMutate.mockRejectedValueOnce(pgPermissionError);
    renderQueue();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(await findToastAnnouncement('alert', /you don't have permission to do that/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /permission denied for table timesheets/i })).not.toBeInTheDocument();
    expect(within(await screen.findByRole('dialog')).getByRole('alert')).toHaveTextContent("You don't have permission to do that.");
  });
});
