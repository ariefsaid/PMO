import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import Timesheets from './Timesheets';

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), submit: vi.fn(), offline: false, deleted: false }));
vi.mock('@/src/lib/db/timesheets', () => ({
  listTimesheets: mocks.list,
  saveTimesheetWeek: mocks.save,
  TimesheetWriteError: class extends Error {},
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' }, role: 'Project Manager' }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({ submit: { mutate: mocks.submit, isPending: false }, reopen: { mutate: vi.fn(), isPending: false } }),
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
  useOwnTimesheetPushState: () => ({ data: null }),
}));

afterEach(() => { onlineManager.setOnline(true); vi.restoreAllMocks(); });

it.each([true, false])('reconciles an uncertain deletion before submitting (committed: %s)', async (committed) => {
  const now = new Date();
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const week = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const next = new Date(now); next.setDate(next.getDate() + 1);
  const tuesday = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  const entry = (id: string, projectId: string, name: string, hours: number, date = week) => ({ id, timesheet_id: 'sheet', project_id: projectId, entry_date: date, hours, notes: null, project: { name, code: null } });
  const other = entry('other', 'p2', 'Other project', 2);
  const sheet = (entries: unknown[]) => ({ id: 'sheet', user_id: 'u1', week_start_date: week, status: 'Draft', entries });
  mocks.offline = false; mocks.deleted = false; mocks.list.mockReset(); mocks.save.mockReset(); mocks.submit.mockReset();
  mocks.list.mockImplementation(async () => {
    if (mocks.offline) throw new Error('Offline');
    return [sheet(mocks.deleted ? [other] : [entry('e1', 'p1', 'First project', 8), entry('e2', 'p1', 'First project', 2, tuesday), other])];
  });
  mocks.save.mockImplementationOnce(async () => { mocks.deleted = committed; mocks.offline = true; onlineManager.setOnline(false); throw new Error('Response lost'); });
  mocks.save.mockResolvedValue('sheet');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ImpersonationProvider realRole="Project Manager"><MemoryRouter><ToastProvider><Timesheets /></ToastProvider></MemoryRouter></ImpersonationProvider></QueryClientProvider>);
  const user = userEvent.setup();
  const firstHours = await screen.findByLabelText('First project, Mon hours');
  await user.clear(firstHours); await user.type(firstHours, '9');
  await user.clear(screen.getByLabelText('First project, Tue hours'));
  await user.type(screen.getByLabelText('First project, Wed hours'), '4');
  await user.click(screen.getByRole('button', { name: /add note to First project/i }));
  await user.type(screen.getByLabelText('First project note'), 'Draft note');
  const otherHours = await screen.findByLabelText('Other project, Mon hours');
  await user.clear(otherHours); await user.type(otherHours, '3');
  await user.click(screen.getByRole('button', { name: /delete First project row/i }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /delete row/i }));
  const retry = await screen.findByRole('button', { name: /retry week refresh/i });
  expect(screen.getByRole('button', { name: /next week/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /submit timesheet/i })).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.offline = false; onlineManager.setOnline(true);
  await user.click(retry);
  await waitFor(() => expect(screen.queryByRole('button', { name: /retry week refresh/i })).not.toBeInTheDocument());
  if (committed) expect(screen.queryByLabelText('First project, Mon hours')).not.toBeInTheDocument();
  else {
    expect(screen.getByLabelText('First project, Mon hours')).toHaveValue('9');
    expect(screen.getByLabelText('First project note')).toHaveValue('Draft note');
    expect(screen.getByLabelText('First project, Tue hours')).toHaveValue('');
    expect(screen.getByLabelText('First project, Wed hours')).toHaveValue('4');
  }
  expect(screen.getByLabelText('Other project, Mon hours')).toHaveValue('3');
  await user.click(screen.getByRole('button', { name: /submit timesheet/i }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /submit timesheet/i }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledTimes(2);
  const upserts = mocks.save.mock.calls[1][2] as Array<{ project_id: string; hours: number }>;
  expect(upserts).toEqual(expect.arrayContaining([expect.objectContaining({ project_id: 'p2', hours: 3 })]));
  if (committed) expect(upserts.some((item) => item.project_id === 'p1')).toBe(false);
  else {
    expect(upserts).toEqual(expect.arrayContaining([expect.objectContaining({ project_id: 'p1', hours: 9, notes: 'Draft note' }), expect.objectContaining({ project_id: 'p1', hours: 4, notes: 'Draft note' })]));
    expect(mocks.save.mock.calls[1][3]).toContain('e2');
  }
  expect(mocks.save.mock.invocationCallOrder[1]).toBeLessThan(mocks.submit.mock.invocationCallOrder[0]);
});
