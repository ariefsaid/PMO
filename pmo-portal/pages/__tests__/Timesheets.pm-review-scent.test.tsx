import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * Fix #8 — PM-timesheets review scent.
 *
 * When a PM (approver) has N timesheets awaiting review, the cross-link on
 * /timesheets should surface a clear "Review N awaiting" affordance, not just
 * the generic "Approvals" label. This makes the review job discoverable without
 * forcing a non-PM to navigate away.
 *
 * AC-FIX8-PM-01: when pendingCount > 0, the link text is "Review N awaiting"
 *   (not just "Approvals"), making the review path more prominent.
 * AC-FIX8-PM-02: the link still goes to /approvals?scope=timesheets.
 * AC-FIX8-PM-03: when pendingCount === 0, the link text is "Approvals" (unchanged).
 */

const { tsState, awaitingState } = vi.hoisted(() => ({
  tsState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  awaitingState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => awaitingState,
  // I-16/I-17: the owner's own ERP push state. No mirror row here (an unflipped org).
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import Timesheets from '../Timesheets';

const renderAsPM = () =>
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-06-03T12:00:00'));
  tsState.data = [];
  tsState.isPending = false;
  tsState.isError = false;
  awaitingState.data = [];
  awaitingState.isPending = false;
});

describe('Timesheets — PM review-scent (fix #8)', () => {
  it('AC-FIX8-PM-01: when N timesheets awaiting, link copy is "Review N awaiting"', () => {
    awaitingState.data = [{ id: 'ts-1' }, { id: 'ts-2' }, { id: 'ts-3' }];
    renderAsPM();
    // The link text should include the count and "awaiting" or "review"
    const link = screen.getByRole('link', { name: /review 3 awaiting/i });
    expect(link).toBeInTheDocument();
  });

  it('AC-FIX8-PM-02: the review link still navigates to /approvals?scope=timesheets', () => {
    awaitingState.data = [{ id: 'ts-1' }];
    renderAsPM();
    const link = screen.getByRole('link', { name: /review 1 awaiting/i });
    expect(link).toHaveAttribute('href', '/approvals?scope=timesheets');
  });

  it('AC-FIX8-PM-03: when no pending timesheets, link reads "Approvals" (no action needed)', () => {
    awaitingState.data = [];
    renderAsPM();
    const link = screen.getByRole('link', { name: /^Approvals$/i });
    expect(link).toBeInTheDocument();
  });
});
