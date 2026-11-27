import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import Timesheets from '../Timesheets';

/**
 * #2440 — one parser, one formatter: an hour typed or pasted with the locale's decimal mark is saved as
 * its number and shown back in the same locale, in the existing phone and desktop grids alike.
 */

const MONDAY = '2026-06-01';
const saveMutate = vi.fn();
const tsState: { data: TimesheetWithEntries[]; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } =
  { data: [], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'engineer-test-user', org_id: 'org-1' }, role: 'Engineer' }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({ submit: { mutate: vi.fn(), isPending: false }, reopen: { mutate: vi.fn(), isPending: false } }),
  useTimesheetsAwaitingApproval: () => ({ data: [] }),
  useOwnTimesheetPushState: () => ({ data: null }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({ saveWeek: { mutate: saveMutate, isPending: false }, deleteRow: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [] }) }));

const sheet = (hours: number): TimesheetWithEntries[] => [{
  id: 'ts-draft', user_id: 'engineer-test-user', week_start_date: MONDAY, status: 'Draft', submitted_at: null, approved_by: null,
  approved_at: null, org_id: 'org-1',
  entries: [{ id: 'e1', timesheet_id: 'ts-draft', project_id: 'pr1', entry_date: MONDAY, hours, notes: null, project: { name: 'Alpha Project', code: 'A001' } }],
}] as unknown as TimesheetWithEntries[];

const renderPage = () => render(
  <ImpersonationProvider realRole="Engineer"><MemoryRouter><ToastProvider><Timesheets /></ToastProvider></MemoryRouter></ImpersonationProvider>,
);

/** Monday's project field is the first matching hour input in either grid. */
async function mondayField(): Promise<HTMLInputElement> {
  return screen.getAllByRole('textbox').find((el) => /^Alpha Project, .+ hours$/.test(el.getAttribute('aria-label') ?? '')) as HTMLInputElement;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-06-03T12:00:00'));
  saveMutate.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetActiveLocale();
});

const cases = [
  { lang: 'id', typed: '3,5', shown: '3,5' },
  { lang: 'en', typed: '3.5', shown: '3.5' },
] as const;

describe.each(['phone', 'desktop'] as const)('#2440 hours round-trip on the %s', (width) => {
  it.each(cases.flatMap((c) => [{ ...c, how: 'typed' as const }, { ...c, how: 'pasted' as const }]))(
    '$lang: $typed $how is saved as 3.5 and shown again as $shown',
    async ({ lang, typed, shown, how }) => {
      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: width === 'desktop', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
      setActiveLocale({ locale: lang, numberLocale: lang === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
      tsState.data = sheet(6);
      const { unmount } = renderPage();
      const field = await mondayField();
      await userEvent.clear(field);
      if (how === 'typed') await userEvent.type(field, typed);
      else { field.focus(); await userEvent.paste(typed); }
      expect(field).not.toHaveAttribute('aria-invalid');
      await userEvent.click(screen.getAllByRole('button', { name: /save draft|simpan draf/i })[0]);
      expect(saveMutate).toHaveBeenCalledTimes(1);
      expect(saveMutate.mock.calls[0][0].diff.upserts).toEqual([expect.objectContaining({ entry_date: MONDAY, hours: 3.5 })]);
      unmount();

      // The saved week comes back from the server: the field shows the hours in the reader's locale.
      tsState.data = sheet(3.5);
      renderPage();
      expect(await mondayField()).toHaveValue(shown);
    },
  );
});
