import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const winEligibility = vi.hoisted(() => ({ data: 'allowed' as string | undefined, isFetching: false, isError: false }));

const mockEligibility = vi.fn((..._args: unknown[]) => winEligibility);
const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: vi.fn(() => ({ effectiveRole: 'Project Manager' })),
}));

vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectWinEligibility: (...args: unknown[]) => mockEligibility(...args),
  useProjectTransition: vi.fn(() => ({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isError: false,
    error: null,
    isPending: false,
  })),
}));

import ProjectStatusControl from './ProjectStatusControl';
import { useEffectiveRole } from '@/src/auth/impersonation';

/** #2130: a status menu grows from its trigger for a pointer, and appears instantly from the keyboard. */
const project = { id: 'proj-1', status: 'Negotiation' as const, customer_contract_ref: null as string | null };

const openMenu = (detail: number) => {
  render(
    <ToastProvider>
      <ProjectStatusControl project={project} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /change status/i }), { detail });
  return screen.getByText('Move to').parentElement as HTMLElement;
};

describe('ProjectStatusControl menu motion (#2130)', () => {
  beforeEach(() => {
    vi.mocked(useEffectiveRole).mockReturnValue({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() });
  });

  it('a pointer open plays the house pop and is switched off under reduced motion', () => {
    const popup = openMenu(1);
    expect(popup).toHaveClass('menu-pop-anim', 'motion-reduce:animate-none');
    expect(popup).not.toHaveAttribute('data-instant');
  });

  it('a keyboard open (click detail 0) appears instantly', () => {
    expect(openMenu(0)).toHaveAttribute('data-instant');
  });
});
