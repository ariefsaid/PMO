/**
 * AC-W6-IXD-ATRISK — Projects list co-locates the budget-util basis WITH the
 * delivery-progress bar (owner decision: inline tabular caption beside the bar,
 * NOT a sub-bar, NOT a recolor). The caption sits in the Progress cell (a sibling
 * of the progressbar) and is ABSENT from the Project/name cell. Healthy rows show
 * no caption. budget===0 → no caption, no NaN.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { projectsState, myTasksState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  myTasksState: { data: [] as Array<Record<string, unknown>> },
}));

vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));

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

vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => myTasksState }));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import Projects from '../Projects';

const atRisk = {
  id: 'p-risk',
  name: 'At Risk Project',
  code: 'P-RISK',
  status: 'Ongoing Project',
  project_manager_id: 'pm-1',
  client_id: 'c1',
  contract_value: 200_000,
  budget: 100_000,
  spent: 95_000, // 95% of budget → at risk; 47.5% of contract on the bar
  customer_contract_ref: null,
  client: { id: 'c1', name: 'Acme' },
  pm: { id: 'pm-1', full_name: 'Alice PM' },
};

const healthy = {
  id: 'p-safe',
  name: 'Safe Project',
  code: 'P-SAFE',
  status: 'Ongoing Project',
  project_manager_id: 'pm-1',
  client_id: 'c1',
  contract_value: 100_000,
  budget: 80_000,
  spent: 40_000, // 50% of budget → healthy
  customer_contract_ref: null,
  client: { id: 'c1', name: 'Acme' },
  pm: { id: 'pm-1', full_name: 'Alice PM' },
};

const zeroBudget = {
  id: 'p-zero',
  name: 'Zero Budget Project',
  code: 'P-ZERO',
  status: 'Ongoing Project',
  project_manager_id: 'pm-1',
  client_id: 'c1',
  contract_value: 100_000,
  budget: 0,
  spent: 50_000,
  customer_contract_ref: null,
  client: { id: 'c1', name: 'Acme' },
  pm: { id: 'pm-1', full_name: 'Alice PM' },
};

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={['/projects']}>
        <ToastProvider>
          <Projects />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  projectsState.data = [atRisk, healthy];
  projectsState.isPending = false;
  projectsState.isError = false;
  myTasksState.data = [];
});

describe('Projects list — at-risk budget co-location (AC-W6-IXD-ATRISK)', () => {
  it('AC-W6-IXD-ATRISK: an at-risk row renders the "% of budget" caption as a SIBLING of the progressbar in the Progress cell', () => {
    renderPage();
    const row = screen.getByText('At Risk Project').closest('tr')!;
    // The progressbar's containing <td> (the Progress cell) also holds the caption.
    const bar = within(row).getByRole('progressbar');
    const progressCell = bar.closest('td')!;
    expect(within(progressCell).getByText(/95% of budget/i)).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: the budget caption is ABSENT from the Project/name cell (moved out)', () => {
    renderPage();
    const row = screen.getByText('At Risk Project').closest('tr')!;
    // The name cell holds the project name button; it must NOT also carry the budget caption.
    const nameCell = within(row).getByRole('button', { name: 'At Risk Project' }).closest('td')!;
    expect(within(nameCell).queryByText(/% of budget/i)).not.toBeInTheDocument();
    // The "At risk" pill stays next to the name.
    expect(within(nameCell).getByText(/^At risk$/i)).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: a healthy row has no budget caption anywhere', () => {
    renderPage();
    const row = screen.getByText('Safe Project').closest('tr')!;
    expect(within(row).queryByText(/% of budget/i)).not.toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: budget===0 → no caption, no NaN', () => {
    projectsState.data = [zeroBudget];
    renderPage();
    const row = screen.getByText('Zero Budget Project').closest('tr')!;
    expect(within(row).queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(within(row).queryByText(/NaN/i)).not.toBeInTheDocument();
  });
});
