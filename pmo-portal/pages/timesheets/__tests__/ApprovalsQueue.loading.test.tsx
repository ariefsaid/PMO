/**
 * Review fix (T-18 part 2, Important 1) — the decision buttons must show the in-flight state.
 *
 * `useApprovalDecision()` owns the ONE `useTimesheetMutations()` instance; the queue rows and the
 * preview buttons read THAT instance's `isPending` while a decision is in flight. (The regression
 * this guards: the hook and the component each calling `useTimesheetMutations()` creates two
 * independent `useMutation` instances, so `commit()` spun an instance no button could see and the
 * row/preview buttons never showed loading.)
 *
 * This file runs the REAL mutations hook against a mocked repository seam, so the loading state is
 * react-query's own — no mock can accidentally share or hide it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';

const { listAwaitingApproval, approveRepository, pushApproved } = vi.hoisted(() => ({
  listAwaitingApproval: vi.fn(),
  approveRepository: vi.fn(),
  pushApproved: vi.fn(),
}));

vi.mock('@/src/lib/repositories/timesheets', () => ({
  timesheetRepository: {
      listAwaitingApproval,
      listReopenableApproved: vi.fn(),
      submit: vi.fn(),
      approve: approveRepository,
      reject: vi.fn(),
      reopen: vi.fn(),
      attestNoErpDocument: vi.fn(),
      pushApproved,
    },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-mgr', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import { ApprovalsQueue } from '../ApprovalsQueue';

const QUEUE_ROW = [
  {
    id: 's1',
    status: 'Submitted',
    week_start_date: '2026-06-01',
    owner: { full_name: 'Dana Report' },
    entries: [{ project_id: 'p-1', entry_date: '2026-06-01', hours: 8 }],
  },
] as unknown[];

beforeEach(() => {
  listAwaitingApproval.mockReset().mockResolvedValue(QUEUE_ROW);
  approveRepository.mockReset();
  pushApproved.mockReset().mockResolvedValue(undefined);
});

const renderQueue = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider>
            <ApprovalsQueue />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('OE-04 decision loading state (shared mutation instance)', () => {
  it('the queue row approve button shows loading while the approval is in flight', async () => {
    const user = userEvent.setup();
    // The approval hangs until the test resolves it — a genuine in-flight window.
    let resolveApprove!: () => void;
    approveRepository.mockImplementation(
      () => new Promise<void>((resolve) => { resolveApprove = resolve; }),
    );
    renderQueue();
    expect(await screen.findByText('Dana Report')).toBeInTheDocument();

    const row = document.querySelector('[data-week-start="2026-06-01"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /approve/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    expect(approveRepository).toHaveBeenCalledWith('s1', undefined);
    // THE assertion: the row button reads the committing instance's isPending — busy while the
    // repository call is unresolved.
    const rowApprove = within(row).getByRole('button', { name: /approve/i });
    await waitFor(() => expect(rowApprove).toHaveAttribute('aria-busy', 'true'));
    expect(rowApprove).toBeDisabled();

    resolveApprove();
    expect(await findToastAnnouncement('status', /timesheet approved/i)).toBeInTheDocument();
    await waitFor(() => expect(rowApprove).not.toHaveAttribute('aria-busy'));
  });
});
