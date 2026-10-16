import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import ProjectCard from './ProjectCard';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';

// ProjectCard embeds ProjectStatusControl (useToast) + CompanyNameLink (Link) —
// wrap in both providers.
const render = (ui: ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

// ADR-0016: ProjectStatusControl now gates on the REAL JWT role via usePermission,
// so the mock supplies realRole (equal to effectiveRole — no impersonation here).
// FR-L10N-020: this component reads useOrgCurrency for its ACROSS-record aggregates. Pinned here
// rather than left to a real query. ⚑ At LINE-START on purpose — inserted inside a neighbouring
// vi.mock call it parses as a syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), isError: false, error: null, isPending: false }),
}));

const base = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'CLIENT-81',
  pmo_project_number: 'PMO-26-7711',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5000000, currency: 'USD', tax_treatment: 'exclusive',
  budget: 4700000,
  spent: 2100000,
  end_date: '2026-12-18',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

describe('ProjectCard', () => {
  it('displays the client short name in a project card (references AC-NICK-001)', () => {
    render(<ProjectCard project={{ ...base, client: { name: 'Example Legal Company', short_name: 'Example' } }} onOpen={vi.fn()} />);
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.queryByText('Example Legal Company')).not.toBeInTheDocument();
  });
  it('renders the project name, customer, contract value and PM (AC-401 strings)', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp')).toBeInTheDocument();
    expect(screen.getByText('Alice Manager')).toBeInTheDocument();
    expect(screen.getByText('$5,000,000')).toBeInTheDocument();
  });

  it('renders a StatusPill (dot + text), not a legacy badge', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  it('renders the inline ProjectStatusControl with a stable testid', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-status-control')).toBeInTheDocument();
  });

  it('shows the customer contract ref when set', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByText('CPO-2026-001')).toBeInTheDocument();
  });

  it('renders em-dashes for a missing customer and PM rather than blank', () => {
    // A genuinely unassigned project: BOTH pm:null AND project_manager_id:null.
    const sparse = { ...base, client: null, pm: null, project_manager_id: null } as unknown as ProjectWithRefs;
    render(<ProjectCard project={sparse} onOpen={vi.fn()} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('FR-PRJUX-004: an assigned profile with a blank name shows `Unnamed user · shortID`, not Unassigned', () => {
    const blankAssigned = {
      ...base,
      project_manager_id: 'aaaaaaaa-bbbb-0000',
      pm: { full_name: '   ' },
    } as unknown as ProjectWithRefs;
    render(<ProjectCard project={blankAssigned} onOpen={vi.fn()} />);
    expect(screen.getByText('Unnamed user · aaaaaaaa')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });

  it('calls onOpen when the card is activated, but not when the status control is used', async () => {
    const onOpen = vi.fn();
    render(<ProjectCard project={base} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /Innovate Corp HQ Fit-Out/i }));
    expect(onOpen).toHaveBeenCalledWith(base);

    onOpen.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /change status/i }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('AC-CODE-003: renders PMO Project Number and Client Project Code as separate labelled identities', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-card')).toHaveTextContent('PMO Project Number: PMO-26-7711');
    expect(screen.getByTestId('project-card')).toHaveTextContent('Client Project Code: CLIENT-81');
  });

  it('has a carrier with the project-card testid', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-card')).toBeInTheDocument();
  });

  it('AC-S02: an unresolved collection read does not claim that no Active budget exists', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
    expect(screen.queryByText('$4,700,000')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('I5: when deliverySummary is provided, shows Delivery alongside Actual-based budget usage', () => {
    render(
      <ProjectCard
        project={base}
        onOpen={vi.fn()}
        deliverySummary={{ deliveryPct: 50, committedSpend: 2_000_000, budget: 3_800_000 }}
        projectMoney={{ actuals: { currency: 'USD', total: '125000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true }}
      />,
    );
    // Delivery progress bar
    const deliveryBar = screen.getByLabelText('Delivery 50%');
    expect(deliveryBar).toBeInTheDocument();
    // Budget used bar is based on mapped Actual / Active budget, not committed spend.
    const budgetBar = screen.getByLabelText(/25% of Active budget/i);
    expect(budgetBar).toBeInTheDocument();
    expect(screen.getByText('$125,000.00')).toBeInTheDocument();
    expect(screen.getByText('$500,000')).toBeInTheDocument();
    expect(screen.getByText('Updated Oct 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('$125.0K of $500.0K Active budget')).toBeInTheDocument();
    // Should NOT show the old Committed/Actual bars
    expect(screen.queryByLabelText(/Committed: \d+% of contract/i)).not.toBeInTheDocument();
  });

  it('AC-S02: partial or restricted Actual is displayed with its qualifier but never drives budget usage', () => {
    for (const actuals of [
      { currency: 'USD', total: '450.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '450.00' }, { category: 'Materials', mapped: false, amount: null }] },
      { currency: 'USD', total: '450.00', asOf: null, excludesRestrictedRows: true, categories: [{ category: 'Labor', mapped: true, amount: '450.00' }] },
    ]) {
      const { unmount } = render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={{ actuals, activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true }} />);
      expect(screen.getByText('$450.00')).toBeInTheDocument();
      expect(screen.queryByRole('progressbar', { name: /Active budget/i })).not.toBeInTheDocument();
      expect(screen.getAllByText(actuals.excludesRestrictedRows ? 'Restricted rows excluded' : 'Incomplete source coverage').length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('AC-S02: missing freshness is explicit when Actual is known', () => {
    const projectMoney: ProjectMoneyRead = {
      actuals: { currency: 'USD', total: '125.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125.00' }] },
      activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getByText('Update time unavailable')).toBeInTheDocument();
  });

  it('AC-S02: a known zero Active budget is not mislabeled as absent', () => {
    const projectMoney: ProjectMoneyRead = {
      actuals: { currency: 'USD', total: '0.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] },
      activeBudgetAmount: '0.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getByText('$0 Active budget; usage unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
  });

  it('AC-S02-011: does not compare or total Actual and Active budget across currencies', () => {
    const projectMoney: ProjectMoneyRead = {
      actuals: { currency: 'USD', total: '900.00', asOf: '2026-10-01', excludesRestrictedRows: false, categories: [] },
      activeBudgetAmount: '1000.00',
      activeBudgetCurrency: 'EUR',
      hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getByText('Budget currency differs from Actual')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+% of Active budget/)).not.toBeInTheDocument();
  });

  it('AC-S02-010: unknown Actual and absent Active budget never render zero-valued bars', () => {
    const projectMoney: ProjectMoneyRead = {
      actuals: { currency: 'USD', total: null, asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] },
      activeBudgetAmount: null,
      activeBudgetCurrency: null,
      hasActiveBudget: false,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('No active budget')).toHaveLength(3);
    expect(screen.queryByLabelText(/Actual spend: 0%/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Budget used 0%/)).not.toBeInTheDocument();
  });
});

// ⚑ Bound at the spec review's insistence: removing the label from ProjectCard left the ENTIRE
// 7,363-test suite green. Implemented is not covered. Both polarities, because a fixture where
// every row shares one treatment cannot tell a derived label from a hardcoded one.
describe('OD-TAX-1 §2: the contract figure states its basis', () => {
  it('renders the row\'s own treatment, and nothing when the row has none', () => {
    const { unmount } = render(
      <ProjectCard project={{ ...base, tax_treatment: 'inclusive' } as typeof base} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
    unmount();
    render(
      <ProjectCard project={{ ...base, tax_treatment: null } as unknown as typeof base} onOpen={vi.fn()} />,
    );
    expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
  });
});
