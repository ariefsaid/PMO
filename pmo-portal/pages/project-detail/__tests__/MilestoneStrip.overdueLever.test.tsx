/**
 * AC-IFW-RECORD-03 — Overdue phase lever: an overdue MilestonePhaseCard exposes a
 * "View blocking tasks" link to the project's Tasks tab (/projects/:projectId/tasks).
 * A non-overdue phase does NOT expose the link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── mocks ────────────────────────────────────────────────────────────────────
const milestoneState = {
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

// Desktop so MilestonePhaseCard renders (not the mobile view)
vi.mock('@/src/components/ui/useIsDesktop', () => ({
  useIsDesktop: () => true,
}));

import MilestoneStrip from '../MilestoneStrip';

// ── fixtures ──────────────────────────────────────────────────────────────────
const pastDate = '2024-01-01'; // definitely in the past

const overduePhase: MilestoneWithProgress = {
  id: 'm-overdue',
  name: 'Foundation Works',
  project_id: 'proj1',
  target_date: pastDate,
  weight: 50,
  input_pct: 40,
  effective_pct: 40,
  task_count: 3,
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
} as unknown as MilestoneWithProgress;

const futurePhase: MilestoneWithProgress = {
  id: 'm-future',
  name: 'Commissioning',
  project_id: 'proj1',
  target_date: '2099-12-31',
  weight: 50,
  input_pct: 0,
  effective_pct: 0,
  task_count: 0,
  org_id: 'org-1',
  created_at: '2026-01-01T00:00:00Z',
} as unknown as MilestoneWithProgress;

// ── render helper ─────────────────────────────────────────────────────────────
const render$ = (projectId = 'proj1') =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <MilestoneStrip projectId={projectId} />
      </ToastProvider>
    </MemoryRouter>,
  );

// ── tests ─────────────────────────────────────────────────────────────────────
describe('AC-IFW-RECORD-03: overdue phase exposes "View blocking tasks" link', () => {
  beforeEach(() => {
    milestoneState.data = [];
    milestoneState.isPending = false;
    milestoneState.isError = false;
  });

  it('AC-IFW-RECORD-03: an overdue phase (past target date, started, <100%) renders a "View blocking tasks" link', () => {
    milestoneState.data = [overduePhase];
    render$('proj1');

    const link = screen.getByRole('link', { name: /view blocking tasks/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/projects/proj1/tasks');
  });

  it('AC-IFW-RECORD-03: a non-overdue (future) phase does NOT render the "View blocking tasks" link', () => {
    milestoneState.data = [futurePhase];
    render$('proj1');

    expect(screen.queryByRole('link', { name: /view blocking tasks/i })).toBeNull();
  });

  it('AC-IFW-RECORD-03: when both overdue and non-overdue phases exist, only the overdue one gets the link', () => {
    milestoneState.data = [overduePhase, futurePhase];
    render$('proj1');

    const links = screen.getAllByRole('link', { name: /view blocking tasks/i });
    // Only the overdue phase card should have this link
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/projects/proj1/tasks');
  });

  it('AC-IFW-RECORD-03: a completed phase (100%) does NOT render the link even if the date is past', () => {
    const donePhase: MilestoneWithProgress = {
      ...overduePhase,
      id: 'm-done',
      name: 'Design Phase',
      effective_pct: 100,
      input_pct: 100,
    };
    milestoneState.data = [donePhase];
    render$('proj1');

    expect(screen.queryByRole('link', { name: /view blocking tasks/i })).toBeNull();
  });
});
