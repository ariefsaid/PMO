import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * AC-EXP-008 (W1-E / B-5): Sales Pipeline Export is now a LIVE xlsx download of the
 * current table view. The dishonest disabled "arrives with Reports" stub has been
 * replaced with the shared <ExportButton>.
 *
 * Per the CLAUDE.md authoring rule this is a deliberate UX change: the goal (Export is
 * reachable and honest) is unchanged; the journey step changed (live button, not a
 * disabled-with-tooltip stub). The stub text must be PROVABLY GONE, not merely
 * superseded.
 */

// useExport is the only seam the button calls; stub it so no real download fires.
const exportXlsx = vi.fn();
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx, busy: false }),
}));

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/src/hooks/usePipelineView', () => ({ usePipelineView: () => ['table', vi.fn()] }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

// A populated pipeline so the live Export button is enabled.
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: {
      stages: [],
      projects: [
        {
          id: 'sp1',
          name: 'Deal 1',
          client_name: 'Client A',
          status: 'Qualified',
          contract_value: 10000,
          win_probability: 0.5,
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useLostDeals: () => ({ data: [] }),
}));

import SalesPipeline from '../SalesPipeline';

const renderAs = (role: 'Project Manager' | 'Finance') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('SalesPipeline — live Export (AC-EXP-008)', () => {
  it('AC-EXP-008: shows a live (enabled) Export and the "arrives with Reports" stub is gone', () => {
    renderAs('Project Manager');
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeEnabled();
    // The dishonest dead-affordance copy must be PROVABLY absent.
    expect(screen.queryByText(/arrives with the reports module/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/arrives with reports/i)).not.toBeInTheDocument();
  });

  it('AC-EXP-008: Export remains reachable for the Finance role', () => {
    renderAs('Finance');
    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled();
  });
});
