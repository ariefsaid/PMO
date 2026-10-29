import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * B-11 (AC-W2-IXD-009): When an Engineer opens the Projects page the status
 * filter defaults to "My Projects" (not "All"), so they immediately see their
 * own assigned projects rather than the entire org list.
 *
 * Non-Engineer roles (e.g. PM, Finance) default to "All" (unscoped view).
 *
 * Owning layer: component (RTL) — AC-W2-IXD-009.
 */

// vi.hoisted must be first to avoid TDZ errors when referenced in vi.mock factories.
const { projectsState, myTasksState, milestoneState, clientsState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  },
  milestoneState: { data: undefined as undefined | [], isPending: false, isError: false, refetch: vi.fn() },
  clientsState: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  // B-11 fix: the Engineer's "My Projects" derives from their assigned tasks.
  myTasksState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
}));

// Stub the ProjectStatusControl — B-11 is about filter defaults, not status transitions.
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => null,
}));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => clientsState,
  useProjectManagers: () => ({ data: [] }),
  useProjectsMilestoneDates: () => milestoneState,
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => myTasksState,
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: {} }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-eng', org_id: 'org-1' }, role: 'Engineer' }),
}));

import Projects from '../Projects';

const renderAsEngineer = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

const renderAsPM = (url = '/projects') =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  // Populated state — the filter tab is only rendered when data exists.
  projectsState.isPending = false;
  projectsState.isError = false;
  projectsState.data = [
    {
      id: 'p1',
      name: 'Northwind ERP',
      code: 'P-001',
      status: 'Ongoing',
      project_manager_id: 'pm-1',
      client_id: 'c1',
      contract_value: 100000, currency: 'USD',
      spent: 40000,
      customer_contract_ref: null,
      client: { id: 'c1', name: 'Northwind' },
      pm: { id: 'pm-1', full_name: 'Alice PM' },
    },
    {
      id: 'p2',
      name: 'Acme Internal',
      code: 'P-002',
      status: 'Ongoing',
      project_manager_id: 'pm-1',
      client_id: 'c1',
      contract_value: 50000, currency: 'USD',
      spent: 10000,
      customer_contract_ref: null,
      client: { id: 'c1', name: 'Northwind' },
      pm: { id: 'pm-1', full_name: 'Alice PM' },
    },
  ];
  // The Engineer (u-eng) is assigned a task on p1 only — so "My Projects" must show p1, hide p2.
  milestoneState.isPending = false;
  milestoneState.isError = false;
  clientsState.isError = false;
  clientsState.refetch.mockClear();
  myTasksState.isPending = false;
  myTasksState.isError = false;
  myTasksState.refetch.mockClear();
  myTasksState.data = [{ id: 't1', project_id: 'p1', assignee_id: 'u-eng' }];
});

describe('Projects page — Engineer default filter (B-11, AC-W2-IXD-009)', () => {
  it('waits for assignments before showing My Projects results', () => {
    myTasksState.isPending = true;
    myTasksState.data = [];
    renderAsEngineer();
    expect(screen.queryByText(/no projects match these filters/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP')).not.toBeInTheDocument();
  });

  it('allows an Engineer to view all projects while assignments are pending', () => {
    myTasksState.isPending = true;
    myTasksState.data = [];
    renderAsEngineer();
    fireEvent.click(screen.getByRole('tab', { name: /^all$/i }));
    expect(screen.getByText('Northwind ERP')).toBeInTheDocument();
    expect(screen.getByText('Acme Internal')).toBeInTheDocument();
  });

  it('allows retry when assignments cannot be read', () => {
    myTasksState.isError = true;
    myTasksState.data = [];
    const { rerender } = renderAsEngineer();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(myTasksState.refetch).toHaveBeenCalledOnce();
    myTasksState.isError = false;
    myTasksState.data = [{ id: 't1', project_id: 'p1' }];
    rerender(<ImpersonationProvider realRole="Engineer"><MemoryRouter><ToastProvider><Projects /></ToastProvider></MemoryRouter></ImpersonationProvider>);
    expect(screen.getByText('Northwind ERP')).toBeInTheDocument();
    expect(screen.queryByText('Acme Internal')).not.toBeInTheDocument();
  });

  it('shows loading while calendar milestone dates are pending', () => {
    milestoneState.isPending = true;
    renderAsPM('/projects?view=calendar');
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByText(/no events this month/i)).not.toBeInTheDocument();
  });

  it('shows the empty calendar when no projects match and the dates query is disabled', () => {
    milestoneState.isPending = true;
    renderAsPM('/projects?view=calendar&q=unmatched');
    expect(screen.getByText(/no events this month/i)).toBeInTheDocument();
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
  });

  it('offers retry when calendar milestone dates fail', () => {
    milestoneState.isError = true;
    renderAsPM('/projects?view=calendar');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(milestoneState.refetch).toHaveBeenCalledOnce();
  });

  it('offers retry for failed desktop filter options', () => {
    clientsState.isError = true;
    renderAsPM();
    fireEvent.click(screen.getByRole('button', { name: /^filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(clientsState.refetch).toHaveBeenCalledOnce();
  });

  it('AC-W2-IXD-009: Engineer sees "My Projects" tab selected by default', () => {
    renderAsEngineer();
    // "My Projects" filter tab should be selected (aria-selected=true or pressed state).
    const myProjectsTab = screen.getByRole('tab', { name: /my projects/i });
    expect(myProjectsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-W2-IXD-009: "All" tab is NOT selected by default for Engineer', () => {
    renderAsEngineer();
    const allTab = screen.getByRole('tab', { name: /^all$/i });
    expect(allTab).toHaveAttribute('aria-selected', 'false');
  });

  it('AC-W2-IXD-009: PM defaults to "All" (not "My Projects")', () => {
    renderAsPM();
    const allTab = screen.getByRole('tab', { name: /^all$/i });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-W2-IXD-009: Engineer "My Projects" shows projects they are ASSIGNED to (via tasks), not an empty PM-owned set', () => {
    renderAsEngineer();
    // p1 — Engineer has a task on it → shown under the default "My Projects" filter.
    expect(screen.getByText('Northwind ERP')).toBeInTheDocument();
    // p2 — no assigned task → hidden. (Pre-fix, "My Projects" was project_manager_id===self,
    // which is ALWAYS empty for an IC, so the default landed on an empty list.)
    expect(screen.queryByText('Acme Internal')).not.toBeInTheDocument();
  });
});
