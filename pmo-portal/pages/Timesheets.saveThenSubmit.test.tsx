import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import type { EntryUpsert } from '@/src/lib/timesheet-edit';
import Timesheets from './Timesheets';

const repositoryMocks = vi.hoisted(() => ({
  list: vi.fn(),
  listAwaitingApproval: vi.fn(),
  getPushState: vi.fn(),
  saveWeek: vi.fn(),
  submit: vi.fn(),
  listPickerOptions: vi.fn(),
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    timesheet: {
      list: repositoryMocks.list,
      listAwaitingApproval: repositoryMocks.listAwaitingApproval,
      getPushState: repositoryMocks.getPushState,
      saveWeek: repositoryMocks.saveWeek,
      submit: repositoryMocks.submit,
    },
    project: { listPickerOptions: repositoryMocks.listPickerOptions },
  },
}));

const currentWeek = '2026-06-01';
const projects = [
  { id: 'pQ', name: 'Acme Internal Platform', code: 'P003', status: 'Ongoing Project', client: null, pm: null },
];

function emptySheetRepository({ holdReads = false } = {}) {
  let sheet: TimesheetWithEntries | null = null;
  let holdRefetches = holdReads;
  let listReads = 0;
  const waitingReads: Array<(sheets: TimesheetWithEntries[]) => void> = [];

  repositoryMocks.list.mockImplementation(async () => {
    listReads += 1;
    if (holdRefetches && listReads > 1) {
      return await new Promise<TimesheetWithEntries[]>((resolve) => waitingReads.push(resolve));
    }
    return sheet ? [sheet] : [];
  });
  repositoryMocks.listAwaitingApproval.mockResolvedValue([]);
  repositoryMocks.getPushState.mockResolvedValue(null);
  repositoryMocks.listPickerOptions.mockResolvedValue(projects);
  repositoryMocks.saveWeek.mockImplementation(async (
    currentTimesheetId: string | null,
    weekStartDate: string,
    upserts: EntryUpsert[],
  ) => {
    if (!currentTimesheetId && sheet) {
      throw Object.assign(new Error('duplicate timesheet week'), { code: '23505' });
    }
    const id = currentTimesheetId ?? 'ts-created';
    const entries = upserts.map((upsert) => ({
      id: `${id}-${upsert.project_id}-${upsert.entry_date}`,
      timesheet_id: id,
      project_id: upsert.project_id,
      entry_date: upsert.entry_date,
      hours: upsert.hours,
      notes: upsert.notes,
      project: { name: 'Acme Internal Platform', code: 'P003' },
    }));
    sheet = {
      id,
      user_id: 'u1',
      week_start_date: weekStartDate,
      status: 'Draft',
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      org_id: 'org1',
      entries,
    } as unknown as TimesheetWithEntries;
    return id;
  });
  repositoryMocks.submit.mockImplementation(async (id: string) => {
    if (!sheet || sheet.id !== id) throw new Error('Timesheet not found');
    sheet = { ...sheet, status: 'Submitted', submitted_at: '2026-06-03T12:00:00.000Z' } as TimesheetWithEntries;
  });

  return {
    releaseReads() {
      holdRefetches = false;
      for (const resolve of waitingReads.splice(0)) resolve(sheet ? [sheet] : []);
    },
    waitingReads,
  };
}

const authValue = {
  session: null,
  currentUser: { id: 'u1', org_id: 'org1', role: 'Project Manager' },
  role: 'Project Manager',
  loading: false,
  profileError: null,
  profileErrorKind: null,
  signInWithPassword: vi.fn(),
  signInWithMagicLink: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  resendEmailConfirmation: vi.fn(),
  signOut: vi.fn(),
  refreshCurrentUser: vi.fn(),
} as unknown as AuthContextValue;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue}>
        <ImpersonationProvider realRole="Project Manager">
          <MemoryRouter>
            <ToastProvider>
              <Timesheets />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

async function enterHours() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(/add a project/i), 'pQ');
  await user.type(screen.getByLabelText('Acme Internal Platform, Mon hours'), '8');
  return user;
}

async function confirmSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Submit timesheet$/i }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /^Submit timesheet$/i }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-06-03T12:00:00'));
  repositoryMocks.list.mockReset();
  repositoryMocks.listAwaitingApproval.mockReset();
  repositoryMocks.getPushState.mockReset();
  repositoryMocks.saveWeek.mockReset();
  repositoryMocks.submit.mockReset();
  repositoryMocks.listPickerOptions.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AC-TM-018: save a new week before submitting it', () => {
  it('reuses the created sheet id when Submit follows Save before the week refetch completes', async () => {
    const server = emptySheetRepository({ holdReads: true });
    const { client } = renderPage();
    const user = await enterHours();
    const footer = screen.getByTestId('timesheets-footer');

    await user.click(within(footer).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(repositoryMocks.saveWeek).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(server.waitingReads.length).toBeGreaterThan(0));
    await waitFor(() => expect(within(footer).getByRole('button', { name: /^Save$/i })).toBeEnabled());

    await confirmSubmit(user);

    await waitFor(() => expect(repositoryMocks.submit).toHaveBeenCalledWith('ts-created'));
    expect(repositoryMocks.saveWeek.mock.calls.map(([id]) => id)).toEqual([null, 'ts-created']);
    expect(repositoryMocks.saveWeek.mock.calls.filter(([id]) => id === null)).toHaveLength(1);
    expect(repositoryMocks.saveWeek.mock.invocationCallOrder[1]).toBeLessThan(
      repositoryMocks.submit.mock.invocationCallOrder[0],
    );

    server.releaseReads();
    await waitFor(() => expect(screen.getByText('Submitted')).toBeInTheDocument());
    client.clear();
  });

  it('uses the created sheet id when Save is pressed again before the week refetch completes', async () => {
    const server = emptySheetRepository({ holdReads: true });
    const { client } = renderPage();
    const user = await enterHours();
    const saveButton = within(screen.getByTestId('timesheets-footer')).getByRole('button', { name: /^Save$/i });

    await user.click(saveButton);
    await waitFor(() => expect(repositoryMocks.saveWeek).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(server.waitingReads.length).toBeGreaterThan(0));
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(repositoryMocks.saveWeek).toHaveBeenCalledTimes(2));
    expect(repositoryMocks.saveWeek.mock.calls.map(([id]) => id)).toEqual([null, 'ts-created']);
    expect(repositoryMocks.saveWeek.mock.calls.filter(([id]) => id === null)).toHaveLength(1);

    server.releaseReads();
    client.clear();
  });

  it('still saves once and then submits when Submit is the first action on a new week', async () => {
    emptySheetRepository();
    renderPage();
    const user = await enterHours();

    await confirmSubmit(user);

    await waitFor(() => expect(repositoryMocks.submit).toHaveBeenCalledWith('ts-created'));
    expect(repositoryMocks.saveWeek).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.saveWeek.mock.calls[0][0]).toBeNull();
  });
});
