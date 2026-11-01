import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
// Harness: the board now mounts DraggableSalesBoard (useQueryClient), so the page renders under a QueryClientProvider (#1637).
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider, type Column } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { PipelineProject } from '@/src/lib/db/dashboard';

/**
 * PGA05-007 regression test:
 * Desktop board export uses kanbanFiltered (open ∪ won ∪ lost),
 * while table view uses filtered (scoped).
 */

const exportXlsx = vi.fn();
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx, busy: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

const openProjects = [
  { id: 'op1', name: 'Open Deal 1', status: 'Leads', contract_value: 10000, currency: 'USD', win_probability: 0.1 },
];
const wonProjects = [
  { id: 'wp1', name: 'Won Project 1', status: 'Won, Pending KoM', contract_value: 50000, currency: 'USD', win_probability: 1.0 },
];
const lostProjects = [
  { id: 'lp1', name: 'Lost Project 1', status: 'Loss Tender', contract_value: 20000, currency: 'USD', win_probability: 0 },
];

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: { stages: [], projects: openProjects },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useWonDeals: () => ({ data: wonProjects, isPending: false, isError: false, refetch: vi.fn() }),
  useLostDeals: () => ({ data: lostProjects, isPending: false, isError: false, refetch: vi.fn() }),
}));

import SalesPipeline from '../SalesPipeline';

const renderAt = (url: string) =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  exportXlsx.mockClear();
});

describe('SalesPipeline — PGA05-007: active presentation export selection', () => {
  it('exports all board cards (open, won, and lost) when exporting from desktop board', () => {
    renderAt('/sales?view=kanban');

    const exportBtn = screen.getByRole('button', { name: /export/i });
    fireEvent.click(exportBtn);

    expect(exportXlsx).toHaveBeenCalledTimes(1);
    const [rows] = exportXlsx.mock.calls[0] as [PipelineProject[], Column<PipelineProject>[], string];
    const exportedIds = rows.map((r) => r.id);
    expect(exportedIds).toContain('op1');
    expect(exportedIds).toContain('wp1');
    expect(exportedIds).toContain('lp1');
    expect(rows.length).toBe(3);
  });

  it('exports only scoped rows when exporting from table view', () => {
    renderAt('/sales?view=table&scope=Open');

    const exportBtn = screen.getByRole('button', { name: /export/i });
    fireEvent.click(exportBtn);

    expect(exportXlsx).toHaveBeenCalledTimes(1);
    const [rows] = exportXlsx.mock.calls[0] as [PipelineProject[], Column<PipelineProject>[], string];
    const exportedIds = rows.map((r) => r.id);
    expect(exportedIds).toContain('op1');
    expect(exportedIds).not.toContain('wp1');
    expect(exportedIds).not.toContain('lp1');
    expect(rows.length).toBe(1);
  });
});
