import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider, type Column } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { buildExportRows } from '@/src/lib/export';
import type { PipelineProject } from '@/src/lib/db/dashboard';

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
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx, busy: false }),
}));

vi.mock('react-router', async (orig) => {
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

// A populated pipeline so the live Export button is enabled. The list is deliberately
// MIXED-currency (USD + IDR deals in the SAME list) so a test can tell each record's OWN
// currency from a hardcoded default — the exact blind spot that produced issue #530 item 3.
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
          currency: 'USD',
          win_probability: 0.5,
        },
        {
          id: 'sp2',
          name: 'Deal 2',
          client_name: 'Client B',
          status: 'Proposal',
          contract_value: 1234,
          currency: 'IDR',
          win_probability: 0.25,
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

  it('AC-L10N-052: mixed-currency pipeline export carries each ISO code and bare numeric amounts', () => {
    exportXlsx.mockClear();
    renderAs('Project Manager');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    // The real useExport path calls buildExportRows(rows, columns, entity) internally; assert
    // on the same projection so the exported workbook cells are what we verify.
    expect(exportXlsx).toHaveBeenCalledTimes(1);
    const [rows, columns, entity] = exportXlsx.mock.calls[0] as [
      PipelineProject[],
      Column<PipelineProject>[],
      string,
    ];
    expect(entity).toBe('Pipeline');

    const { header, body } = buildExportRows(rows, columns);
    expect(header).toEqual([
      'Project',
      'Customer',
      'Stage',
      'Value',
      'Currency',
      'Weighted',
      'Win %',
      'Owner',
      'Last touch',
    ]);
    // Currency sits immediately after Value and immediately before Weighted.
    expect(header.indexOf('Currency')).toBe(4);

    const byProject = new Map(
      (body as (string | number)[][]).map((row) => [row[0], row]),
    );

    const usd = byProject.get('Deal 1') as (string | number)[];
    expect(usd).toBeDefined();
    expect(usd[4]).toBe('USD');
    expect(usd[3]).toBe(10000);
    expect(typeof usd[3]).toBe('number');
    expect(usd[5]).toBe(5000);
    expect(typeof usd[5]).toBe('number');

    const idr = byProject.get('Deal 2') as (string | number)[];
    expect(idr).toBeDefined();
    expect(idr[4]).toBe('IDR');
    expect(idr[3]).toBe(1234);
    expect(typeof idr[3]).toBe('number');
    expect(idr[5]).toBe(308.5);
    expect(typeof idr[5]).toBe('number');
  });
});
