import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * W2-4g — Projects delivery cells distinguish error from loading.
 * AC-W2-4-07: when useProjectsDeliverySummary errors, cells show "—" not "…"
 *              ("…" must mean loading only, not error).
 */

const projectRow = {
  id: 'proj-1',
  org_id: 'org-1',
  name: 'Test Project',
  status: 'Ongoing Project',
  contract_value: 1000000,
  budget: 800000,
  spent: 0,
  project_manager_id: 'pm-1',
  client_id: null,
  client: { name: 'ACME Corp' },
  pm: { full_name: 'Alice PM' },
  last_update: null,
  archived_at: null,
};

const { deliveryState } = vi.hoisted(() => ({
  deliveryState: {
    data: undefined as Record<string, unknown> | undefined,
    isPending: false,
    isError: true,
  },
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [projectRow],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => deliveryState,
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()],
}));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  ImpersonationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

import Projects from '../Projects';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  deliveryState.data = undefined;
  deliveryState.isPending = false;
  deliveryState.isError = true;
});

describe('Projects — delivery cell error state (AC-W2-4-07)', () => {
  it('AC-W2-4-07: shows "—" (not "…") in Actual/Progress/Budget-used cells on delivery error', () => {
    renderPage();

    // "…" must mean loading only — on error it should be "—"
    // There should be no "…" cells when delivery is in error (not pending)
    expect(screen.queryByText('…')).toBeNull();
  });

  it('AC-W2-4-07: shows "…" when delivery is pending (loading), not "—"', () => {
    deliveryState.isError = false;
    deliveryState.isPending = true;

    renderPage();

    // Loading state should show "…"
    const loadingCells = screen.getAllByText('…');
    expect(loadingCells.length).toBeGreaterThan(0);
  });
});
