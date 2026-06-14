import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * AC-JR-W4-05: User-facing "Opportunity" renamed to "Project" in SalesPipeline table
 * column header.
 *
 * The old header text "Opportunity" must be gone; "Project" must be present as a
 * column header. The internal symbol name `key:'opp'` stays stable (e2e/export-safe).
 */

const { pipelineState, lostState } = vi.hoisted(() => ({
  pipelineState: {
    data: {
      stages: [
        {
          status: 'Tender Submitted',
          count: 1,
          total_value: 1200000,
          win_probability: 0.5,
          weighted_value: 600000,
        },
      ],
      projects: [
        {
          id: 'p1',
          name: 'Northwind Rollout',
          client_name: 'Northwind',
          status: 'Tender Submitted',
          contract_value: 1200000,
          win_probability: 0.5,
        },
      ],
    },
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

// Force table view to expose the column header.
vi.mock('@/src/hooks/usePipelineView', () => ({
  usePipelineView: () => ['table', vi.fn()] as ['table', ReturnType<typeof vi.fn>],
}));

import SalesPipeline from '../../pages/SalesPipeline';

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
  pipelineState.data = {
    stages: [
      {
        status: 'Tender Submitted',
        count: 1,
        total_value: 1200000,
        win_probability: 0.5,
        weighted_value: 600000,
      },
    ],
    projects: [
      {
        id: 'p1',
        name: 'Northwind Rollout',
        client_name: 'Northwind',
        status: 'Tender Submitted',
        contract_value: 1200000,
        win_probability: 0.5,
      },
    ],
  };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
});

describe('AC-JR-W4-05: SalesPipeline table column header noun', () => {
  it('AC-JR-W4-05: the table column header reads "Project", not "Opportunity"', async () => {
    renderPage();
    // Column header must be "Project"
    expect(
      screen.getByRole('columnheader', { name: 'Project' }),
    ).toBeInTheDocument();
    // "Opportunity" must NOT appear as a column header
    expect(
      screen.queryByRole('columnheader', { name: 'Opportunity' }),
    ).not.toBeInTheDocument();
  });

  it('AC-JR-W4-05: switching to Table view shows the "Project" column header with deal name cell', async () => {
    // This also exercises the switch from whatever view to table, but since we mock
    // usePipelineView to return 'table', it renders in table mode directly.
    renderPage();
    const header = screen.getByRole('columnheader', { name: 'Project' });
    expect(header).toBeInTheDocument();
    // The deal name still appears in the cell
    expect(screen.getByText('Northwind Rollout')).toBeInTheDocument();
  });
});
