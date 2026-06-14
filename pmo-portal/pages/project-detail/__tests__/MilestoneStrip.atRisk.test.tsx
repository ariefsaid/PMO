import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

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

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import MilestoneStrip from '../MilestoneStrip';

const render$ = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <MilestoneStrip projectId="p1" />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('MilestoneStrip at-risk state (AC-DEL-009)', () => {
  it('AC-DEL-009: a past-target incomplete phase shows Overdue and a warning target date', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Construction',
        sort_order: 0,
        target_date: '2024-05-01',
        weight: 1,
        input_pct: 25,
        task_count: 5,
        calculated_pct: 25,
        effective_pct: 25,
      },
    ];

    render$();

    expect(screen.getByText('Overdue')).toBeInTheDocument();
    const target = screen.getByText('Target 01 May');
    expect(target).toBeInTheDocument();
    expect(target.className).toContain('text-warning-foreground');
  });
});
