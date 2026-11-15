import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

const milestoneState = {
  data: [
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
  ] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const removeSpy = vi.fn().mockResolvedValue(undefined);
const milestoneMutations = {
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: removeSpy, isPending: false },
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

/** #2130: the phase overflow menu grows from its trigger for a pointer and appears instantly from the keyboard. */
const openMenu = (detail: number) => {
  render$();
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Engineering design' }), { detail });
  return screen.getByRole('button', { name: 'Delete phase Engineering design' }).parentElement as HTMLElement;
};

describe('MilestoneStrip overflow menu motion (#2130)', () => {
  it('a pointer open plays the house pop and opts out under reduced motion', () => {
    const menu = openMenu(1);
    expect(menu).toHaveClass('menu-pop-anim', 'motion-reduce:animate-none');
    expect(menu).not.toHaveAttribute('data-instant');
  });

  it('a keyboard open appears instantly', () => {
    expect(openMenu(0)).toHaveAttribute('data-instant');
  });
});
