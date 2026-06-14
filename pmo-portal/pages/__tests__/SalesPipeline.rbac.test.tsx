import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * A-4 Sales Pipeline page view-gate (AC-W2-RBAC-008, rbac-visibility §C):
 *   Sales Pipeline = Admin·Exec·PM·Finance view; Engineer = ○ (no nav, no page). The rail
 *   already hides it; the ROUTE does not — so an Engineer typing /sales (or via a stale link)
 *   must land on a clean access-denied surface with a way back, NOT the pipeline board.
 *
 * Two-sided: PM (authorized) sees the board; Engineer (denied) sees the denied region + Back.
 */
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: { stages: [], projects: [{ id: 'o1', name: 'Acme Tender', status: 'Tender Submitted', client_name: 'Acme', contract_value: 1000, win_probability: 0.5 }] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  lostState: { data: [] as unknown[] },
}));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
}));
vi.mock('@/src/hooks/usePipelineView', () => ({ usePipelineView: () => ['kanban', vi.fn()] }));
// B-3: SalesPipeline now includes the "+ New opportunity" CTA (useProjectMutations). Stub to
// avoid the QueryClientProvider requirement. Also mock useAuth for usePermission.
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import SalesPipeline from '../../pages/SalesPipeline';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  navigate.mockClear();
  pipelineState.isPending = false;
  pipelineState.isError = false;
});

describe('SalesPipeline — Engineer page view-gate (A-4)', () => {
  it('AC-W2-RBAC-008: a PM sees the pipeline board (authorized)', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    // The board content (the Acme deal) renders.
    expect(screen.getByText('Acme Tender')).toBeInTheDocument();
  });

  it('AC-W2-RBAC-008: an Engineer sees an access-denied surface with a way back, not the board', () => {
    renderAs('Engineer');
    // The board is absent.
    expect(screen.queryByText('Acme Tender')).not.toBeInTheDocument();
    // A titled denied region with a keyboard-reachable Back action renders.
    expect(
      screen.getByRole('region', { name: /don't have access to the sales pipeline/i }),
    ).toBeInTheDocument();
    const back = screen.getByRole('button', { name: /back to dashboard/i });
    expect(back).toBeInTheDocument();
    back.focus();
    expect(back).toHaveFocus();
  });
});
