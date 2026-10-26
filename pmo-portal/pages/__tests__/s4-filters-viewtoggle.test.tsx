/**
 * S4 regression tests — shared status-filter scrolling and Projects' selectable views.
 *
 * AC-2:  The status-filter segmented control is wrapped in an overflow-x-auto container so that
 *        every segment (including "At risk", "Vendor Invoiced", etc.) is reachable at 390px.
 *        The scroll container carries `overflow-x-auto` so no segment is clipped in non-scrolling
 *        overflow. (jsdom has no layout — we assert the class on the DOM element.)
 *
 * A-MIN-1: Below md (768px), DataTable force-renders cards (no table is possible), so the
 *          Table/Cards view toggle is a state-lie on mobile. The toggle must be hidden below md
 *          (`hidden md:inline-flex`) while the status filter stays always visible.
 *
 * Coverage: Projects, Procurement, Incidents pages (all three ship a status ViewToggle).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { readProjectView } from '@/src/hooks/useProjectView';

// ── Projects page stubs ──────────────────────────────────────────────────────
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const { roleBox, projectMutations, deliverySummaryState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  deliverySummaryState: {
    p1: { deliveryPct: 50, committedSpend: 2_100_000, budget: 4_700_000 },
  },
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useErpPurchases', () => ({ useErpPurchases: () => ({ data: [] }), useHasErpPurchases: () => ({ data: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'p1', name: 'Alpha Project', code: 'PRJ-001', status: 'Ongoing Project',
      client_id: 'c1', project_manager_id: 'u-alice', contract_value: 1000000, currency: 'USD', budget: 900000,
      spent: 500000, end_date: '2026-12-31', client: { name: 'Client A' },
      pm: { full_name: 'Alice Manager' }, customer_contract_ref: null,
      contract_date: null, decided_at: null }] as unknown as ProjectWithRefs[],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => projectMutations,
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: roleBox.value, realRole: roleBox.value,
    canImpersonate: false, viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── Procurement page stubs ───────────────────────────────────────────────────
const procState = {
  data: [{ id: 'pc1', code: 'PROC-001', title: 'Workstations', status: 'Open',
    total_value: 10000, currency: 'USD', project_id: 'p1', requested_by_id: 'u-alice',
    vendor_id: null, created_at: '2026-01-01T00:00:00Z',
    project: { name: 'Alpha Project', code: 'PRJ-001' },
    vendor: null, requested_by: { full_name: 'Alice Manager' } }],
  isPending: false, isError: false, refetch: vi.fn(),
};
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// ── Incidents page stubs ─────────────────────────────────────────────────────
const incState = {
  data: [{ id: 'i1', org_id: 'org-1', incident_date: '2026-03-15', type: 'Near Miss',
    severity: 'Low', location: 'Site B', description: 'Trip hazard', status: 'Open',
    reported_by: 'u1', created_at: '2026-03-15T00:00:00Z' }],
  isPending: false, isError: false, refetch: vi.fn(),
};
vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidents: () => incState,
  useIncidentMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

// ── Page imports (after mocks) ───────────────────────────────────────────────
import Projects from '../Projects';
import Procurement from '../Procurement';
import { readProcurementView } from '@/src/hooks/useProcurementView';

const renderProjects = () =>
  render(
    <MemoryRouter><ToastProvider><Projects /></ToastProvider></MemoryRouter>,
  );

const renderProcurement = () =>
  render(
    <ToastProvider><MemoryRouter><Procurement /></MemoryRouter></ToastProvider>,
  );

// ── AC-2: shared status filter scroll container ──────────────────────────────
describe('AC-2: status filter is wrapped in an overflow-x-auto scroll container', () => {
  beforeEach(() => sessionStorage.clear());

  it('Procurement: status-filter tablist sits inside an overflow-x-auto container (AC-2)', () => {
    renderProcurement();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper).toBeInTheDocument();
    expect(scrollWrapper!.className).toContain('overflow-x-auto');
  });

  it('Procurement: the status-filter tablist wrapper does NOT carry hidden (A-MIN-1 negative)', () => {
    renderProcurement();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper!.className).not.toContain('hidden');
  });

  // Incidents filters now wrap; selection and URL behavior is covered by Incidents.test.tsx.
});

// ── AC-MOB-VT: Projects keeps all four view choices reachable on a phone ────
describe('AC-MOB-VT: Projects keeps every view selectable below md', () => {
  beforeEach(() => sessionStorage.clear());

  it('Projects exposes and persists all four views on a phone', async () => {
    renderProjects();
    const view = screen.getByRole('combobox', { name: 'View' });
    expect(Array.from((view as HTMLSelectElement).options).map((option) => [option.value, option.textContent]))
      .toEqual([['table', 'Table'], ['cards', 'Cards'], ['kanban', 'Board'], ['calendar', 'Calendar']]);
    expect(readProjectView()).toBe('table');
    for (const choice of ['cards', 'kanban', 'calendar', 'table']) {
      fireEvent.change(view, { target: { value: choice } });
      expect(readProjectView()).toBe(choice);
    }
  });

  it('Procurement (A-MIN-1 superseded by #715, AC-PVT-001): the view toggle is present and operable below md (no hidden wrapper)', () => {
    renderProcurement();
    const viewToggle = screen.getByRole('tablist', { name: /procurement view/i });
    // #715: a phone user must be able to leave the last-used view, so neither the tablist's
    // wrapper nor any ancestor up to the page carries `hidden`.
    for (let el: HTMLElement | null = viewToggle; el && el !== document.body; el = el.parentElement) {
      expect(el.className, `${el.tagName} must not hide the toggle`).not.toMatch(/(^|\s|:)hidden(\s|$)/);
    }
    const tabs = Array.from(viewToggle.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Table', 'Board']);
    // Operable: clicking Board reaches the page's view handler, which persists the choice (this
    // file stubs useNavigate, so the URL flip itself is owned by e2e AC-PVT-001).
    expect(readProcurementView()).toBe('table');
    fireEvent.click(tabs[1]);
    expect(readProcurementView()).toBe('board');
  });

});
