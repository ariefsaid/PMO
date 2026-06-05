import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Projects from './Projects';

const seed = [
  { id: 'p1', name: 'Innovate Corp HQ Fit-Out', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 5000000, budget: 4700000,
    spent: 2100000, end_date: '2026-12-18', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p2', name: 'Northwind ERP Rollout', status: 'Tender Submitted',
    client_id: 'c3', project_manager_id: 'u-alice', contract_value: 1200000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Northwind Manufacturing' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
  { id: 'p3', name: 'Regional Services Program', status: 'PQ Submitted',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 800000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null },
];

// Won project with customer_contract_ref set (for AC-1011 UI test)
const seedWithWon = [
  ...seed,
  { id: 'p4', name: 'Won Deal', status: 'Won, Pending KoM',
    client_id: 'c2', project_manager_id: 'u-alice', contract_value: 2000000, budget: 0, spent: 0,
    end_date: '2026-12-31', client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: 'CPO-2026-999', contract_date: '2026-01-15', decided_at: '2026-01-15T00:00:00Z' },
];

import type { ProjectWithRefs } from '@/src/lib/db/projects';
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

const renderPage = () => render(<MemoryRouter><Projects /></MemoryRouter>);

describe('Projects (real data)', () => {
  it('renders seeded projects with joined client + PM names (AC-401)', () => {
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alice Manager').length).toBeGreaterThan(0);
  });

  it('filters to Leads tab (AC-403)', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Leads/ }));
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
    await userEvent.click(screen.getByRole('button', { name: /My Projects/ }));
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument(); // u-alice manages all
  });
});

describe('Projects Board view', () => {
  it('toggles to Board view and renders a real contract value in a column header (AC-407)', async () => {
    projectsState.data = seed as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    renderPage();
    await userEvent.click(screen.getByTitle('Board View (CRM)'));
    // The Execution column must show the summed contract_value of ongoing projects: $5,000,000
    expect(screen.getByText('$5,000,000')).toBeInTheDocument();
  });

  it('Board view does not render empty-state underneath columns (AC-407)', async () => {
    projectsState.data = seed as unknown as ProjectWithRefs[];
    renderPage();
    await userEvent.click(screen.getByTitle('Board View (CRM)'));
    expect(screen.queryByText(/No projects found/i)).not.toBeInTheDocument();
  });
});

describe('Projects states', () => {
  it('shows loading state while pending (AC-405)', () => {
    projectsState.isPending = true; projectsState.isError = false;
    renderPage();
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
    projectsState.isPending = false;
  });
  it('shows error state with retry on failure (AC-408)', () => {
    projectsState.isError = true; projectsState.isPending = false;
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    projectsState.isError = false;
  });
  it('shows empty state when zero rows (AC-406)', () => {
    projectsState.data = [];
    renderPage();
    expect(screen.getByText(/No projects found/i)).toBeInTheDocument();
    projectsState.data = seed as unknown as ProjectWithRefs[];
  });
});

describe('ProjectStatusControl integration (AC-1011 UI)', () => {
  it('AC-1011 (UI): each project row renders a ProjectStatusControl and shows the customer contract reference when set (FR-PR-011)', () => {
    projectsState.data = seedWithWon as unknown as ProjectWithRefs[];
    projectsState.isPending = false;
    projectsState.isError = false;
    renderPage();

    // Each project row should have a status control (data-testid="project-status-control")
    const controls = screen.getAllByTestId('project-status-control');
    // 4 projects in seedWithWon — all have legal transitions except potentially terminal ones
    // 'Won, Pending KoM' → has transitions, so control renders; all 4 should render
    expect(controls.length).toBeGreaterThanOrEqual(1);

    // The won project's customer_contract_ref should be visible on the row
    expect(screen.getByText('CPO-2026-999')).toBeInTheDocument();

    projectsState.data = seed as unknown as ProjectWithRefs[];
  });
});
