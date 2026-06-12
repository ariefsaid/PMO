import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stub useMilestones ───────────────────────────────────────────────────────
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

const render$ = (projectId = 'p1') =>
  render(
    <ToastProvider>
      <MilestoneStrip projectId={projectId} />
    </ToastProvider>,
  );

describe('MilestoneStrip display (AC-DEL-008, AC-DEL-009)', () => {
  it('AC-DEL-008: renders a single segmented track plus the effective headline and from-tasks line', () => {
    milestoneState.data = [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Engineering design',
        sort_order: 0,
        target_date: '2026-08-15',
        weight: 1,
        input_pct: 75,
        task_count: 5,
        calculated_pct: 60,
        effective_pct: 75,
      },
      {
        id: 'm2',
        project_id: 'p1',
        name: 'Procurement',
        sort_order: 1,
        target_date: null,
        weight: 1,
        input_pct: null,
        task_count: 0,
        calculated_pct: null,
        effective_pct: 0,
      },
    ];
    render$();

    expect(screen.getByRole('list', { name: 'Delivery phases' })).toBeInTheDocument();
    expect(screen.getByText('Engineering design')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Target 15 Aug')).toBeInTheDocument();
    expect(screen.getByText('From tasks 60%')).toBeInTheDocument();
    expect(screen.queryByText('PM input')).not.toBeInTheDocument();
  });

  it('AC-DEL-009: null calculated renders the muted from-tasks fallback and 0% effective headline', () => {
    milestoneState.data = [
      {
        id: 'm2',
        project_id: 'p1',
        name: 'Procurement',
        sort_order: 1,
        target_date: null,
        weight: 1,
        input_pct: null,
        task_count: 0,
        calculated_pct: null,
        effective_pct: 0,
      },
    ];
    render$();

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('From tasks —')).toBeInTheDocument();
    expect(screen.queryByText('PM input')).not.toBeInTheDocument();
  });
});
