import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

/**
 * Fix #5 — Procurement list: rows must support inline expand/preview
 * (asymmetry with /approvals which already has ProcurementApprovalRow expansion).
 *
 * AC-FIX5-PREVIEW-01: each table row has a disclosure (expand) toggle button.
 * AC-FIX5-PREVIEW-02: clicking the toggle reveals the row's detail preview in place.
 * AC-FIX5-PREVIEW-03: the detail preview contains a "View full request" link to /procurement/:id.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { procState, detailState } = vi.hoisted(() => ({
  procState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  detailState: {
    data: null as Record<string, unknown> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => detailState,
  useProcurementMutations: () => ({
    transition: { mutate: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' }, role: 'Admin' }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

// Mock DecisionSupportPanel (needs project data — irrelevant to this test)
vi.mock('@/pages/procurement/DecisionSupportPanel', () => ({
  DecisionSupportPanel: () => <div data-testid="decision-support-panel">Budget impact</div>,
}));

import ProcurementPage from '../Procurement';

const PROC_ROW = {
  id: 'pr-1',
  code: 'PR-0001',
  title: 'Steel Beams Supply',
  status: 'Requested',
  total_value: 50000, currency: 'USD',
  created_at: '2026-06-01T00:00:00Z',
  requested_by_id: 'u1',
  project: { name: 'Tower Build', code: 'TB-01' },
  requested_by: { full_name: 'Alice Engineer' },
  vendor: null,
  items: [],
};

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/procurement']}>
        <ProcurementPage />
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  procState.data = [PROC_ROW];
  procState.isPending = false;
  procState.isError = false;
  detailState.data = null;
  detailState.isPending = false;
  detailState.isError = false;
});

describe('Procurement list — inline preview (fix #5)', () => {
  it('UIP-007: linked project identities wrap within their column and lifecycle stays below status', () => {
    procState.data = [{ ...PROC_ROW, project_id: 'proj-1' }];
    const { container } = renderPage();
    const project = screen.getByRole('link', { name: /Open Tower Build/ });
    expect(project.className).toContain('whitespace-normal');
    const lifecycle = container.querySelector('[aria-label^="Lifecycle:"]');
    expect(lifecycle?.parentElement?.className).toContain('block');
  });
  it('UIP-007: mixed rows use one comparative grid and retain labelled phone fields', () => {
    procState.data = [PROC_ROW, { ...PROC_ROW, id: 'pr-2', title: 'Cable supply for the extended site commissioning works', total_value: 9800, project: null, requested_by: null }];
    const { container } = renderPage();
    const header = screen.getByTestId('procurement-list-columns');
    const rows = container.querySelectorAll('[data-row-activate]');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.className).toContain('md:grid-cols-12');
      expect(header.className).toContain('md:grid-cols-12');
      const value = row.querySelector('[data-procurement-value]');
      expect(value?.className).toContain('md:text-right');
      expect(value?.className).toContain('tabular');
      expect(row).toHaveTextContent(/Project.*Requester.*Value.*Age.*Status/);
    }
    expect(screen.getByRole('link', { name: 'Cable supply for the extended site commissioning works' }).className).not.toContain('truncate');
  });
  it('AC-FIX5-PREVIEW-01: each table row has an expand toggle button', () => {
    renderPage();
    const toggles = screen.getAllByRole('button', { name: /show.*preview|expand|preview/i });
    expect(toggles.length).toBeGreaterThan(0);
  });

  it('AC-FIX5-PREVIEW-02: clicking the toggle reveals the row detail panel in place', async () => {
    detailState.data = {
      ...PROC_ROW,
      project_id: 'proj-1',
      items: [],
    };
    const user = userEvent.setup();
    renderPage();
    const toggle = screen.getAllByRole('button', { name: /show.*preview|expand|preview/i })[0];
    await user.click(toggle);
    // After toggle, the expanded panel should be visible
    expect(screen.getByRole('region', { name: /preview/i })).toBeInTheDocument();
  });

  it('AC-FIX5-PREVIEW-03: the detail preview has a "View full request" link to /procurement/:id', async () => {
    detailState.data = {
      ...PROC_ROW,
      project_id: 'proj-1',
      items: [],
    };
    const user = userEvent.setup();
    renderPage();
    const toggle = screen.getAllByRole('button', { name: /show.*preview|expand|preview/i })[0];
    await user.click(toggle);
    const link = screen.getByRole('link', { name: /view full request/i });
    expect(link).toHaveAttribute('href', '/procurement/pr-1');
  });
});
