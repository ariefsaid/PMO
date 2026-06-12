import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const render$ = () =>
  render(
    <ToastProvider>
      <MilestoneStrip projectId="p1" />
    </ToastProvider>,
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
});
