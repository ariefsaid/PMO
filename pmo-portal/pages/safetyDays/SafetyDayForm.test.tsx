import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { SafetyDayDetail } from '@/src/lib/db/safetyDays';

/** #2596 `/safety-days/:dayId` — the form's own behaviour: load states, role gating of Submit/Correct,
 * the still-needed parts line, and both write flows. The five parts render for real (their own suites
 * exercise their forms); role gating runs the REAL policy (safetyDay.create/viewPeople). */
const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    query: { data: undefined as SafetyDayDetail | undefined, isPending: false, isError: false, refetch: vi.fn() },
    rosterError: false, retryRoster: vi.fn(), roster: [{ worker_id: 'w1', display_name: 'Budi' }, { worker_id: 'w2', display_name: 'Sari' }] as { worker_id: string; display_name: string }[],
    lists: { check_type: [{ id: 'ct1', label: 'Breathalyser' }], permit_type: [], checklist_item: [] } as Record<string, { id: string; label: string }[]>,
    m: {
      saveFitness: mutation(), deleteFitness: mutation(), answerChecklist: mutation(), saveTalk: mutation(), deleteTalk: mutation(),
      savePermit: mutation(), setPermitState: mutation(), deletePermit: mutation(), addOfficerEntry: mutation(),
      submitDay: mutation(), correctDay: mutation(), uploadTalkPhoto: mutation(),
    },
    role: 'Admin',
    userId: 'u1',
    attendance: [{ worker_id: 'w1', status: 'present' }, { worker_id: 'w2', status: 'present' }] as { worker_id: string; status: string }[],
  };
});
vi.mock('@/src/hooks/useSafetyDays', () => ({
  useSafetyDay: () => h.query,
  useSafetyRoster: () => ({ data: h.roster, isError: h.rosterError, refetch: h.retryRoster }),
  useSafetyList: (kind: string) => ({ data: h.lists[kind] ?? [] }),
  useSafetyMutations: () => h.m,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { id: 'p1', project_manager_id: 'pm1' } }) }));
