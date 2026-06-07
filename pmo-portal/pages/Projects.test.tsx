import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Projects from './Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
    spent: 2100000, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p2', name: 'Northwind ERP Rollout', code: 'PRJ-002', status: 'Tender Submitted',
    client_id: 'c3', project_manager_id: 'u-alice', contract_value: 1200000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Northwind Manufacturing' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p3', name: 'Regional Services Program', code: 'PRJ-003', status: 'PQ Submitted',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 800000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
];

// Won project with customer_contract_ref set (for AC-1011 UI test)
const seedWithWon = [
  ...seed,
  { id: 'p4', name: 'Won Deal', code: 'PRJ-004', status: 'Won, Pending KoM',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 2000000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: 'CPO-2026-999', contract_date: '2026-01-15', decided_at: '2026-01-15T00:00:00Z' },
];

const projectsState = { data: seed as unknown as ProjectWithRefs[], isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
const navigate = vi.fn();
// Tabs are gone — row drill is a plain react-router navigate (AC-NAV-006).
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

// Projects rows embed ProjectStatusControl, which uses useToast — needs a provider.
const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('Projects index — IA-3 (real data)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    navigate.mockClear();
  });

  it('renders seeded projects with joined client + PM names (AC-401)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alice Manager').length).toBeGreaterThan(0);
  });

  it('defaults to the Table view and the toggle switches to Cards (AC-A)', async () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    expect(within(toggle).getByRole('tab', { name: /Table/i })).toHaveAttribute('aria-selected', 'true');
    // No project-card carriers in Table view
    expect(screen.queryAllByTestId('project-card').length).toBe(0);
    await userEvent.click(within(toggle).getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
  });

  it('renders status as a StatusPill (dot + text), not a legacy badge (AC-C)', () => {
    renderPage();
    const pill = screen.getAllByText('Ongoing Project')[0];
    // The StatusPill carries a 6px dot sibling (color-not-only).
    expect(pill.querySelector('[data-pill-dot]')).not.toBeNull();
  });

  it('AC-NAV-006: navigates to the project detail route when a row is activated (no tab)', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Innovate Corp HQ Fit-Out'));
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });

  it('filters to Leads via the status SegFilter (AC-403)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Leads/ }));
    expect(screen.getByText('Regional Services Program')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
  });

  it('filters by search (AC-404)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search projects/i), 'Northwind');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
  });

  it('"My Projects" uses the real profile id (AC-402)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /My Projects/ }));
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument(); // u-alice manages all
  });
});

describe('Projects index states', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('shows loading state while pending (AC-405)', () => {
    projectsState.isPending = true; projectsState.isError = false;
    renderPage();
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
  });

  it('shows error state with retry on failure (AC-408)', () => {
    projectsState.isError = true; projectsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('C3: shows the teaching empty state with NO dead New Project CTA when zero rows (AC-406)', () => {
    projectsState.data = [];
    renderPage();
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    // C3: no disabled "New Project" button anywhere (header CTA removed + the
    // page-empty state teaches via its sub copy, not a dead button).
    expect(screen.queryByRole('button', { name: /New Project/i })).toBeNull();
  });

  it('C3: the page header is not anchored by a disabled New Project CTA', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Project/i })).toBeNull();
  });

  it('shows a filter-no-match empty state with a clear-filters action (AC-D)', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/Search projects/i), 'zzzz-no-match');
    expect(screen.getByText(/No projects match/i)).toBeInTheDocument();
    // the LIVE "Clear filters" action is kept (it actually does something).
    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();
  });
});

describe('Projects table — compact layout (#1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('#1: PM column avatar is 18px (compact) — not 22px — to fit at 1180px', () => {
    renderPage();
    // Find the PM avatar in the table tbody (has single-letter initial, size-[18px])
    const tableBody = document.querySelector('tbody');
    const pmCells = tableBody?.querySelectorAll('td');
    const pmAvatar = Array.from(pmCells ?? [])
      .flatMap(td => Array.from(td.querySelectorAll('[aria-hidden="true"]')))
      .find(el => el.className.includes('rounded-full') && el.className.includes('size-[18px]'));
    expect(pmAvatar).toBeTruthy();
  });

  it('#1: Progress column cell uses compact ProgressBar (min-w-[80px] wrapper) to fit narrow columns', () => {
    renderPage();
    // The progressbar role should be in the table and have a compact constrained wrapper
    const progressbars = screen.getAllByRole('progressbar');
    expect(progressbars.length).toBeGreaterThan(0);
    // The outer wrapper span should have min-w-[80px] (compact mode)
    const bar = progressbars[0];
    const wrapper = bar.closest('span')?.parentElement;
    expect(wrapper).toBeTruthy();
    // The outermost span container should use compact sizing (min-w-[80px])
    const outerSpan = bar.closest('span[class*="min-w-[80px]"]') ??
      bar.parentElement?.closest('span[class*="min-w-[80px]"]');
    expect(outerSpan).not.toBeNull();
  });

  it('M-D: PM name renders in full and wraps — no tight max-w-[10ch] truncation', () => {
    renderPage();
    // Scope to the table body (the toolbar PM filter <select> also lists the name).
    const tbody = document.querySelector('tbody')!;
    const pmName = within(tbody as HTMLElement)
      .getAllByText('Alice Manager')
      .find((el) => el.tagName === 'SPAN')!;
    expect(pmName).toBeTruthy();
    // The name span allows wrapping (whitespace-normal) rather than truncating.
    expect(pmName.className).toContain('whitespace-normal');
    expect(pmName.className).not.toContain('truncate');
    expect(pmName.className).not.toContain('max-w-[10ch]');
  });
});

describe('ProjectStatusControl integration (AC-1011 UI)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-1011 (UI): the default Table view renders a ProjectStatusControl per row and shows the customer contract reference (FR-PR-011)', () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    const controls = screen.getAllByTestId('project-status-control');
    expect(controls.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CPO-2026-999')).toBeInTheDocument();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });

  it('AC-1011 (UI): the Cards view also renders the status control + ref (win flow reachable from both views)', async () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
    expect(screen.getAllByTestId('project-card').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('project-status-control').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CPO-2026-999')).toBeInTheDocument();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });
});
