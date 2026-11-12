import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import Timesheets from '../Timesheets';

/**
 * Unknown-as-zero audit F18: the "Team review · N awaiting" count is a fact only once the
 * awaiting-approval read has landed. While it is loading the badge withholds the count —
 * it never reads as a confirmed zero ("nobody is waiting").
 */

// Pin the clock inside the week of Mon 2026-06-01 so the week toolbar is deterministic.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-06-03T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

const tsState = {
  data: [] as unknown[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const { approvalState } = vi.hoisted(() => ({
  approvalState: { awaiting: undefined as unknown[] | undefined },
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: approvalState.awaiting, isPending: false, isError: false }),
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue('ts-1'), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
    isReconciling: false,
    retryDeleteRefresh: vi.fn(),
    reconciledDelete: null,
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  tsState.data = [];
  tsState.isPending = false;
  tsState.isError = false;
});

describe('F18 — the awaiting-approval count never prints while unknown', () => {
  it('while the awaiting read has not landed, the badge shows no count (never a fabricated 0)', () => {
    approvalState.awaiting = undefined;
    renderPage();
    const link = screen.getByRole('link', { name: /Team review/ });
    expect(link).toHaveAccessibleName('Team review');
    expect(link).not.toHaveAccessibleName(/awaiting/);
  });

  it('a loaded count prints exactly once it is known', () => {
    approvalState.awaiting = [{ id: 'ts-1' }, { id: 'ts-2' }, { id: 'ts-3' }];
    renderPage();
    expect(screen.getByRole('link', { name: 'Team review · 3 awaiting' })).toBeInTheDocument();
  });

  it('a loaded genuine zero keeps the plain label', () => {
    approvalState.awaiting = [];
    renderPage();
    expect(screen.getByRole('link', { name: 'Team review' })).toBeInTheDocument();
  });
});
