/**
 * S4 regression tests — AC-2 scrollable status filter + A-MIN-1 hide no-op view toggle on mobile.
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
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

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

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: 'p1', name: 'Alpha Project', code: 'PRJ-001', status: 'Ongoing Project',
      client_id: 'c1', project_manager_id: 'u-alice', contract_value: 1000000, budget: 900000,
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
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── Procurement page stubs ───────────────────────────────────────────────────
const procState = {
  data: [{ id: 'pc1', code: 'PROC-001', title: 'Workstations', status: 'Open',
    total_value: 10000, project_id: 'p1', requested_by_id: 'u-alice',
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
import Incidents from '../Incidents';

const renderProjects = () =>
  render(
    <MemoryRouter><ToastProvider><Projects /></ToastProvider></MemoryRouter>,
  );

const renderProcurement = () =>
  render(
    <ToastProvider><MemoryRouter><Procurement /></MemoryRouter></ToastProvider>,
  );

const renderIncidents = () =>
  render(
    <MemoryRouter><ToastProvider><Incidents /></ToastProvider></MemoryRouter>,
  );

// ── AC-2: status filter scroll container ─────────────────────────────────────
describe('AC-2: status filter is wrapped in an overflow-x-auto scroll container', () => {
  beforeEach(() => sessionStorage.clear());

  it('Projects: status-filter tablist sits inside an overflow-x-auto container (AC-2)', () => {
    renderProjects();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    // The tablist must be inside a scrollable wrapper to prevent clipping at 390px.
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper).toBeInTheDocument();
    expect(scrollWrapper!.className).toContain('overflow-x-auto');
  });

  it('Projects: the scroll container also carries the scroll-fade-x edge-fade class (AC-2)', () => {
    renderProjects();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper!.className).toContain('scroll-fade-x');
  });

  it('Procurement: status-filter tablist sits inside an overflow-x-auto container (AC-2)', () => {
    renderProcurement();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper).toBeInTheDocument();
    expect(scrollWrapper!.className).toContain('overflow-x-auto');
  });

  it('Incidents: status-filter tablist sits inside an overflow-x-auto container (AC-2)', () => {
    renderIncidents();
    const statusFilter = screen.getByRole('tablist', { name: /filter by status/i });
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper).toBeInTheDocument();
    expect(scrollWrapper!.className).toContain('overflow-x-auto');
  });
});

// ── A-MIN-1: Table/Cards view toggle hidden below md ─────────────────────────
describe('A-MIN-1: Table/Cards view toggle is hidden below md (desktop-only)', () => {
  beforeEach(() => sessionStorage.clear());

  it('Projects (A-MIN-1 updated, AC-MOB-VT): Table option is hidden via a wrapper element, not via a class on the button itself', () => {
    renderProjects();
    const viewToggle = screen.getByRole('tablist', { name: /projects view/i });
    // After the AC-MOB-VT round-2 fix, the *entire* toggle is always visible (Calendar +
    // Kanban need to be reachable on mobile). Only the Table option is hidden below md.
    // The tablist itself is NOT wrapped in a hidden container.
    const toggleParent = viewToggle.parentElement;
    expect(toggleParent).not.toBeNull();
    expect(toggleParent!.className).not.toContain('hidden');

    // The Table tab button must NOT carry 'hidden' directly on itself —
    // that conflicts with the base `inline-flex` class in ViewToggle (clsx-only cn means
    // both classes land and `inline-flex` wins at runtime, so the option stays visible).
    const tableTab = Array.from(viewToggle.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.trim() === 'Table',
    ) as HTMLElement | undefined;
    expect(tableTab).toBeDefined();
    expect(tableTab!.className).not.toContain('hidden');

    // Instead, the Table button must sit inside a wrapper element (between the button
    // and the tablist) that carries 'hidden' + a 'md:' restore class.
    // A wrapper with no competing display utility is the only safe hide given clsx-only cn.
    const wrapperEl = tableTab!.parentElement;
    expect(wrapperEl).not.toBeNull();
    expect(wrapperEl).not.toBe(viewToggle); // wrapper is NOT the tablist itself
    const wrapperCls = wrapperEl!.className;
    expect(wrapperCls).toContain('hidden');
    const hasMdRestore = wrapperCls.includes('md:inline-flex') || wrapperCls.includes('md:flex') || wrapperCls.includes('md:block');
    expect(hasMdRestore).toBe(true);
  });

  it('Projects: the status-filter tablist wrapper does NOT carry hidden (A-MIN-1 negative)', () => {
    renderProjects();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    // The status filter scroll container must NOT be hidden on mobile.
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper!.className).not.toContain('hidden');
  });

  it('Procurement: the "Procurement view" tablist is inside a hidden/md:block wrapper (A-MIN-1)', () => {
    renderProcurement();
    const viewToggle = screen.getByRole('tablist', { name: /procurement view/i });
    const wrapper = viewToggle.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain('hidden');
    expect(wrapper!.className).toMatch(/md:block|md:contents/);
  });

  it('Procurement: the status-filter tablist wrapper does NOT carry hidden (A-MIN-1 negative)', () => {
    renderProcurement();
    const statusFilter = screen.getByRole('tablist', { name: /status filter/i });
    const scrollWrapper = statusFilter.closest('[data-testid="status-filter-scroll"]');
    expect(scrollWrapper!.className).not.toContain('hidden');
  });
});