vi.mock('@/src/hooks/useCrews', () => ({ useAttendanceDay: () => ({ data: h.attendance, isPending: false, isError: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1', role: h.role } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { safetyDay: { photoUrl: vi.fn(async () => 'https://photo') } } }));

import SafetyDayForm from './SafetyDayForm';

const detail = (
  day: Partial<SafetyDayDetail['day']> = {},
  parts: Partial<Pick<SafetyDayDetail, 'fitness' | 'talks' | 'checklist' | 'permits' | 'officer'>> = {},
): SafetyDayDetail => ({
  day: {
    id: 'sd1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', work_date: '2026-03-10',
    status: 'draft', version: 1, supersedes_id: null, correction_reason: null, author_id: 'u1', submitted_at: null, ...day,
  },
  fitness: [], talks: [],
  checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: null, note: null }],
  permits: [], officer: [], ...parts,
});

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const view = () => render(
  <QueryClientProvider client={qc()}>
    <MemoryRouter initialEntries={['/safety-days/sd1']}>
      <ToastProvider>
        <Routes>
          <Route path="/safety-days/:dayId" element={<SafetyDayForm />} />
          <Route path="/safety-days/arrived" element={<div data-testid="corrected-day">corrected day</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { h.rosterError = false;
  h.attendance = [{ worker_id: 'w1', status: 'present' }, { worker_id: 'w2', status: 'present' }];
  act(() => { sonnerToast.dismiss(); }); // Sonner's store replays still-active toasts into the next Toaster — clear them.
  h.role = 'Admin';
  h.query = { data: detail(), isPending: false, isError: false, refetch: vi.fn() };
  Object.values(h.m).forEach((x) => x.mutateAsync.mockReset().mockResolvedValue(undefined));
});

describe('SafetyDayForm', () => {
  it('shows the loading skeleton while the day loads', () => {
    h.query = { ...h.query, data: undefined, isPending: true };
    view();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('shows the error state and refetches on Retry', async () => {
    h.query = { ...h.query, data: undefined, isError: true };
    const user = userEvent.setup();
    view();
    expect(screen.getByText("Couldn't load this safety day")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when the day does not exist', () => {
    h.query = { ...h.query, data: undefined, isPending: false, isError: false };
    view();
    expect(screen.getByText('Safety day not found')).toBeInTheDocument();
  });

  it('offers Submit on a draft to an enterer, with the still-needed parts named', () => {
    view();
    expect(screen.getByTestId('safety-submit')).toHaveTextContent('Submit and lock');
    expect(screen.getByTestId('safety-missing')).toHaveTextContent(/Toolbox talk photo/);
    expect(screen.getByTestId('safety-missing')).toHaveTextContent(/Pre-work checklist/);
    expect(screen.queryByTestId('safety-correct')).not.toBeInTheDocument();
  });

  it('offers Correct on a locked day and no Submit', () => {
    h.query = { ...h.query, data: detail({ status: 'locked' }) };
    view();
    expect(screen.queryByTestId('safety-submit')).not.toBeInTheDocument();
    expect(screen.getByTestId('safety-correct')).toHaveTextContent('Correct');
  });

  it('names the missing parts nothing once the checklist is answered and a photographed talk exists', () => {
    // Both present workers have their fitness check, so no part is missing.
    h.query = { ...h.query, data: detail({}, {
      checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: 'yes', note: null }],
      talks: [{ id: 't1', topic: 'PPE', presenter: 'Budi', held_at: '2026-03-10T01:00:00Z', attendees: [], photos: [{ id: 'p1', file_path: 'a/b.png' }] }],
      fitness: [
        { id: 'f1', worker_id: 'w1', visitor_name: null, check_type_id: null, result: 'fit' as const, note: null },
        { id: 'f2', worker_id: 'w2', visitor_name: null, check_type_id: null, result: 'fit' as const, note: null },
      ],
    }) };
    view();
    expect(screen.queryByTestId('safety-missing')).not.toBeInTheDocument();
  });

  it('a non-enterer sees no Submit even on their own draft', () => {
    h.role = 'Timekeeper';
    view();
    expect(screen.queryByTestId('safety-submit')).not.toBeInTheDocument();
    expect(screen.getByTestId('safety-day-status')).toHaveAttribute('data-status', 'draft');
  });

  it('a non-enterer loses Correct on a locked day too', () => {
    h.role = 'Timekeeper';
    h.query = { ...h.query, data: detail({ status: 'locked' }) };
    view();
    expect(screen.queryByTestId('safety-correct')).not.toBeInTheDocument();
  });

  it('a superseding day shows its version and the correction reason', () => {
    h.query = { ...h.query, data: detail({ version: 2, correction_reason: 'Wrong headcount' }) };
    view();
    expect(screen.getByText(/Version 2/)).toBeInTheDocument();
    expect(screen.getByText(/Correction: Wrong headcount/)).toBeInTheDocument();
  });

  it('#2998 names the fitness gap from the workers present, the same set the lock dialog names', async () => {
    h.attendance = [{ worker_id: 'w1', status: 'present' }]; // Budi on site; Sari rostered but absent
    const user = userEvent.setup();
    view();
    expect(screen.getByTestId('safety-missing')).toHaveTextContent('Fitness check');
    await user.click(screen.getByTestId('safety-submit'));
    expect(await screen.findByTestId('safety-lock-unchecked')).toHaveTextContent('Not yet checked: Budi');
    expect(screen.getByTestId('safety-lock-unchecked')).not.toHaveTextContent('Sari');
  });

  const confirmLock = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByTestId('safety-submit'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit and lock' }));
  };

  it('AC-SD-004 asks before locking, names the rostered workers not yet checked, then submits and confirms', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByTestId('safety-submit'));
    expect(h.m.submitDay.mutateAsync).not.toHaveBeenCalled();
    expect(await screen.findByTestId('safety-lock-unchecked')).toHaveTextContent('Not yet checked: Budi, Sari');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit and lock' }));
    await waitFor(() => expect(h.m.submitDay.mutateAsync).toHaveBeenCalledWith('sd1'));
    expect((await screen.findAllByText('Safety day submitted and locked')).length).toBeGreaterThan(0);
  });

  it('AC-SD-004 a No answer with no note is named before locking, and the lock waits for the note', async () => {
    h.query = { ...h.query, data: detail({}, { checklist: [{ id: 'c1', label: 'Harnesses inspected', position: 1, answer: 'no', note: null }] }) };
    const user = userEvent.setup();
    view();
    await user.click(screen.getByTestId('safety-submit'));
    expect(await screen.findByTestId('safety-lock-note')).toHaveTextContent('Harnesses inspected');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit and lock' })).toBeDisabled();
  });

  it('AC-SD-004 a refused lock says what to fix in the reader\'s language, not the database sentence', async () => {
    h.m.submitDay.mutateAsync.mockRejectedValue(Object.assign(new Error('a checklist item answered no needs a note'), { code: '23514' }));
    const user = userEvent.setup();
    view();
    await confirmLock(user);
    expect(await screen.findByText('A checklist item answered No needs a note. Write the note, then lock again.')).toBeInTheDocument();
    expect(screen.queryByText(/answered no needs a note$/)).not.toBeInTheDocument();
  });

  it('correct starts a new version with the given reason and navigates to it', async () => {
    h.m.correctDay.mutateAsync.mockResolvedValue('arrived');
    h.query = { ...h.query, data: detail({ status: 'locked' }) };
    const user = userEvent.setup();
    view();
    await user.click(screen.getByTestId('safety-correct'));
    await user.type(await screen.findByLabelText(/Reason for the correction/), 'Wrong headcount');
    await user.click(screen.getByRole('button', { name: 'Start correction' }));
    await waitFor(() => expect(h.m.correctDay.mutateAsync).toHaveBeenCalledWith({ id: 'sd1', reason: 'Wrong headcount' }));
    expect(await screen.findByTestId('corrected-day')).toBeInTheDocument();
    expect((await screen.findAllByText('Correction started')).length).toBeGreaterThan(0);
  });

  it('a refused correction surfaces the classifier words inside the dialog', async () => {
    h.m.correctDay.mutateAsync.mockRejectedValue(new Error('boom'));
    h.query = { ...h.query, data: detail({ status: 'locked' }) };
    const user = userEvent.setup();
    view();
    await user.click(screen.getByTestId('safety-correct'));
    await user.type(await screen.findByLabelText(/Reason for the correction/), 'Wrong headcount');
    await user.click(screen.getByRole('button', { name: 'Start correction' }));
    expect((await screen.findAllByText(/Update failed/)).length).toBeGreaterThan(0);
  });
});

it("shows roster failure and prevents locking unknown readiness", async () => { h.rosterError = true; view(); expect(screen.getByRole("button", {name: /retry/i})).toBeInTheDocument(); expect(screen.getByTestId("safety-submit")).toBeDisabled(); });

it("explains a failed attendance photo open", async () => { const {repositories} = await import("@/src/lib/repositories"); vi.mocked(repositories.safetyDay.photoUrl).mockRejectedValueOnce(new TypeError("Failed to fetch")); h.query.data = detail({}, {talks: [{id: "t1", topic: "PPE", presenter: "Budi", held_at: "2026-03-10T01:00:00Z", attendees: [], photos: [{id: "p1", file_path: "p.jpg"}]}]}); view(); await userEvent.click(screen.getByRole("button", {name: "Attendance photo 1"})); expect(await screen.findByText(/Update failed/i)).toBeInTheDocument(); });
