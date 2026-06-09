import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * A-2 ApprovalsQueue approver gate (AC-W2-RBAC-003/004, rbac-visibility §I + OD-W2-2):
 *   Approve / Return is offered ONLY to the actual approver roles (Admin·Exec·PM). Finance = ○
 *   and Engineer = ○ (OD-W2-2 keeps Engineer-approval OFF at the FE — policy stays denying it).
 *   The queue already excludes the caller's own sheets (SoD), so the only remaining gate is the
 *   real-role approver check.
 *
 * Two-sided gating-invariant: the AUTHORIZED role (PM) sees Approve + Return on a submitted row;
 * the DENIED role (Finance / Engineer) sees the owner + hours + status but NO Approve/Return.
 */
const { queue } = vi.hoisted(() => ({
  queue: {
    data: [
      {
        id: 's1',
        status: 'Submitted',
        week_start_date: '2026-06-01',
        owner: { full_name: 'Dana Report' },
        entries: [{ hours: 8 }, { hours: 8 }],
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queue,
  useTimesheetMutations: () => ({
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
}));

import { ApprovalsQueue } from '../ApprovalsQueue';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <ApprovalsQueue />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  queue.isPending = false;
  queue.isError = false;
});

describe('ApprovalsQueue — RBAC approver gate (A-2)', () => {
  it('AC-W2-RBAC-004: a PM (line manager) sees Approve + Return (authorized)', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Return/i })).toBeInTheDocument();
    // The row still reads the owner + hours.
    expect(screen.getByText('Dana Report')).toBeInTheDocument();
  });

  it('AC-W2-RBAC-003: Finance sees the row (owner + hours + status) but NO Approve/Return (denied)', () => {
    renderAs('Finance');
    expect(screen.getByText('Dana Report')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Return/i })).not.toBeInTheDocument();
  });

  it('AC-W2-RBAC-003: an Engineer sees NO Approve/Return (OD-W2-2: Engineer-approval OFF)', () => {
    renderAs('Engineer');
    expect(screen.getByText('Dana Report')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Return/i })).not.toBeInTheDocument();
  });
});
