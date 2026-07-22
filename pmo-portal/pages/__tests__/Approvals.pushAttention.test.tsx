/**
 * ⚑ NEW-2 (rendered re-verification, 2026-07-22) — the ERP-push attention queue's RETRY FEEDBACK.
 *
 * The I-13 fix correctly gave the timesheet Retry a voice: a silent retry is indistinguishable from a
 * dead button. But it gave it the WRONG voice — `classifyMutationError` passes the server's message
 * through verbatim, so the toast read:
 *
 *     "That timesheet could not be pushed — timesheet-not-approved (status Submitted)"
 *
 * `pushErrorCopy.ts` exists precisely to stop an adapter's internal vocabulary reaching an operator,
 * its own tests assert against `RAW_ADAPTER_TOKEN`, and the badge path two lines away obeys it. The
 * live-mutation path was simply never routed through it. So the rule is asserted HERE the way it is
 * asserted there — as a REGEX over everything the surface rendered, not as a match on the one token
 * this round happened to find, so a fifth path cannot regress it quietly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { RAW_ADAPTER_TOKEN } from '@/src/lib/adapterSeam/pushErrorCopy';

const { retryMutate } = vi.hoisted(() => ({ retryMutate: vi.fn() }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useTimesheetMutations: () => ({
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  usePushesNeedingAttention: () => ({
    data: [
      {
        timesheet_id: 'ts-1',
        owner_name: 'Tomas Beck',
        week_start_date: '2026-07-13',
        push_state: 'failed',
        // A transport failure is what the mirror recorded — the row therefore legitimately offers a
        // Retry. The refusal below only becomes knowable when the server answers.
        push_error: 'external-unreachable',
        ts_number: null,
        approved_by: 'someone-else',
      },
    ],
    isPending: false,
    isError: false,
    retry: { mutate: retryMutate, isPending: false },
  }),
  useEmployeeLinkConfirm: () => ({
    links: { data: [], isPending: false, isError: false },
    confirm: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' }, role: 'Admin' }),
}));

vi.mock('@/src/auth/impersonation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/auth/impersonation')>();
  return { ...actual, useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) };
});

import ApprovalsPage from '../Approvals';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/approvals']}>
      <ImpersonationProvider realRole="Admin">
        <ToastProvider>
          <ApprovalsPage />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

/** Drives the retry and fails it with `message`, the way the server really answers. */
const failRetryWith = (message: string) => {
  retryMutate.mockImplementation((_vars: unknown, opts: { onError?: (e: unknown) => void; onSettled?: () => void }) => {
    opts.onError?.(new Error(message));
    opts.onSettled?.();
  });
};

beforeEach(() => {
  retryMutate.mockReset();
});

describe('Approvals — the ERP push retry never speaks the adapter\'s vocabulary (NEW-2)', () => {
  it.each([
    'timesheet-not-approved (status Submitted)',
    'employee-unlinked: no erp_employees row for the owner',
    'activity-type-unconfigured: binding config has no default_activity_type',
    // A brand-new code nobody has classified yet must ALSO not leak — the failure mode this regex
    // exists for is precisely the code that gets added to a writer and forgotten here.
    'some-future-adapter-code: internals',
  ])('NEW-2 a retry that fails with "%s" puts no raw adapter token in the DOM', async (message) => {
    const user = userEvent.setup();
    failRetryWith(message);
    const { container } = renderPage();

    await user.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText(/could not be pushed/i)).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(RAW_ADAPTER_TOKEN);
  });

  it('NEW-2 it still says something USEFUL — a classified reason, not merely a scrubbed blank', async () => {
    const user = userEvent.setup();
    failRetryWith('timesheet-not-approved (status Submitted)');
    renderPage();

    await user.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByText(/only an APPROVED timesheet|not approved/i)).toBeInTheDocument();
  });

  it('NEW-2 a transport failure is still reported as transport, not as something to fix on this screen', async () => {
    const user = userEvent.setup();
    failRetryWith('external-unreachable: fetch failed');
    renderPage();

    await user.click(await screen.findByRole('button', { name: /retry/i }));
    // The badge already said it about the PERSISTED state; the toast must now say it about THIS
    // attempt — two statements of the same honest cause, not one plus a leaked token.
    await waitFor(() => expect(screen.getAllByText(/could not be reached/i).length).toBeGreaterThan(1));
  });
});
