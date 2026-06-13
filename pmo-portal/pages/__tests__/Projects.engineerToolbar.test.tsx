/**
 * AC-IXD-PIPE-W5-C5 — Projects toolbar: Engineer scope (N19)
 *
 * The Projects toolbar currently leads with manager-oriented filter chrome
 * (customer dropdown, PM dropdown) even for an Engineer who manages nothing
 * and only cares about their assigned projects.
 *
 * For the Engineer scope: hide the customer filter dropdown and PM filter
 * dropdown (manager-browse tools). The status SegFilter and search remain.
 * For non-Engineer roles (PM, Finance, Admin, Exec): toolbar is unchanged.
 *
 * TESTS:
 * 1. Engineer toolbar does NOT show the "Filter by customer" dropdown.
 * 2. Engineer toolbar does NOT show the "Filter by project manager" dropdown.
 * 3. Engineer toolbar STILL shows the status SegFilter tabs.
 * 4. Engineer toolbar STILL shows the search input.
 * 5. PM toolbar shows the customer filter dropdown (unchanged).
 * 6. PM toolbar shows the PM filter dropdown (unchanged).
 * 7. Finance toolbar shows both manager-oriented dropdowns (unchanged).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import type { Role } from '@/src/auth/AuthContext';

const { projectsState, myTasksState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  myTasksState: { data: [] as Array<Record<string, unknown>> },
}));

vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => null,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({
    data: [{ id: 'c1', name: 'Northwind Corp' }],
  }),
  useProjectManagers: () => ({
    data: [{ id: 'pm-1', full_name: 'Alice PM' }],
  }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));

vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()] as ['table', () => void],
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

const sampleProjects = [
  {
    id: 'p1',
    name: 'Northwind ERP',
    code: 'P-001',
    status: 'Ongoing',
    project_manager_id: 'pm-1',
    client_id: 'c1',
    contract_value: 100_000,
    budget: 80_000,
    spent: 40_000,
    customer_contract_ref: null,
    client: { id: 'c1', name: 'Northwind Corp' },
    pm: { id: 'pm-1', full_name: 'Alice PM' },
  },
];

beforeEach(() => {
  projectsState.data = sampleProjects;
  projectsState.isPending = false;
  projectsState.isError = false;
  myTasksState.data = [{ id: 't1', project_id: 'p1', assignee_id: 'u-eng' }];
});

const renderAs = (role: Role) =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('AC-IXD-PIPE-W5-C5 — Projects toolbar Engineer scope (N19)', () => {
  it('AC-IXD-PIPE-W5-C5-N19-1: Engineer toolbar does NOT show the "Filter by customer" dropdown', () => {
    renderAs('Engineer');
    expect(
      screen.queryByRole('combobox', { name: /filter by customer/i }),
    ).not.toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-N19-2: Engineer toolbar does NOT show the "Filter by project manager" dropdown', () => {
    renderAs('Engineer');
    expect(
      screen.queryByRole('combobox', { name: /filter by project manager/i }),
    ).not.toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-N19-3: Engineer toolbar STILL shows the status SegFilter tabs (not removed)', () => {
    renderAs('Engineer');
    // Status filter tabs should be present
    expect(screen.getByRole('tab', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /my projects/i })).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-N19-4: Engineer toolbar STILL shows the search input', () => {
    renderAs('Engineer');
    expect(screen.getByRole('searchbox', { name: /search projects/i })).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-N19-5: PM toolbar shows the "Filter by customer" dropdown (unchanged)', () => {
    renderAs('Project Manager');
    expect(
      screen.getByRole('combobox', { name: /filter by customer/i }),
    ).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-N19-6: PM toolbar shows the "Filter by project manager" dropdown (unchanged)', () => {
    renderAs('Project Manager');
    expect(
      screen.getByRole('combobox', { name: /filter by project manager/i }),
    ).toBeInTheDocument();
  });

  it('AC-IXD-PIPE-W5-C5-N19-7: Finance toolbar shows both manager-oriented dropdowns (unchanged)', () => {
    renderAs('Finance');
    expect(
      screen.getByRole('combobox', { name: /filter by customer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /filter by project manager/i }),
    ).toBeInTheDocument();
  });
});
