import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stubs ────────────────────────────────────────────────────────────────────

const milestoneState = {
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const milestoneMutations = {
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => milestoneMutations,
}));

// Role control: default to PM so canCreate = true
let mockRole = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: mockRole, effectiveRole: mockRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: mockRole }),
}));

import MilestoneStrip from '../MilestoneStrip';

const render$ = (summary = false) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <MilestoneStrip projectId="p1" summary={summary} />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('MilestoneStrip states (AC-DEL-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    milestoneState.data = [];
    milestoneState.isPending = false;
    milestoneState.isError = false;
    milestoneState.refetch = vi.fn();
    mockRole = 'Project Manager';
  });

  it('UIP-005 / PD-A: compact phase context renders only error + retry or real phases — loading and empty render nothing', () => {
    milestoneState.isPending = true;
    const pending = render$(true);
    expect(screen.queryByTestId('milestone-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('milestone-strip-skeleton')).not.toBeInTheDocument();
    pending.unmount();
    milestoneState.isPending = false;
    milestoneState.isError = true;
    const failed = render$(true);
    expect(within(screen.getByTestId('milestone-summary')).getByRole('alert')).toHaveTextContent("Couldn't load phases");
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(milestoneState.refetch).toHaveBeenCalledTimes(1);
    failed.unmount();
    milestoneState.isError = false;
    // SUB-A: no phases → the summary line renders nothing (no empty text, no stray link).
    render$(true);
    expect(screen.queryByTestId('milestone-summary')).not.toBeInTheDocument();
    expect(screen.queryByText('No delivery phases yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add the first phase/ })).not.toBeInTheDocument();
  });

  it('UIP-005: compact context identifies the current phase, rollup and overdue recovery link; completed phases stay honest', () => {
    milestoneState.data = [
      { id: 'm1', project_id: 'p1', name: 'Design', sort_order: 0, target_date: null, weight: 1, input_pct: 100, effective_pct: 100, calculated_pct: 100, task_count: 2 },
      { id: 'm2', project_id: 'p1', name: 'Installation', sort_order: 1, target_date: '2000-01-01', weight: 1, input_pct: 40, effective_pct: 40, calculated_pct: 40, task_count: 2 },
    ];
    const active = render$(true);
    expect(screen.getByTestId('milestone-summary')).toHaveTextContent('Installation');
    expect(screen.getByTestId('milestone-summary')).toHaveTextContent('70%');
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View blocking tasks' })).toHaveAttribute('href', '/projects/p1/tasks');
    expect(screen.queryByRole('button', { name: /Edit progress/ })).not.toBeInTheDocument();
    active.unmount();
    milestoneState.data = milestoneState.data.map(m => ({ ...m, effective_pct: 100 }));
    render$(true);
    expect(screen.getByTestId('milestone-summary')).toHaveTextContent('100%');
    expect(screen.queryByRole('link', { name: 'View blocking tasks' })).not.toBeInTheDocument();
  });

  it('AC-DEL-014: pending query renders the loading skeleton (testid milestone-strip-loading)', () => {
    milestoneState.isPending = true;
    render$();
    expect(screen.getByTestId('milestone-strip-loading')).toBeInTheDocument();
  });

  it('AC-DEL-014/FR-DEL-013: empty + PM viewer renders ONE line with the plan-phases CTA (PD-B: no hero, no placeholder bars)', () => {
    milestoneState.data = [];
    milestoneState.isPending = false;
    mockRole = 'Project Manager';
    render$();
    const empty = screen.getByTestId('milestone-strip-empty');
    expect(empty).toHaveTextContent('No delivery phases yet');
    expect(within(empty).getByRole('button', { name: 'Plan delivery phases' })).toBeInTheDocument();
    expect(screen.queryByText("Plan this project's delivery phases")).not.toBeInTheDocument();
    expect(empty.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it('FR-DEL-013: empty + Engineer viewer sees a quiet "No delivery phases yet" line', () => {
    milestoneState.data = [];
    milestoneState.isPending = false;
    mockRole = 'Engineer';
    render$();
    expect(screen.getByText('No delivery phases yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /plan delivery phases/i })).not.toBeInTheDocument();
  });

  it('AC-DEL-014: error renders an error + Retry, and Retry calls refetch', () => {
    milestoneState.isError = true;
    const refetchSpy = vi.fn();
    milestoneState.refetch = refetchSpy;
    render$();
    // The error state should render a retry button
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('empty state + clicking "Plan delivery phases" opens CREATE modal (formTarget with null milestone)', () => {
    render$();
    fireEvent.click(screen.getByRole('button', { name: /plan delivery phases/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('non-empty state + clicking "Add phase" opens CREATE modal (formTarget with null milestone)', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Engineering design',
        sort_order: 0,
        target_date: null,
        weight: 1,
        input_pct: 75,
        task_count: 5,
        calculated_pct: 60,
        effective_pct: 75,
      },
    ];
    render$();
    fireEvent.click(screen.getByRole('button', { name: /add phase/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clicking "Edit phase" in row menu opens EDIT modal (formTarget with milestone)', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Engineering design',
        sort_order: 0,
        target_date: null,
        weight: 1,
        input_pct: 75,
        task_count: 5,
        calculated_pct: 60,
        effective_pct: 75,
      },
    ];
    render$();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Engineering design' }));
    fireEvent.click(screen.getByRole('button', { name: /edit phase/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
