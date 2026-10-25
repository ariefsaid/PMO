import { beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const { exportXlsx, lostState, viewport } = vi.hoisted(() => ({
  exportXlsx: vi.fn(),
  lostState: { data: [] as Record<string, unknown>[] },
  viewport: { isDesktop: true },
}));
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => viewport.isDesktop }));
vi.mock('@/src/components/export/useExport', () => ({
  useExport: () => ({ exportXlsx, busy: false }),
}));

vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

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
          name: 'Contractual Deal 1',
          short_name: 'Short Deal 1',
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
  useLostDeals: () => ({ data: lostState.data, isPending: false, isError: false, refetch: vi.fn() }),
}));

import SalesPipeline from '../SalesPipeline';

const renderAs = (role: 'Project Manager' | 'Finance', path = '/sales') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  lostState.data = [];
  viewport.isDesktop = true;
  exportXlsx.mockClear();
});

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
      'Customer / end customer',
      'End customer',
      'Owner',
      'Stage',
      'Last activity',
      'Value',
      'Currency',
      'Win %',
      'Weighted',
    ]);
    // Per-row currency stays adjacent to the numeric value in the workbook.
    expect(header.indexOf('Currency')).toBe(7);

    const byProject = new Map(
      (body as (string | number)[][]).map((row) => [row[0], row]),
    );

    const usd = byProject.get('Contractual Deal 1') as (string | number)[];
    expect(byProject.has('Short Deal 1')).toBe(false);
    expect(usd).toBeDefined();
    expect(usd[7]).toBe('USD');
    expect(usd[6]).toBe(10000);
    expect(typeof usd[6]).toBe('number');
    expect(usd[9]).toBe(5000);
    expect(typeof usd[9]).toBe('number');

    const idr = byProject.get('Deal 2') as (string | number)[];
    expect(idr).toBeDefined();
    expect(idr[7]).toBe('IDR');
    expect(idr[6]).toBe(1234);
    expect(typeof idr[6]).toBe('number');
    expect(idr[9]).toBe(308.5);
    expect(typeof idr[9]).toBe('number');
  });

  it('AC-SALES-C01: Board, Table, and phone Export receive the displayed Lost subset', async () => {
    const user = userEvent.setup();
    lostState.data = [{ id: 'lost-1', name: 'Lost Terminal Project', client_name: 'Customer C', status: 'Loss Tender', contract_value: 4321, currency: 'IDR', tax_treatment: null, win_probability: 0 }];
    renderAs('Project Manager', '/sales?view=kanban&scope=Lost');
    expect(screen.getByText('Lost Terminal Project')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    let [rows] = exportXlsx.mock.calls.at(-1) as [PipelineProject[], Column<PipelineProject>[], string];
    expect(rows.map((row) => row.id)).toEqual(['lost-1']);

    await user.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByText('Lost Terminal Project')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    [rows] = exportXlsx.mock.calls.at(-1) as [PipelineProject[], Column<PipelineProject>[], string];
    expect(rows.map((row) => row.id)).toEqual(['lost-1']);

    cleanup();
    viewport.isDesktop = false;
    renderAs('Project Manager', '/sales?view=kanban&scope=Lost');
    await user.click(screen.getByText('More actions'));
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    [rows] = exportXlsx.mock.calls.at(-1) as [PipelineProject[], Column<PipelineProject>[], string];
    expect(rows.map((row) => row.id)).toEqual(['lost-1']);
  });
});
