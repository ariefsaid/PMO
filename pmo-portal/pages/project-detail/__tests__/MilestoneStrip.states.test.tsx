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

  it('UIP-005: compact phase context states loading, error + retry, and empty without a full-height panel', () => {
    milestoneState.isPending = true;
    const pending = render$(true);
    expect(within(screen.getByTestId('milestone-summary')).getByRole('status')).toHaveTextContent(/Delivery phases/);
    expect(screen.queryByTestId('milestone-strip-skeleton')).not.toBeInTheDocument();
    pending.unmount();
    milestoneState.isPending = false;
    milestoneState.isError = true;
    const failed = render$(true);
    expect(within(screen.getByTestId('milestone-summary')).getByRole('alert')).toHaveTextContent("Couldn't load milestones");
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(milestoneState.refetch).toHaveBeenCalledTimes(1);
    failed.unmount();
    milestoneState.isError = false;
    render$(true);
    expect(screen.getByText('No delivery phases yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/projects/p1/overview');
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

  it('AC-DEL-014/FR-DEL-013: empty + PM viewer renders the planning prompt and first-phase CTA', () => {
    milestoneState.data = [];
    milestoneState.isPending = false;
    mockRole = 'Project Manager';
    render$();
    expect(screen.getByTestId('milestone-strip-empty')).toBeInTheDocument();
    expect(screen.getByText("Plan this project's delivery phases")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add the first phase/i })).toBeInTheDocument();
  });

  it('FR-DEL-013: empty + Engineer viewer sees a quiet "No delivery phases yet" line', () => {
    milestoneState.data = [];
    milestoneState.isPending = false;
    mockRole = 'Engineer';
    render$();
    expect(screen.getByText('No delivery phases yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add the first phase/i })).not.toBeInTheDocument();
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

  it('empty state + clicking "Add the first phase" opens CREATE modal (formTarget with null milestone)', () => {
    render$();
    fireEvent.click(screen.getByRole('button', { name: /add the first phase/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('non-empty state + clicking "Add milestone" opens CREATE modal (formTarget with null milestone)', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /add milestone/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clicking "Edit milestone" in row menu opens EDIT modal (formTarget with milestone)', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /edit milestone/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
