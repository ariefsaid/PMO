import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectCard from './ProjectCard';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ProjectCard embeds ProjectStatusControl, which uses useToast — needs a provider.
const render = (ui: ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

// ADR-0016: ProjectStatusControl now gates on the REAL JWT role via usePermission,
// so the mock supplies realRole (equal to effectiveRole — no impersonation here).
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), isError: false, error: null, isPending: false }),
}));

const base = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'PRJ-001',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5000000,
  budget: 4700000,
  spent: 2100000,
  end_date: '2026-12-18',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

describe('ProjectCard', () => {
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
    const sparse = { ...base, client: null, pm: null } as ProjectWithRefs;
    render(<ProjectCard project={sparse} onOpen={vi.fn()} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
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

  it('has a carrier with the project-card testid', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByTestId('project-card')).toBeInTheDocument();
  });

  it('I6: labels each utilization bar ("Committed" / "Actual") adjacent to its ProgressBar', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    const bars = screen.getByTestId('project-card-bars');
    // both bars present, each keeping its descriptive aria-label (color-not-only)
    const committedBar = screen.getByLabelText(/Committed: \d+% of contract/i);
    const actualBar = screen.getByLabelText(/Actual spend: \d+% of contract/i);
    expect(bars).toContainElement(committedBar);
    expect(bars).toContainElement(actualBar);
    // a visible leading label for each bar inside the bars block
    const labels = Array.from(bars.querySelectorAll('span')).map((s) => s.textContent);
    expect(labels).toContain('Committed');
    expect(labels).toContain('Actual');
  });
});
