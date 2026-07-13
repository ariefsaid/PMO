import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Projects from './Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// project_detail_opened / filter_applied / search_used — 2026-07-13 wiring plan.
// Mirrors Projects.test.tsx's mock harness; adds the analytics facade mock.
const analytics = vi.hoisted(() => ({
  trackProjectDetailOpened: vi.fn(),
  trackFilterApplied: vi.fn(),
  trackSearchUsed: vi.fn(),
}));
vi.mock('@/src/lib/analytics', () => ({
  trackProjectDetailOpened: analytics.trackProjectDetailOpened,
  trackFilterApplied: analytics.trackFilterApplied,
  trackSearchUsed: analytics.trackSearchUsed,
}));

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
    spent: 2100000, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
];

const projectsState = { data: seed as unknown as ProjectWithRefs[], isPending: false, isError: false, refetch: vi.fn() };
const { roleBox, projectMutations, deliverySummaryState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  deliverySummaryState: { p1: { deliveryPct: 50, committedSpend: 2_100_000, budget: 4_700_000 } },
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
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
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  projectsState.data = seed as unknown as ProjectWithRefs[];
  navigate.mockClear();
  analytics.trackProjectDetailOpened.mockClear();
  analytics.trackFilterApplied.mockClear();
  analytics.trackSearchUsed.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Projects: project_detail_opened fires with a route PATTERN + source', () => {
  it('AC: activating a table row fires trackProjectDetailOpened(pattern, "list")', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Innovate Corp HQ Fit-Out'));
    expect(analytics.trackProjectDetailOpened).toHaveBeenCalledWith('/projects/:projectId', 'list');
    // never the raw id
    const call = analytics.trackProjectDetailOpened.mock.calls[0];
    expect(JSON.stringify(call)).not.toMatch(/p1/);
  });
});

describe('Projects: filter_applied fires on the status SegFilter', () => {
  it('AC: switching to Ongoing fires filter_applied with the option-set size, never the label', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /^Ongoing$/ }));
    expect(analytics.trackFilterApplied).toHaveBeenCalledWith('status', 5, 'projects');
  });
});

describe('Projects: search_used fires (debounced) at the projects search box', () => {
  it('AC: typing and going idle fires search_used with the result count', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();
    await user.type(screen.getByPlaceholderText(/Search projects/i), 'Innovate');
    vi.advanceTimersByTime(500);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('projects-list', 1, 'projects');
  });
});
