import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  projects: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => h.projects,
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn() }, updateHeader: { mutateAsync: vi.fn() }, archive: { mutateAsync: vi.fn() } }),
  useProjectsMilestoneDates: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Admin', realRole: 'Admin' }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDeliverySummary: () => ({ data: {} }) }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));

import Projects from '../Projects';

const rows = [
  { id: 'p1', name: 'Active site', code: 'CLIENT-81', pmo_project_number: 'PMO-26-7711', status: 'Ongoing Project', client_id: null, project_manager_id: null, contract_value: 0, currency: 'USD', budget: 0, spent: 0, start_date: null, end_date: null, customer_contract_ref: null, contract_date: null, decided_at: null, archived_at: null, client: null, end_client: null, pm: null },
  { id: 'p2', name: 'Another site', code: 'CLIENT-82', pmo_project_number: 'PMO-26-7712', status: 'On Hold', client_id: null, project_manager_id: null, contract_value: 0, currency: 'USD', budget: 0, spent: 0, start_date: null, end_date: null, customer_contract_ref: null, contract_date: null, decided_at: null, archived_at: null, client: null, end_client: null, pm: null },
] as unknown as ProjectWithRefs[];

function renderProjects(path = '/projects?view=cards') {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><Projects /></ToastProvider></MemoryRouter>);
}

function cardFor(name: string) {
  const card = screen.getByText(name).closest<HTMLElement>('[data-testid="project-card"]');
  if (!card) throw new Error(`Missing project card for ${name}`);
  return card;
}

beforeEach(() => {
  sessionStorage.clear();
  h.projects.data = rows;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockMobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe('AC-CODE-003 active Projects identities', () => {
  it('AC-CODE-003: renders both identifiers as separately labelled values in the project table', () => {
    renderProjects('/projects?view=table');
    const row = screen.getByText('Active site').closest('tr');
    expect(row).toHaveTextContent('PMO Project Number: PMO-26-7711');
    expect(row).toHaveTextContent('Client Project Code: CLIENT-81');
  });

  it('renders both identities and searches by either without hiding a PMO number when Client Project Code is absent', async () => {
    const user = userEvent.setup();
    renderProjects();
    expect(cardFor('Active site')).toHaveTextContent('PMO Project Number: PMO-26-7711');
    expect(cardFor('Active site')).toHaveTextContent('Client Project Code: CLIENT-81');
    await user.type(screen.getByPlaceholderText(/Search projects/i), 'PMO-26-7711');
    await waitFor(() => expect(screen.getByText('Active site')).toBeInTheDocument());
    expect(screen.queryByText('Another site')).not.toBeInTheDocument();
    const search = screen.getByPlaceholderText(/Search projects/i);
    await user.clear(search);
    await user.type(search, 'CLIENT-81');
    await waitFor(() => expect(screen.getByText('Active site')).toBeInTheDocument());
    expect(screen.queryByText('Another site')).not.toBeInTheDocument();

    h.projects.data = [{ ...rows[0], code: null }];
    cleanup();
    renderProjects();
    expect(cardFor('Active site')).toHaveTextContent('PMO Project Number: PMO-26-7711');
    expect(cardFor('Active site')).not.toHaveTextContent('Client Project Code:');
  });

  it('AC-CODE-003: keeps each identifier readable on a narrow project card', () => {
    mockMobileViewport();
    renderProjects('/projects?view=table');
    const pmoNumber = screen.getByText('PMO Project Number: PMO-26-7711');
    const clientCode = screen.getByText('Client Project Code: CLIENT-81');

    expect(pmoNumber).toHaveClass('break-words');
    expect(pmoNumber).toHaveClass('md:truncate');
    expect(pmoNumber).not.toHaveClass('truncate');
    expect(clientCode).toHaveClass('break-words');
    expect(clientCode).toHaveClass('md:truncate');
    expect(clientCode).not.toHaveClass('truncate');
  });

  it('AC-CODE-003: uses the AA primary text token for the search Clear all action', async () => {
    mockMobileViewport();
    const user = userEvent.setup();
    renderProjects('/projects?view=table');
    await user.type(screen.getByPlaceholderText(/Search projects/i), 'PMO-26-7711');

    const clearAll = await screen.findByRole('button', { name: 'Clear all' });
    expect(clearAll).toHaveClass('text-primary-text');
    expect(clearAll).not.toHaveClass('text-primary');
  });
});
