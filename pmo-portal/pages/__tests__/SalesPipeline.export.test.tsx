import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * B-5 (AC-W2-IXD-008 / W1-E): Sales Pipeline Export is now a LIVE xlsx download
 * of the current table view (KANNA W1-E). The disabled "arrives with Reports" stub
 * has been replaced with the shared ExportButton.
 *
 * Updated from the prior dead-affordance honesty test: the goal (Export is reachable
 * and honest) is unchanged, but the journey step changed — the button is now live,
 * not disabled-with-tooltip (deliberate UX change per the CLAUDE.md authoring rule).
 */

vi.mock('@/src/lib/export/exportToXlsx', () => ({
  exportToXlsx: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// Empty pipeline — tests the disabled state.
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useLostDeals: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/usePipelineView', () => ({ usePipelineView: () => ['table', vi.fn()] }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
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

describe('SalesPipeline — Export live button (B-5 / W1-E, AC-W2-IXD-008)', () => {
  it('AC-W2-IXD-008: Export button is present (no longer the disabled Reports stub)', () => {
    renderAs('Project Manager');
    // The Export button is present — it is now a real ExportButton, not a Tooltip-wrapped stub.
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
  });

  it('AC-W2-IXD-008: Export button is disabled when there are no rows (empty pipeline)', () => {
    renderAs('Project Manager');
    // The pipeline is empty (mock returns []) so the ExportButton disables itself.
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeDisabled();
  });

  it('AC-W2-IXD-008: Export is accessible to Finance role as well', () => {
    renderAs('Finance');
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
  });
});
