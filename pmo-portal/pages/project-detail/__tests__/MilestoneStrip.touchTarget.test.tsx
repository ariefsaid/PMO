/**
 * AC-W2-7-01: Milestone ⋯ menu trigger has a ≥44px touch target (touch-target class).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() }),
}));

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({
    data: [
      {
        id: 'm1',
        project_id: 'p1',
        name: 'Foundation',
        due_date: '2026-07-01',
        target_date: '2026-07-01',
        status: 'Pending',
        blocking_task_count: 0,
        org_id: 'org-1',
        effective_pct: 0,
        task_count: 0,
        completion_pct: 0,
        phase: null,
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import MilestoneStrip from '../MilestoneStrip';

describe('MilestoneStrip touch target (W2-7)', () => {
  it('AC-W2-7-01: ⋯ menu button has touch-target class for ≥44px coarse-pointer hit area', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <MilestoneStrip projectId="p1" />
        </ToastProvider>
      </MemoryRouter>,
    );

    const moreBtn = screen.getByRole('button', { name: /more actions for foundation/i });
    expect(moreBtn.className).toContain('touch-target');
  });
});
