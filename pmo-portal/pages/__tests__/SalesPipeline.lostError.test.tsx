import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * W2-4e — SalesPipeline Lost scope error state.
 * AC-W2-4-05: when useLostDeals errors, selecting "Lost" shows error+retry
 *              NOT "No lost projects" (false empty).
 */

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [],
      projects: [
        {
          id: 'p1',
          name: 'Open Deal Alpha',
          client_name: 'Alpha',
          status: 'Leads',
          contract_value: 100000,
          win_probability: 0.1,
          last_update: null,
          pm_name: null,
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: {
    data: undefined as unknown[] | undefined,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/src/hooks/usePipelineView', () => ({
  usePipelineView: () => ['table', vi.fn()],
}));
vi.mock('@/src/auth/impersonation', () => ({
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));

import SalesPipeline from '../SalesPipeline';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  lostState.data = undefined;
  lostState.isError = true;
  lostState.refetch.mockClear();
});

describe('SalesPipeline — Lost scope error (AC-W2-4-05)', () => {
  it('AC-W2-4-05: shows error affordance (not "No lost projects") when lostDeals fetch errors', async () => {
    const user = userEvent.setup();
    renderPage();

    // Switch to "Lost" scope (ViewToggle renders role="tab")
    const lostBtn = screen.getByRole('tab', { name: /^Lost$/i });
    await user.click(lostBtn);

    // Should NOT show false empty
    expect(screen.queryByText(/No lost projects/i)).toBeNull();
    // Should show error state with retry
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('AC-W2-4-05: clicking Retry calls refetchLost', async () => {
    const user = userEvent.setup();
    renderPage();

    const lostBtn = screen.getByRole('tab', { name: /^Lost$/i });
    await user.click(lostBtn);

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    await user.click(retryBtn);
    expect(lostState.refetch).toHaveBeenCalled();
  });
});
