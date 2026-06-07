import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
    spent: 2100000, start_date: '2026-01-01', end_date: '2026-12-18', contract_date: '2026-01-10',
    customer_contract_ref: 'CPO-2026-001', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' } },
] as unknown as ProjectWithRefs[];

const projectsState = { data: seed, isPending: false, isError: false, refetch: vi.fn() };
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => projectsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager' }) }));
// Budget tab mounts the real ProjectBudget — stub its data hooks to avoid network.
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetMutations: () => ({
    createVersion: { mutateAsync: vi.fn() }, activate: { mutateAsync: vi.fn() },
    archive: { mutateAsync: vi.fn() }, cloneVersion: { mutateAsync: vi.fn() },
    deleteDraft: { mutateAsync: vi.fn() }, createLineItem: { mutateAsync: vi.fn() },
    deleteLineItem: { mutateAsync: vi.fn() },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// Tabs are gone — back-nav is a plain react-router navigate (AC-NAV-007).
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/projects/:projectId/budget" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProjectDetail shell (decomposition)', () => {
  beforeEach(() => {
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
    navigate.mockClear();
  });

  it('renders the header from the real cached row and defaults to the Overview tab (AC-F/G, OQ-4)', () => {
    renderAt('/projects/p1');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: /project sections/i });
    expect(within(tabs).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    // Overview content (real): project information card
    expect(screen.getByText('Project information')).toBeInTheDocument();
  });

  it('switches to the Procurement tab and shows its real (empty) state', async () => {
    renderAt('/projects/p1');
    await userEvent.click(screen.getByRole('tab', { name: 'Procurement' }));
    expect(screen.getByText(/No purchase requests for this project yet/i)).toBeInTheDocument();
  });

  it('renders the Tasks/Documents placeholder tabs (deferred, AC-K)', async () => {
    renderAt('/projects/p1');
    await userEvent.click(screen.getByRole('tab', { name: 'Tasks' }));
    expect(screen.getByText(/Task scheduling is coming soon/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(screen.getByText(/Document management is coming soon/i)).toBeInTheDocument();
  });

  it('does NOT render a Timesheets tab (removed placeholder, tracked in backlog)', () => {
    renderAt('/projects/p1');
    const tablist = screen.getByRole('tablist', { name: /project sections/i });
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs).not.toContain('Timesheets');
  });

  it('pre-selects the Budget tab on the /budget deep-link route', () => {
    renderAt('/projects/p1/budget');
    const tabs = screen.getByRole('tablist', { name: /project sections/i });
    expect(within(tabs).getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Project Budget')).toBeInTheDocument();
  });

  it('shows a loading state on a cold deep-link before the cache resolves', () => {
    projectsState.data = undefined as unknown as ProjectWithRefs[];
    projectsState.isPending = true;
    renderAt('/projects/p1');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('I7: the success render drops the redundant in-page BackBar + Breadcrumb', () => {
    renderAt('/projects/p1');
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    // I7: the top-bar breadcrumb owns wayfinding — no in-page BackBar...
    expect(screen.queryByRole('button', { name: /Back to Projects/i })).toBeNull();
    // ...and no in-page Breadcrumb nav landmark.
    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).toBeNull();
    // the project name appears exactly once (the header), not duplicated by a crumb
    expect(screen.getAllByText('Innovate Corp HQ Fit-Out')).toHaveLength(1);
  });

  it('I7: the not-found render keeps the "Back to Projects" escape route', () => {
    projectsState.data = [];
    renderAt('/projects/does-not-exist');
    expect(screen.getByText(/Project not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Projects/i })).toBeInTheDocument();
  });

  it('AC-NAV-007: "Back to Projects" navigates to the Projects module index (no tab)', async () => {
    projectsState.data = [];
    renderAt('/projects/does-not-exist');
    await userEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(navigate).toHaveBeenCalledWith('/projects');
  });
});
