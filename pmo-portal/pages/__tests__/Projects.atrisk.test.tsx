/**
 * AC-W6-IXD-ATRISK — Projects list co-locates the budget-util basis WITH the
 * delivery-progress bar. The budget basis lives in the new "Budget used" column, while
 * the Project/name cell carries only identity + at-risk pill. Healthy rows still have
 * a Budget used value; budget===0 → muted dash, no NaN.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { projectsState, myTasksState, deliverySummaryState } = vi.hoisted(() => ({
  projectsState: {
    data: null as Array<Record<string, unknown>> | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  myTasksState: { data: [] as Array<Record<string, unknown>> },
  deliverySummaryState: {
    'p-risk': { deliveryPct: 32, committedSpend: 95_000, budget: 100_000 },
    'p-safe': { deliveryPct: 50, committedSpend: 40_000, budget: 80_000 },
    'p-zero': { deliveryPct: null, committedSpend: 0, budget: 0 },
  },
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
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));

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
  it('AC-W6-IXD-ATRISK: an at-risk row renders the "% of budget" caption in the Budget used cell', () => {
    renderPage();
    const row = screen.getByText('At Risk Project').closest('tr')!;
    const progressCell = row.children[row.children.length - 2] as HTMLElement;
    expect(within(progressCell).getByRole('progressbar')).toHaveAttribute('aria-label', 'Budget used 95%');
    expect(within(progressCell).getByText('$95.0K of $100.0K budget')).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: the budget caption is ABSENT from the Project/name and Progress cells', () => {
    renderPage();
    const row = screen.getByText('At Risk Project').closest('tr')!;
    const nameCell = within(row).getByRole('button', { name: 'At Risk Project' }).closest('td')!;
    const progressCell = row.children[row.children.length - 3] as HTMLElement;
    expect(within(nameCell).queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(within(progressCell).queryByText(/% of budget/i)).not.toBeInTheDocument();
    expect(within(nameCell).getByText(/^At risk$/i)).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: a healthy row still renders Budget used in its own column', () => {
    renderPage();
    const row = screen.getByText('Safe Project').closest('tr')!;
    const budgetUsedCell = row.children[row.children.length - 2] as HTMLElement;
    expect(within(budgetUsedCell).getByRole('progressbar')).toHaveAttribute('aria-label', 'Budget used 50%');
    expect(within(budgetUsedCell).getByText('$40.0K of $80.0K budget')).toBeInTheDocument();
  });

  it('AC-W6-IXD-ATRISK: budget===0 → no caption, no NaN', () => {
    projectsState.data = [zeroBudget];
    renderPage();
    const row = screen.getByText('Zero Budget Project').closest('tr')!;
    expect(within(row).queryByText(/NaN/i)).not.toBeInTheDocument();
    const budgetUsedCell = row.children[row.children.length - 2] as HTMLElement;
    expect(within(budgetUsedCell).getByText('—')).toBeInTheDocument();
  });
});
