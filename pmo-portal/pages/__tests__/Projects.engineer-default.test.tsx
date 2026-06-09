import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
const { projectsState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  },
}));

// Stub the ProjectStatusControl — B-11 is about filter defaults, not status transitions.
vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => null,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()] as ['table', () => void],
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

const renderAsPM = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter>
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
      contract_value: 100000,
      spent: 40000,
      customer_contract_ref: null,
      client: { id: 'c1', name: 'Northwind' },
      pm: { id: 'pm-1', full_name: 'Alice PM' },
    },
  ];
});

describe('Projects page — Engineer default filter (B-11, AC-W2-IXD-009)', () => {
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
});
