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
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
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
  return result;
}

async function enterHours() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText(/add a project/i), 'pQ');
  await user.type(screen.getByLabelText('Acme Internal Platform, Mon hours'), '8');
  return user;
}

async function confirmSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Submit week$/i }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /^Submit week$/i }));
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

const statusLine = () => screen.getByTestId('timesheets-save-status');
const saveButton = () => within(screen.getByTestId('timesheets-footer')).getByRole('button', { name: /^Save draft$/i });
const hoursCell = () => screen.getByLabelText('Acme Internal Platform, Mon hours') as HTMLInputElement;

describe('AC-TSF-001: invalid input is named, not silently blocked', () => {
  it('AC-TSF-001 says the hours need fixing and keeps Save disabled', async () => {
    emptySheetRepository();
    renderPage();
    const user = await enterHours();
    await user.type(hoursCell(), '5');
    expect(hoursCell().value).toBe('85');
    await waitFor(() => expect(statusLine()).toHaveTextContent(/fix the hours/i));
    expect(saveButton()).toBeDisabled();
    expect(repositoryMocks.saveWeek).not.toHaveBeenCalled();
  });
});

describe('AC-TSF-002: saving is visible while the write is in flight', () => {
  it('AC-TSF-002 reads saving, then saved when the write lands', async () => {
    emptySheetRepository();
    let finish!: (id: string) => void;
    const impl = repositoryMocks.saveWeek.getMockImplementation()!;
    repositoryMocks.saveWeek.mockImplementationOnce(
      (...args: unknown[]) => new Promise<string>((resolve) => {
        finish = (id) => resolve(id);
        void (impl as (...a: unknown[]) => Promise<string>)(...args);
      }),
    );
    renderPage();
    const user = await enterHours();
    await user.click(saveButton());
    await waitFor(() => expect(statusLine()).toHaveTextContent(/saving/i));
    finish('ts-created');
    await waitFor(() => expect(statusLine()).toHaveTextContent('All changes saved'));
  });
});

describe('AC-TSF-003: a failed save keeps the edits and says so usefully', () => {
  it('AC-TSF-003 shows failed with edits kept, a classified toast, and returns to unsaved on the next edit', async () => {
    emptySheetRepository();
    repositoryMocks.saveWeek.mockRejectedValueOnce(
      Object.assign(new Error('permission denied for table timesheets'), { code: '42501' }),
    );
    renderPage();
    const user = await enterHours();
    await user.click(saveButton());

    await waitFor(() => expect(statusLine()).toHaveTextContent(/save failed/i));
    expect(statusLine()).toHaveTextContent(/hours are kept/i);
    expect(hoursCell().value).toBe('8');
    expect(statusLine()).not.toHaveTextContent('All changes saved');
    // The toast carries the classified, human detail, never the raw table name.
    expect(await findToastAnnouncement('alert', /Your role does not allow this change/)).toBeInTheDocument();
    expect(screen.queryByText(/for table timesheets/i)).not.toBeInTheDocument();

    await user.type(hoursCell(), '.5');
    await waitFor(() => expect(statusLine()).toHaveTextContent('Unsaved changes'));
    // Retry succeeds with the preserved edits.
    await user.click(saveButton());
    await waitFor(() => expect(statusLine()).toHaveTextContent('All changes saved'));
    expect(repositoryMocks.saveWeek).toHaveBeenCalledTimes(2);
  });
});

describe('AC-TSF-004: saved is shown before the refetch and ends at the next edit', () => {
  it('AC-TSF-004 reads saved while the refetch is held, then unsaved after typing', async () => {
    const server = emptySheetRepository({ holdReads: true });
    renderPage();
    const user = await enterHours();
    await user.click(saveButton());
    await waitFor(() => expect(server.waitingReads.length).toBeGreaterThan(0));
    expect(statusLine()).toHaveTextContent('All changes saved');
    await user.type(hoursCell(), '.5');
    await waitFor(() => expect(statusLine()).toHaveTextContent('Unsaved changes'));
    server.releaseReads();
  });
});

describe('AC-TSF-005/006: the created draft is reused before the refetch', () => {
  it('AC-TSF-005 a second Save after creation updates the created draft, with its own hours', async () => {
    const server = emptySheetRepository({ holdReads: true });
    renderPage();
    const user = await enterHours();
    await user.click(saveButton());
    await waitFor(() => expect(server.waitingReads.length).toBeGreaterThan(0));
    await user.type(hoursCell(), '.5');
    await user.click(saveButton());
    await waitFor(() => expect(repositoryMocks.saveWeek).toHaveBeenCalledTimes(2));
    const calls = repositoryMocks.saveWeek.mock.calls;
    expect(calls.map(([id]) => id)).toEqual([null, 'ts-created']);
    expect((calls[1][2] as EntryUpsert[])[0].hours).toBe(8.5);
    server.releaseReads();
  });

  it('AC-TSF-006 Submit right after creation saves the new edits into the created draft and submits it', async () => {
    const server = emptySheetRepository({ holdReads: true });
    renderPage();
    const user = await enterHours();
    await user.click(saveButton());
    await waitFor(() => expect(server.waitingReads.length).toBeGreaterThan(0));
    await user.type(hoursCell(), '.5');
    await confirmSubmit(user);
    await waitFor(() => expect(repositoryMocks.submit).toHaveBeenCalledWith('ts-created'));
    expect(repositoryMocks.saveWeek.mock.calls.map(([id]) => id)).toEqual([null, 'ts-created']);
    server.releaseReads();
  });
});

describe('AC-TSF-007/008: each week stands alone and invalid input is not lost silently', () => {
  it('AC-TSF-007 a failed save in one week does not mark the next week failed', async () => {
    emptySheetRepository();
    repositoryMocks.saveWeek.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    const user = await enterHours();
    await user.click(saveButton());
    await waitFor(() => expect(statusLine()).toHaveTextContent(/save failed/i));

    await user.click(screen.getByRole('button', { name: /next week/i }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /discard changes/i }));
    await waitFor(() => expect(statusLine()).not.toHaveTextContent(/save failed/i));
    expect(statusLine()).toBeEmptyDOMElement();
  });

  it('AC-TSF-008 stepping weeks with invalid hours warns they will be lost; Keep editing preserves them', async () => {
    emptySheetRepository();
    renderPage();
    const user = await enterHours();
    await user.type(hoursCell(), '5');
    const rangeBefore = screen.getByRole('button', { name: /next week/i }).parentElement!.textContent;

    await user.click(screen.getByRole('button', { name: /next week/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/not valid/i);
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hoursCell().value).toBe('85');
    expect(screen.getByRole('button', { name: /next week/i }).parentElement!.textContent).toBe(rangeBefore);
  });
});
