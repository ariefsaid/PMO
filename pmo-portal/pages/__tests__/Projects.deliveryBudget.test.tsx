import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Projects from '../Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const projectsState = {
  data: null as ProjectWithRefs[] | null,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const deliverySummaryState = {
  data: null as Record<string, { deliveryPct: number | null; committedSpend: number; budget: number }> | null,
  isPending: false,
};

vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => null,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()] as ['table', () => void],
}));

vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => deliverySummaryState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

const fixtures: ProjectWithRefs[] = [
  {
    id: 'p1',
    name: 'Seabridge Upgrade',
    code: 'PRJ-001',
    status: 'Ongoing Project',
    client_id: 'c1',
    project_manager_id: 'pm-1',
    contract_value: 5_000_000,
    budget: 3_800_000,
    spent: 1_200_000,
    end_date: '2026-12-18',
    client: { name: 'Acme' },
    pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null,
    contract_date: null,
    decided_at: null,
  } as ProjectWithRefs,
  {
    id: 'p2',
    name: 'No Milestones Yet',
    code: 'PRJ-002',
    status: 'On Hold',
    client_id: 'c1',
    project_manager_id: 'pm-1',
    contract_value: 1_000_000,
    budget: 900_000,
    spent: 200_000,
    end_date: '2026-12-18',
    client: { name: 'Acme' },
    pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null,
    contract_date: null,
    decided_at: null,
  } as ProjectWithRefs,
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Projects delivery progress + budget used', () => {
  beforeEach(() => {
    projectsState.data = fixtures;
    projectsState.isPending = false;
    projectsState.isError = false;
    deliverySummaryState.isPending = false;
    deliverySummaryState.data = {
      p1: { deliveryPct: 50, committedSpend: 2_000_000, budget: 3_800_000 },
      p2: { deliveryPct: null, committedSpend: 0, budget: 900_000 },
    };
  });

  it('AC-DEL-013 AC-DEL-017: renders delivery progress and budget used from the delivery summary', () => {
    renderPage();

    expect(screen.getAllByLabelText('Delivery 50%')).toHaveLength(1);
    expect(screen.getByText('Budget used')).toBeInTheDocument();
    expect(screen.getByText('$2.0M of $3.8M budget')).toBeInTheDocument();
    expect(screen.getByText('53%')).toBeInTheDocument();
    expect(screen.getByText('No phases yet')).toBeInTheDocument();

    const ongoingStatus = screen.getByText('Ongoing Project').closest('span');
    expect(ongoingStatus?.className).toContain('bg-primary/10');
    expect(ongoingStatus?.className).not.toContain('bg-success/12');

    const deliveryCell = screen.getByLabelText('Delivery 50%').closest('td')!;
    expect(within(deliveryCell).getByText('50%')).toBeInTheDocument();
  });

  it('I7: while delivery summary is loading, shows placeholder — no flash of false empty state', () => {
    deliverySummaryState.isPending = true;
    deliverySummaryState.data = null;
    renderPage();

    // Progress and budget-used cells should NOT show 'No phases yet' or '$0 of $0 budget'
    // while loading — they show a placeholder.
    expect(screen.queryByText('No phases yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0 of/i)).not.toBeInTheDocument();
  });

  it('AC-DEL-017: when budget summary is unavailable, does not render a false $0 of $0 budget', () => {
    deliverySummaryState.data = {
      p1: { deliveryPct: 50, committedSpend: 2_000_000, budget: 3_800_000 },
    };

    renderPage();

    const noMilestonesRow = screen.getByText('No Milestones Yet').closest('tr')!;
    const budgetCell = within(noMilestonesRow).getAllByRole('cell')[7];
    expect(within(budgetCell).getByText('—')).toBeInTheDocument();
    expect(within(budgetCell).queryByText(/\$0 of \$0 budget/i)).not.toBeInTheDocument();
  });
});
